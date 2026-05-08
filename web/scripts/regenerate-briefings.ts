/**
 * regenerate-briefings.ts — Re-generate briefing_text for all CRM leads that
 * already have a briefing.
 *
 * IMPORTANT: This script is ready to run but should NOT be executed until the
 * Phase 11 cutover.  Running it now would regenerate 240+ briefings in the live
 * DB, which has non-trivial LLM cost if --phrased is used.  Wait for Phase 11
 * sign-off before executing against production.
 *
 * Usage:
 *   npx tsx scripts/regenerate-briefings.ts [--dry-run] [--phrased]
 *
 * Flags:
 *   --dry-run   Print the first 3 generated briefings to stdout; do NOT write DB.
 *   --phrased   Pass each briefing through the Haiku phrasing pass (requires
 *               ANTHROPIC_API_KEY).  Default: template-only (no LLM cost).
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ANTHROPIC_API_KEY          (only needed with --phrased)
 *
 * Idempotent: re-running the script re-renders and overwrites briefings from the
 * new template, which is the intended behaviour for a full re-generation pass.
 *
 * Outputs: count of leads updated.
 */

import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { renderBriefingTemplate, renderBriefingPhrased, type BriefingInput } from "../lib/llm/briefing";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface LeadRow {
  id: string;
  pipeline: string | null;
  contacts: {
    full_name: string | null;
    company_name: string | null;
    kind: string | null;
    mailing_address: string | null;
    mailing_city: string | null;
    mailing_postal: string | null;
    neq: string | null;
  } | null;
  properties: Array<{
    matricule: string;
    address: string | null;
    city: string | null;
    num_units: number | null;
    evaluation_total: number | null;
    year_built: number | null;
  }> | null;
  phones: Array<{
    e164: string;
    confidence: number | null;
    is_direct: boolean | null;
    source: string | null;
    tier: string | null;
    label: string | null;
  }> | null;
}

// ---------------------------------------------------------------------------
// deriveBriefingInput
// ---------------------------------------------------------------------------

/**
 * Derive a BriefingInput from a CRM lead row.
 *
 * Where new pipeline data (evidence rows) is not yet available in the live DB,
 * this function falls back to CRM-stored fields:
 *   - owner: from contacts via lead_id
 *   - properties: from properties join
 *   - primaryPhone: best phone row ordered by confidence (highest first)
 *   - primarySource / secondarySource: from phones.source
 *
 * Returns null if the lead lacks the minimum required data (no contact, no
 * properties, no phone).
 */
export function deriveBriefingInput(lead: LeadRow): BriefingInput | null {
  const contact = lead.contacts;
  const properties = lead.properties ?? [];
  const phones = (lead.phones ?? []).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  // Minimum viability checks
  if (!contact) return null;
  if (properties.length === 0) return null;
  if (phones.length === 0) return null;

  const bestPhone = phones[0];
  const secondPhone = phones[1] ?? null;

  const canonicalName = contact.full_name ?? contact.company_name ?? "Unknown Owner";

  // Map CRM kind → ownerType
  const kindMap: Record<string, BriefingInput["owner"]["ownerType"]> = {
    individual: "individual",
    numbered_co: "numbered_co",
    named_co: "named_co",
    trust: "trust",
    government: "government",
    company: "named_co",
    corporation: "named_co",
  };
  const ownerType: BriefingInput["owner"]["ownerType"] =
    kindMap[contact.kind?.toLowerCase() ?? ""] ?? "named_co";

  // Mailing address
  const mailingAddress = [contact.mailing_address, contact.mailing_city, contact.mailing_postal]
    .filter(Boolean)
    .join(", ") || null;

  // Determine pipeline: use lead.pipeline if available; else infer from ownerType
  const pipeline: "A" | "B" =
    lead.pipeline === "A" || lead.pipeline === "B"
      ? lead.pipeline
      : ownerType === "individual"
        ? "B"
        : "A";

  return {
    pipeline,
    owner: {
      canonicalName,
      ownerType,
      neq: contact.neq ?? null,
      mailingAddress,
      mailingIsProperty: false, // conservative default; no geocode available here
    },
    reqDirector: null,         // not available in legacy CRM rows
    directorOfOther: null,     // not available in legacy CRM rows
    properties: properties.map((p) => ({
      matricule: p.matricule,
      address: p.address ?? "",
      city: p.city ?? null,
      nUnits: p.num_units ?? null,
      assessmentTotal: p.evaluation_total ?? null,
      yearBuilt: p.year_built ?? null,
    })),
    primaryPhone: {
      e164: bestPhone.e164,
      tier: bestPhone.tier ?? "E",
      label: bestPhone.label ?? "weak",
      isDirect: bestPhone.is_direct ?? false,
    },
    primarySource: bestPhone.source ?? "unknown",
    secondarySource: secondPhone?.source ?? null,
    whatsInteresting: null,    // re-derive in Phase 11 cutover; skip here
    language: "auto",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const BATCH_SIZE = 50;

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const phrased = args.includes("--phrased");

  if (dryRun) {
    console.log("[regenerate-briefings] DRY RUN — no DB writes.");
  }
  if (phrased) {
    console.log("[regenerate-briefings] Phrased mode — Haiku pass enabled (requires ANTHROPIC_API_KEY).");
  } else {
    console.log("[regenerate-briefings] Template-only mode (no LLM cost).");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    process.exit(1);
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch all leads that have a briefing_text
  const { data: leads, error: fetchErr } = await sb
    .from("leads")
    .select(`
      id,
      pipeline,
      contacts (
        full_name,
        company_name,
        kind,
        mailing_address,
        mailing_city,
        mailing_postal,
        neq
      ),
      properties (
        matricule,
        address,
        city,
        num_units,
        evaluation_total,
        year_built
      ),
      phones (
        e164,
        confidence,
        is_direct,
        source,
        tier,
        label
      )
    `)
    .not("briefing_text", "is", null);

  if (fetchErr) {
    console.error("[regenerate-briefings] Failed to fetch leads:", fetchErr.message);
    process.exit(1);
  }

  const allLeads = (leads ?? []) as unknown as LeadRow[];
  console.log(`[regenerate-briefings] Found ${allLeads.length} leads with existing briefings.`);

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let dryRunSamples = 0;

  // Process in batches
  for (let i = 0; i < allLeads.length; i += BATCH_SIZE) {
    const batch = allLeads.slice(i, i + BATCH_SIZE);

    const updates: Array<{ id: string; briefing_text: string }> = [];

    for (const lead of batch) {
      const input = deriveBriefingInput(lead);
      if (!input) {
        console.warn(`[regenerate-briefings] Lead ${lead.id}: skipped — insufficient data.`);
        skippedCount++;
        continue;
      }

      let text: string;
      try {
        text = phrased
          ? await renderBriefingPhrased(input)
          : renderBriefingTemplate(input);
      } catch (err) {
        console.error(`[regenerate-briefings] Lead ${lead.id}: render error:`, err);
        errorCount++;
        continue;
      }

      if (dryRun) {
        if (dryRunSamples < 3) {
          console.log(`\n--- Lead ${lead.id} (${input.owner.canonicalName}) ---`);
          console.log(text);
          dryRunSamples++;
        }
        continue; // skip DB write
      }

      updates.push({ id: lead.id, briefing_text: text });
    }

    if (dryRun || updates.length === 0) continue;

    // Batch update using upsert on id
    const { error: updateErr } = await sb
      .from("leads")
      .upsert(
        updates.map(u => ({ id: u.id, briefing_text: u.briefing_text })),
        { onConflict: "id" },
      );

    if (updateErr) {
      console.error(`[regenerate-briefings] Batch update error (leads ${i}–${i + batch.length - 1}):`, updateErr.message);
      errorCount += updates.length;
    } else {
      updatedCount += updates.length;
      console.log(`[regenerate-briefings] Updated ${updatedCount} / ${allLeads.length} leads…`);
    }
  }

  if (dryRun) {
    console.log(`\n[regenerate-briefings] Dry run complete. Showed ${dryRunSamples} samples. Would have updated up to ${allLeads.length - skippedCount} leads.`);
  } else {
    console.log(`\n[regenerate-briefings] Done. Updated: ${updatedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}.`);
  }
}

// Only run when executed directly (not imported in tests)
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace("file://", ""))
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { main };
