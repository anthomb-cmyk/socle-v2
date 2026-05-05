// POST /api/enrichment/bulk-rerun
//
// Re-runs the enrichment pipeline for leads that came back with only
// low-confidence candidates or no candidates at all. Designed to be
// triggered from the admin enrichment dashboard after a pipeline fix.
//
// Targets:
//   1. Leads with status = 'needs_phone_review' where ALL candidates
//      have initial_confidence < :maxConfidence (default 60)
//   2. Leads with status = 'unresolved_after_openclaw'
//
// For each target lead:
//   - Deletes existing needs_review phone_candidates (prevents duplicates)
//   - Resets lead status so the active-status guard doesn't block re-run
//   - Runs the enrichment pipeline (address → company → OpenClaw if needed)
//
// Processing is background / fire-and-forget: the HTTP response returns
// immediately with the count of queued leads. The actual enrichment runs
// asynchronously in batches of 3 with a 1 s delay between batches.
//
// Auth: requireAdmin (admin session cookie)

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { runEnrichmentPipeline } from "@/lib/enrichment/pipeline";
import type { LeadContext } from "@/lib/enrichment/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60; // just long enough to query + kick off background work

const BATCH_SIZE  = 3;   // concurrent leads per batch
const BATCH_DELAY = 1500; // ms between batches

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type LeadRow = {
  id: string;
  contact_id: string;
  status: string;
  properties: {
    address: string;
    city: string | null;
    matricule: string | null;
    num_units: number | null;
  } | null;
  contacts: {
    id: string;
    full_name: string | null;
    company_name: string | null;
    mailing_address: string | null;
    mailing_city: string | null;
    mailing_postal: string | null;
  } | null;
};

// ── Background processor ────────────────────────────────────────────────────

async function processLeadsInBackground(
  leads: LeadRow[],
  sb: SupabaseClient,
): Promise<void> {
  // Split into batches of BATCH_SIZE
  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map(lead => processSingleLead(lead, sb)));
    if (i + BATCH_SIZE < leads.length) await sleep(BATCH_DELAY);
  }
}

async function processSingleLead(lead: LeadRow, sb: SupabaseClient): Promise<void> {
  // Create enrichment job record
  const { data: jobRow } = await sb.from("enrichment_jobs").insert({
    lead_id:     lead.id,
    contact_id:  lead.contact_id,
    workflow_id: "pipeline_v2_address_first",
    job_type:    "find_phone",
    status:      "processing",
    started_at:  new Date().toISOString(),
    raw_input:   { leadId: lead.id, pipeline: "address_first_v2", bulkRerun: true },
  }).select("id").single();

  if (!jobRow) return;
  const enrichmentJobId = (jobRow as { id: string }).id;

  // Build LeadContext — split co-owners separated by / or "et"
  const rawFullName = lead.contacts?.full_name ?? null;
  let primaryName: string | null = null;
  let secondaryName: string | null = null;
  if (rawFullName) {
    const sep = rawFullName.match(/\s*[\/|]\s*|\s+et\s+|\s+and\s+/i);
    if (sep?.index !== undefined) {
      primaryName   = rawFullName.slice(0, sep.index).trim() || null;
      secondaryName = rawFullName.slice(sep.index + sep[0].length).trim() || null;
    } else {
      primaryName = rawFullName;
    }
  }

  const ctx: LeadContext = {
    leadId:          lead.id,
    contactId:       lead.contact_id,
    enrichmentJobId,
    fullName:        primaryName,
    companyName:     lead.contacts?.company_name ?? null,
    secondaryName,
    propertyAddress: lead.properties?.address ?? null,
    propertyCity:    lead.properties?.city ?? null,
    mailingAddress:  lead.contacts?.mailing_address ?? null,
    mailingCity:     lead.contacts?.mailing_city ?? null,
    mailingPostal:   lead.contacts?.mailing_postal ?? null,
    matricule:       lead.properties?.matricule ?? null,
    numUnits:        lead.properties?.num_units ?? null,
  };

  try {
    const result = await runEnrichmentPipeline(sb, ctx);
    const jobStatus =
      result.outcome === "openclaw_dispatched" ? "processing"
      : result.outcome === "unresolved"         ? "failed"
      :                                           "completed";
    await sb.from("enrichment_jobs").update({
      status:       jobStatus,
      completed_at: result.openclawDispatched ? undefined : new Date().toISOString(),
      raw_output:   {
        outcome:      result.outcome,
        stageReached: result.stageReached,
        bulkRerun:    true,
      },
    }).eq("id", enrichmentJobId);
  } catch (err) {
    await sb.from("enrichment_jobs").update({
      status:        "failed",
      completed_at:  new Date().toISOString(),
      error_message: (err as Error).message,
    }).eq("id", enrichmentJobId);
  }
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const maxConfidence: number = typeof body.maxConfidence === "number"
    ? body.maxConfidence
    : 60;

  const sb = createSupabaseAdminClient();

  // ── 1. Find needs_phone_review leads where ALL candidates are low confidence ──
  //
  // We use a subquery pattern: get leads where the MAX confidence across all
  // their phone_candidates is still below the threshold.
  const { data: reviewLeadsRaw } = await sb
    .from("leads")
    .select(`
      id, contact_id, status,
      properties ( address, city, matricule, num_units ),
      contacts ( id, full_name, company_name, mailing_address, mailing_city, mailing_postal )
    `)
    .eq("status", "needs_phone_review");

  const reviewLeads = (reviewLeadsRaw ?? []) as unknown as LeadRow[];

  // Filter to only leads where the best existing candidate is below threshold
  const lowConfidenceLeadIds = new Set<string>();
  if (reviewLeads.length > 0) {
    const { data: candidateSummary } = await sb
      .from("phone_candidates")
      .select("lead_id, initial_confidence")
      .in("lead_id", reviewLeads.map(l => l.id))
      .eq("status", "needs_review");

    // Group max confidence per lead
    const maxByLead = new Map<string, number>();
    for (const c of (candidateSummary ?? []) as { lead_id: string; initial_confidence: number }[]) {
      const cur = maxByLead.get(c.lead_id) ?? 0;
      if (c.initial_confidence > cur) maxByLead.set(c.lead_id, c.initial_confidence);
    }

    for (const lead of reviewLeads) {
      const best = maxByLead.get(lead.id) ?? 0;
      if (best < maxConfidence) lowConfidenceLeadIds.add(lead.id);
    }
  }

  // ── 2. Find unresolved_after_openclaw leads ──────────────────────────────
  const { data: unresolvedRaw } = await sb
    .from("leads")
    .select(`
      id, contact_id, status,
      properties ( address, city, matricule, num_units ),
      contacts ( id, full_name, company_name, mailing_address, mailing_city, mailing_postal )
    `)
    .eq("status", "unresolved_after_openclaw");

  const unresolvedLeads = (unresolvedRaw ?? []) as unknown as LeadRow[];

  // ── 3. Merge target leads (deduplicated) ─────────────────────────────────
  const targetLeads: LeadRow[] = [
    ...reviewLeads.filter(l => lowConfidenceLeadIds.has(l.id)),
    ...unresolvedLeads,
  ];

  if (targetLeads.length === 0) {
    return NextResponse.json({
      ok: true,
      data: { queued: 0, message: `No leads found below ${maxConfidence}% confidence threshold.` },
    });
  }

  // ── 4. Clear existing weak candidates + reset lead statuses ─────────────
  const targetIds = targetLeads.map(l => l.id);

  // Delete needs_review candidates so pipeline starts fresh (no duplicates)
  await sb
    .from("phone_candidates")
    .delete()
    .in("lead_id", targetIds)
    .eq("status", "needs_review");

  // Reset status to enrichment_failed — not in activeStatuses guard,
  // best_phone will be NULL so phone gate won't block re-run.
  await sb
    .from("leads")
    .update({ status: "enrichment_failed" })
    .in("id", targetIds);

  // ── 5. Fire background processing (response returns immediately) ─────────
  // Intentionally not awaited — Railway Node.js process keeps running.
  void processLeadsInBackground(targetLeads, sb);

  return NextResponse.json({
    ok: true,
    data: {
      queued:      targetLeads.length,
      breakdown: {
        lowConfidenceReview: reviewLeads.filter(l => lowConfidenceLeadIds.has(l.id)).length,
        unresolvedOpenClaw:  unresolvedLeads.length,
      },
      maxConfidenceThreshold: maxConfidence,
      message: `Re-enrichment started for ${targetLeads.length} leads in the background. Check the phone-review queue in a few minutes.`,
    },
  });
}
