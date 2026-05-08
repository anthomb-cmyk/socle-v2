/**
 * pipeline.ts — Enrichment pipeline entrypoint (post-redesign cutover).
 *
 * This module is the public entrypoint expected by all callers
 * (queue worker, /api/enrichment/start, bulk-rerun, bulk-start).
 *
 * Behaviour switch:
 *   ENRICHMENT_USE_LEGACY=true  → delegate to runEnrichmentPipelineLegacy
 *                                 (the pre-redesign Brave-driven pipeline).
 *   ENRICHMENT_USE_LEGACY unset
 *      or any other value       → run the new canonical_owner research
 *                                 pipeline (default).
 *
 * The legacy path is the cutover kill-switch: flipping the env var rolls back
 * without a code deploy.
 *
 * Return contract — preserved bit-for-bit from the legacy pipeline so callers
 * remain unchanged:
 *   {
 *     outcome: "solved"|"review"|"unresolved"|"openclaw_dispatched"|"unsuitable",
 *     stageReached: PipelineStage|"preflight"|"none",
 *     candidateIds: string[],
 *     openclawDispatched: boolean,
 *   }
 *
 * In the new pipeline, `candidateIds` is always [] (we store hypotheses, not
 * candidate phones), `stageReached` is always "none" (legacy concept), and
 * `openclawDispatched` is always false (the new system does not use OpenClaw).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadContext, PipelineStage, EnrichmentEventType } from "./types";
import { dedupeOwner, type OwnerType, type DedupeInput } from "@/lib/research/dedupe";
import { routeOwner } from "@/lib/research/classifier";
import { runPipelineA } from "@/lib/research/pipeline-a";
import { runPipelineB } from "@/lib/research/pipeline-b";
import { assembleOwnerRecord } from "@/lib/research/record-assembler";
import { publishOwnerRecordToCrm } from "@/lib/research/crm-bridge";
import { extractFsa, normalizeEntityName, normalizePersonName } from "@/lib/req/normalize";

export type PipelineOutcome =
  | "solved"
  | "review"
  | "unresolved"
  | "openclaw_dispatched"
  | "unsuitable";

export interface PipelineResult {
  outcome: PipelineOutcome;
  stageReached: PipelineStage | "preflight" | "none";
  candidateIds: string[];
  openclawDispatched: boolean;
}

const UNRESOLVED: PipelineResult = {
  outcome: "unresolved",
  stageReached: "none",
  candidateIds: [],
  openclawDispatched: false,
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function logEvent(
  sb: SupabaseClient,
  leadId: string,
  eventType: EnrichmentEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await sb.from("enrichment_events").insert({
      lead_id: leadId,
      event_type: eventType,
      stage: null,
      payload,
    });
  } catch (err) {
    console.warn("[pipeline] logEvent failed:", err);
  }
}

async function setLeadStatus(
  sb: SupabaseClient,
  leadId: string,
  status: string,
): Promise<void> {
  try {
    await sb.from("leads").update({ status }).eq("id", leadId);
  } catch (err) {
    console.warn("[pipeline] setLeadStatus failed:", err);
  }
}

/**
 * Infer owner type and canonical name from the LeadContext.  Mirrors
 * the heuristics used by web/scripts/backfill-canonical-owners.ts —
 * we don't have access to `contacts.kind` here without an extra query.
 */
function deriveOwnerIdentity(ctx: LeadContext): {
  canonicalName: string;
  ownerType: OwnerType;
} | null {
  const company = ctx.companyName?.trim() ?? "";
  const person = ctx.fullName?.trim() ?? "";

  if (company) {
    if (/^\d/.test(company)) {
      return { canonicalName: company, ownerType: "numbered_co" };
    }
    return { canonicalName: company, ownerType: "named_co" };
  }
  if (person) {
    return { canonicalName: person, ownerType: "individual" };
  }
  return null;
}

function buildMailingAddressString(ctx: LeadContext): string | null {
  const parts = [ctx.mailingAddress, ctx.mailingCity, ctx.mailingPostal].filter(
    (x) => Boolean(x && String(x).trim()),
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Find the canonical_owner for this lead's contact, creating a row if none
 * exists yet.  Returns null if we cannot derive an owner identity at all.
 */
async function findOrCreateCanonicalOwner(
  sb: SupabaseClient,
  ctx: LeadContext,
): Promise<string | null> {
  const identity = deriveOwnerIdentity(ctx);
  if (!identity) return null;

  const { canonicalName, ownerType } = identity;
  const normalized =
    ownerType === "individual"
      ? normalizePersonName(canonicalName)
      : normalizeEntityName(canonicalName);

  const input: DedupeInput = {
    canonicalName,
    ownerType,
    neq: null,
    mailingAddressRaw: buildMailingAddressString(ctx),
    mailingGeocode: null,
    mailingPostal: ctx.mailingPostal,
  };

  const match = await dedupeOwner(sb, input);
  if (match.kind === "exact" || match.kind === "fuzzy_review") {
    return match.ownerId;
  }

  // No existing owner — insert one.
  const fsa = extractFsa(ctx.mailingPostal ?? null);
  const { data: inserted, error } = await sb
    .from("canonical_owner")
    .insert({
      owner_type: ownerType,
      canonical_name: canonicalName,
      canonical_name_normalized: normalized,
      neq: null,
      mailing_address_raw: buildMailingAddressString(ctx),
      mailing_geocode: null,
      mailing_postal_fsa: fsa,
      dedupe_status: "auto",
      is_aggregator_address: false,
    })
    .select("owner_id")
    .single();

  if (error || !inserted) {
    console.error("[pipeline] canonical_owner insert failed:", error);
    return null;
  }
  return (inserted as { owner_id: string }).owner_id;
}

/** Translate a hypothesis tier (or absence) into a legacy outcome bucket. */
function tierToOutcome(tier: string | null): PipelineOutcome {
  if (tier === "A" || tier === "B") return "solved";
  if (tier === "C" || tier === "D") return "review";
  return "unresolved";
}

// ── Main entrypoint ────────────────────────────────────────────────────────

/**
 * Run the enrichment pipeline for a single lead.
 *
 * - Honours ENRICHMENT_USE_LEGACY=true to fall back to the legacy code path.
 * - Wraps the new path in try/catch and logs errors as enrichment_events.
 * - Always returns a well-formed PipelineResult (never throws).
 */
export async function runEnrichmentPipeline(
  sb: SupabaseClient,
  ctx: LeadContext,
): Promise<PipelineResult> {
  if ((process.env.ENRICHMENT_USE_LEGACY ?? "").toLowerCase() === "true") {
    const { runEnrichmentPipelineLegacy } = await import("./pipeline-legacy");
    return runEnrichmentPipelineLegacy(sb, ctx);
  }

  await setLeadStatus(sb, ctx.leadId, "enrichment_running");

  try {
    // 1. Find or create canonical_owner for this lead
    const ownerId = await findOrCreateCanonicalOwner(sb, ctx);
    if (!ownerId) {
      await logEvent(sb, ctx.leadId, "lead_status_updated", {
        reason: "no_owner_identity",
      });
      await setLeadStatus(sb, ctx.leadId, "unresolved_after_all_sources");
      return UNRESOLVED;
    }

    // 2. Route to A or B
    const routing = await routeOwner(sb, ownerId);

    // 3. Run the chosen pipeline
    if (routing.pipeline === "A") {
      await runPipelineA(sb, ownerId);
    } else {
      await runPipelineB(sb, ownerId);
    }

    // 4. Look up the strongest hypothesis to seed the owner_record
    const { data: topHyp } = await sb
      .from("hypothesis")
      .select("claim_value_e164, tier, confidence_label, is_direct")
      .eq("owner_id", ownerId)
      .eq("claim_type", "phone")
      .in("status", ["accepted", "candidate"])
      .order("tier", { ascending: true }) // 'A' < 'B' < 'C' alphabetically
      .limit(1)
      .maybeSingle();

    type HypRow = {
      claim_value_e164: string | null;
      tier: string;
      confidence_label: string;
      is_direct: boolean;
    };
    const hyp = (topHyp ?? null) as HypRow | null;

    // 5. Collect property matricules for this owner so the CRM bridge can
    //    fan-out to all leads sharing the owner.
    const { data: rawProps } = await sb
      .from("raw_property")
      .select("matricule")
      .eq("owner_id", ownerId);
    const matricules = ((rawProps ?? []) as Array<{ matricule: string | null }>)
      .map((r) => r.matricule)
      .filter((m): m is string => typeof m === "string" && m.length > 0);

    // 6. Assemble + publish owner_record
    await assembleOwnerRecord(sb, {
      ownerId,
      primaryHypothesis:
        hyp && hyp.claim_value_e164
          ? {
              phoneE164: hyp.claim_value_e164,
              tier: hyp.tier,
              label: hyp.confidence_label,
              isDirect: hyp.is_direct,
            }
          : undefined,
      propertyMatricules: matricules.length > 0 ? matricules : [ctx.matricule].filter(
        (m): m is string => typeof m === "string" && m.length > 0,
      ),
    });

    try {
      await publishOwnerRecordToCrm(sb, { ownerId });
    } catch (err) {
      console.warn("[pipeline] publishOwnerRecordToCrm failed:", err);
    }

    return {
      outcome: tierToOutcome(hyp?.tier ?? null),
      stageReached: "none",
      candidateIds: [],
      openclawDispatched: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pipeline] error:", message);
    await logEvent(sb, ctx.leadId, "lead_status_updated", {
      error: message,
      source: "new_pipeline",
    });
    await setLeadStatus(sb, ctx.leadId, "unresolved_after_all_sources");
    return UNRESOLVED;
  }
}
