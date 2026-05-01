// Multi-stage phone enrichment pipeline orchestrator.
//
// Stage order:
//   1. Brave Search
//   2. 411 / Directory Lookup
//   3. Place API / Business Lookup
//   4. OpenClaw Deep Search (async — fires and returns)
//
// After each stage:
//   • HIGH confidence (≥ HIGH_CONFIDENCE_THRESHOLD) → needs_anthony_review directly
//   • LOW confidence → send to OpenClaw for validation (async)
//   • No candidates → advance to next stage
//
// This function runs synchronously for stages 1-3 and dispatches stage 4
// asynchronously. The pipeline is designed to be called from a Next.js API
// route with maxDuration = 60s (stages 1-3 take ~5-15s total).

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LeadContext,
  PhoneCandidate,
  PipelineStage,
  EnrichmentEventType,
} from "./types";
import { HIGH_CONFIDENCE_THRESHOLD } from "./types";
import { runBraveSearch } from "./brave-search";
import { runDirectorySearch } from "./directory-411";
import { runPlaceApiSearch } from "./place-api";
import { requestOpenclawValidation, requestOpenclawDeepSearch } from "./openclaw-validate";

// ── Event helpers ─────────────────────────────────────────────────────────────

async function logEvent(
  sb: SupabaseClient,
  leadId: string,
  eventType: EnrichmentEventType,
  stage: PipelineStage | null,
  payload: Record<string, unknown>,
  candidateId?: string,
) {
  await sb.from("enrichment_events").insert({
    lead_id: leadId,
    event_type: eventType,
    stage,
    candidate_id: candidateId ?? null,
    payload,
  });
}

async function setLeadStatus(sb: SupabaseClient, leadId: string, status: string) {
  await sb.from("leads").update({ status }).eq("id", leadId);
  await sb.from("enrichment_events").insert({
    lead_id: leadId,
    event_type: "lead_status_updated",
    stage: null,
    payload: { new_status: status },
  });
}

// ── Save candidate + optionally route to OpenClaw ─────────────────────────────

async function saveCandidate(
  sb: SupabaseClient,
  ctx: LeadContext,
  c: PhoneCandidate,
): Promise<string> {
  const { data, error } = await sb.from("phone_candidates").insert({
    lead_id: ctx.leadId,
    contact_id: ctx.contactId,
    enrichment_job_id: ctx.enrichmentJobId,
    phone_raw: c.phoneRaw,
    phone_e164: c.phoneE164,
    stage: c.stage,
    source_label: c.sourceLabel,
    source_url: c.sourceUrl,
    snippet: c.snippet,
    initial_confidence: c.initialConfidence,
    candidate_status: "candidate_found",
  }).select("id").single();

  if (error || !data) throw new Error(`phone_candidates insert: ${error?.message}`);
  const candidateId = (data as { id: string }).id;

  await logEvent(sb, ctx.leadId, "phone_candidate_found", c.stage, {
    phone_e164: c.phoneE164,
    confidence: c.initialConfidence,
    source: c.sourceLabel,
  }, candidateId);

  if (c.initialConfidence >= HIGH_CONFIDENCE_THRESHOLD) {
    // High confidence → goes directly to Anthony review
    await sb.from("phone_candidates").update({
      candidate_status: "needs_anthony_review",
      review_reason: `High confidence (${c.initialConfidence}) from ${c.sourceLabel}`,
    }).eq("id", candidateId);

    await logEvent(sb, ctx.leadId, "phone_candidate_needs_review", c.stage, {
      reason: "high_confidence",
      confidence: c.initialConfidence,
    }, candidateId);
  } else {
    // Low confidence → send to OpenClaw for validation
    await sb.from("phone_candidates").update({
      candidate_status: "validating_with_openclaw",
    }).eq("id", candidateId);

    await logEvent(sb, ctx.leadId, "openclaw_validation_started", c.stage, {
      candidate_id: candidateId,
    });

    const { dispatched, reason } = await requestOpenclawValidation(candidateId, c, ctx);
    if (!dispatched) {
      // OpenClaw not configured — treat as uncertain, route to review anyway
      await sb.from("phone_candidates").update({
        candidate_status: "needs_anthony_review",
        review_reason: `OpenClaw not available (${reason ?? "no URL"}) — needs manual review`,
      }).eq("id", candidateId);

      await logEvent(sb, ctx.leadId, "phone_candidate_needs_review", c.stage, {
        reason: "openclaw_unavailable",
        confidence: c.initialConfidence,
      }, candidateId);
    }
  }

  return candidateId;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runEnrichmentPipeline(
  sb: SupabaseClient,
  ctx: LeadContext,
): Promise<{
  foundCandidates: boolean;
  stageReached: PipelineStage | "none";
  candidateIds: string[];
  openclawDispatched: boolean;
}> {
  const candidateIds: string[] = [];
  let openclawDispatched = false;

  await setLeadStatus(sb, ctx.leadId, "enrichment_running");
  await logEvent(sb, ctx.leadId, "enrichment_started", null, {
    enrichment_job_id: ctx.enrichmentJobId,
  });

  // ── Stage 1: Brave ────────────────────────────────────────────────────────
  await logEvent(sb, ctx.leadId, "brave_search_started", "brave", {});
  const braveResult = await runBraveSearch(ctx);
  await logEvent(sb, ctx.leadId, "brave_search_complete", "brave", {
    found: braveResult.found,
    candidates: braveResult.found ? braveResult.candidates.length : 0,
  });

  if (braveResult.found) {
    for (const c of braveResult.candidates) {
      const id = await saveCandidate(sb, ctx, c);
      candidateIds.push(id);
    }
    await setLeadStatus(sb, ctx.leadId, "needs_human_review");
    return { foundCandidates: true, stageReached: "brave", candidateIds, openclawDispatched };
  }

  await setLeadStatus(sb, ctx.leadId, "unresolved_after_brave");

  // ── Stage 2: 411 / Directory ──────────────────────────────────────────────
  await logEvent(sb, ctx.leadId, "directory_search_started", "directory_411", {});
  const dirResult = await runDirectorySearch(ctx);
  await logEvent(sb, ctx.leadId, "directory_search_complete", "directory_411", {
    found: dirResult.found,
    candidates: dirResult.found ? dirResult.candidates.length : 0,
    reason: dirResult.found ? undefined : dirResult.reason,
  });

  if (dirResult.found) {
    for (const c of dirResult.candidates) {
      const id = await saveCandidate(sb, ctx, c);
      candidateIds.push(id);
    }
    await setLeadStatus(sb, ctx.leadId, "needs_human_review");
    return { foundCandidates: true, stageReached: "directory_411", candidateIds, openclawDispatched };
  }

  await setLeadStatus(sb, ctx.leadId, "unresolved_after_411");

  // ── Stage 3: Place API ────────────────────────────────────────────────────
  await logEvent(sb, ctx.leadId, "place_api_search_started", "place_api", {});
  const placeResult = await runPlaceApiSearch(ctx);
  await logEvent(sb, ctx.leadId, "place_api_search_complete", "place_api", {
    found: placeResult.found,
    candidates: placeResult.found ? placeResult.candidates.length : 0,
    reason: placeResult.found ? undefined : placeResult.reason,
  });

  if (placeResult.found) {
    for (const c of placeResult.candidates) {
      const id = await saveCandidate(sb, ctx, c);
      candidateIds.push(id);
    }
    await setLeadStatus(sb, ctx.leadId, "needs_human_review");
    return { foundCandidates: true, stageReached: "place_api", candidateIds, openclawDispatched };
  }

  await setLeadStatus(sb, ctx.leadId, "unresolved_after_places");

  // ── Stage 4: OpenClaw deep search (async) ─────────────────────────────────
  await logEvent(sb, ctx.leadId, "openclaw_search_started", "openclaw", {});
  const { dispatched, reason } = await requestOpenclawDeepSearch(ctx);
  openclawDispatched = dispatched;

  await logEvent(sb, ctx.leadId, "openclaw_search_complete", "openclaw", {
    dispatched,
    reason: reason ?? null,
  });

  if (!dispatched) {
    // OpenClaw not configured — mark fully unresolved
    await setLeadStatus(sb, ctx.leadId, "unresolved_after_all_sources");
    await logEvent(sb, ctx.leadId, "unresolved_after_all_sources", null, {
      reason: reason ?? "openclaw not configured",
    });
    return { foundCandidates: false, stageReached: "openclaw", candidateIds, openclawDispatched: false };
  }

  // OpenClaw dispatched — lead stays at unresolved_after_places until callback
  // The callback (POST /api/enrichment/openclaw-callback) will either:
  //   • find candidates → save them → set needs_human_review
  //   • find nothing → set unresolved_after_all_sources
  return { foundCandidates: false, stageReached: "openclaw", candidateIds, openclawDispatched: true };
}
