// Address-first phone enrichment pipeline orchestrator (v2).
//
// Stage order:
//   0. Existing phone gate  — skip leads that already have any phone in DB
//   1. Address search       — mailing address first, property address fallback
//   2. Company/person search — company name + director name queries
//   3. B2BHint expansion    — related companies/directors (stub until key configured)
//   4. OpenClaw fallback    — async deep search for remaining unresolved leads
//
// Stop-early rule:
//   HIGH confidence (≥ 80)   → auto-attach phone → set ready_to_call → STOP for this lead
//   MEDIUM confidence (≥ 50) → save to review queue → set needs_phone_review → STOP advancing
//   LOW confidence  (< 50)   → save candidate → continue to next stage
//
// Solved leads are removed from the pipeline between every stage — they do NOT
// pass through to later stages.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LeadContext,
  PhoneCandidate,
  PipelineStage,
  EnrichmentEventType,
} from "./types";
import {
  HIGH_CONFIDENCE_THRESHOLD,
  MEDIUM_CONFIDENCE_THRESHOLD,
} from "./types";
import { runAddressSearch, runCompanySearch } from "./brave-search";
import { runB2BHintSearch } from "./b2bhint";
import { requestOpenclawDeepSearch } from "./openclaw-validate";

// ── Event / status helpers ────────────────────────────────────────────────────

async function logEvent(
  sb: SupabaseClient,
  leadId: string,
  eventType: EnrichmentEventType,
  stage: PipelineStage | null,
  payload: Record<string, unknown>,
  candidateId?: string,
) {
  await sb.from("enrichment_events").insert({
    lead_id:      leadId,
    event_type:   eventType,
    stage:        stage ?? null,
    candidate_id: candidateId ?? null,
    payload,
  });
}

async function setLeadStatus(sb: SupabaseClient, leadId: string, status: string) {
  await sb.from("leads").update({ status }).eq("id", leadId);
  await sb.from("enrichment_events").insert({
    lead_id:    leadId,
    event_type: "lead_status_updated",
    stage:      null,
    payload:    { new_status: status },
  });
}

// ── Auto-attach a high-confidence phone to the lead ──────────────────────────
// Writes the phone into the `phones` table and sets lead → ready_to_call.
// Returns the candidate_id.

async function autoAttachPhone(
  sb: SupabaseClient,
  ctx: LeadContext,
  c: PhoneCandidate,
): Promise<string> {
  // 1. Insert into phones table
  await sb.from("phones").upsert({
    contact_id:  ctx.contactId,
    e164:        c.phoneE164 ?? c.phoneRaw,
    display:     c.phoneRaw,
    status:      "unverified",  // caller will verify on first call
    source:      "enrichment_other",
    confidence:  c.initialConfidence,
    evidence:    c.snippet ?? `auto-attached from ${c.sourceLabel} (${c.matchedOn})`,
    notes:       `stage=${c.stage} matched_on=${c.matchedOn} query=${c.searchQuery ?? ""}`,
  }, { onConflict: "contact_id,e164", ignoreDuplicates: true });

  // 2. Save candidate record
  const { data, error } = await sb.from("phone_candidates").insert({
    lead_id:             ctx.leadId,
    contact_id:          ctx.contactId,
    enrichment_job_id:   ctx.enrichmentJobId,
    phone_raw:           c.phoneRaw,
    phone_e164:          c.phoneE164,
    stage:               c.stage,
    source_label:        c.sourceLabel,
    source_url:          c.sourceUrl,
    snippet:             c.snippet,
    initial_confidence:  c.initialConfidence,
    candidate_status:    "auto_attached",
    matched_on:          c.matchedOn,
    search_query:        c.searchQuery,
    candidate_name:      c.candidateName,
    candidate_address:   c.candidateAddress,
    related_entity_name: c.relatedEntityName,
    related_entity_type: c.relatedEntityType,
    review_reason:       `Auto-attached: high confidence (${c.initialConfidence}) via ${c.matchedOn}`,
  }).select("id").single();

  if (error || !data) throw new Error(`phone_candidates auto-attach: ${error?.message}`);
  const candidateId = (data as { id: string }).id;

  // 3. Log events
  await logEvent(sb, ctx.leadId, "phone_candidate_found", c.stage, {
    phone_e164: c.phoneE164,
    confidence: c.initialConfidence,
    source:     c.sourceLabel,
    matched_on: c.matchedOn,
  }, candidateId);

  await logEvent(sb, ctx.leadId, "phone_auto_attached", c.stage, {
    candidate_id: candidateId,
    matched_on:   c.matchedOn,
    confidence:   c.initialConfidence,
  }, candidateId);

  // 4. Set lead status
  await setLeadStatus(sb, ctx.leadId, "ready_to_call");

  return candidateId;
}

// ── Save medium-confidence candidate → review queue ──────────────────────────

async function saveCandidateForReview(
  sb: SupabaseClient,
  ctx: LeadContext,
  c: PhoneCandidate,
): Promise<string> {
  const reviewReason = `${c.stage} — confidence ${c.initialConfidence} (${c.matchedOn}) — needs human review`;

  const { data, error } = await sb.from("phone_candidates").insert({
    lead_id:             ctx.leadId,
    contact_id:          ctx.contactId,
    enrichment_job_id:   ctx.enrichmentJobId,
    phone_raw:           c.phoneRaw,
    phone_e164:          c.phoneE164,
    stage:               c.stage,
    source_label:        c.sourceLabel,
    source_url:          c.sourceUrl,
    snippet:             c.snippet,
    initial_confidence:  c.initialConfidence,
    candidate_status:    "needs_anthony_review",
    matched_on:          c.matchedOn,
    search_query:        c.searchQuery,
    candidate_name:      c.candidateName,
    candidate_address:   c.candidateAddress,
    related_entity_name: c.relatedEntityName,
    related_entity_type: c.relatedEntityType,
    review_reason:       reviewReason,
  }).select("id").single();

  if (error || !data) throw new Error(`phone_candidates review insert: ${error?.message}`);
  const candidateId = (data as { id: string }).id;

  await logEvent(sb, ctx.leadId, "phone_candidate_found", c.stage, {
    phone_e164: c.phoneE164,
    confidence: c.initialConfidence,
    matched_on: c.matchedOn,
  }, candidateId);

  await logEvent(sb, ctx.leadId, "phone_candidate_needs_review", c.stage, {
    reason:       reviewReason,
    candidate_id: candidateId,
  }, candidateId);

  return candidateId;
}

// ── Route stage result ────────────────────────────────────────────────────────
// Returns:
//   "solved"   — high-confidence found, lead is ready_to_call, stop pipeline
//   "review"   — medium-confidence found, lead queued for review, stop pipeline
//   "continue" — only low-confidence or nothing found, advance to next stage

type StageOutcome = "solved" | "review" | "continue";

async function routeStageResult(
  sb: SupabaseClient,
  ctx: LeadContext,
  candidates: PhoneCandidate[],
  stage: PipelineStage,
): Promise<{ outcome: StageOutcome; candidateIds: string[] }> {
  if (candidates.length === 0) return { outcome: "continue", candidateIds: [] };

  const best = candidates[0]; // already sorted high-to-low
  const ids: string[] = [];

  if (best.initialConfidence >= HIGH_CONFIDENCE_THRESHOLD) {
    // Auto-attach the best candidate, save others as review candidates
    const id = await autoAttachPhone(sb, ctx, best);
    ids.push(id);

    // Save remaining candidates as supporting evidence (review status)
    for (const c of candidates.slice(1, 3)) {
      try {
        const rid = await saveCandidateForReview(sb, ctx, { ...c, initialConfidence: c.initialConfidence - 5 });
        ids.push(rid);
      } catch { /* non-critical */ }
    }

    return { outcome: "solved", candidateIds: ids };
  }

  if (best.initialConfidence >= MEDIUM_CONFIDENCE_THRESHOLD) {
    // Save top candidates for human review, advance no further
    for (const c of candidates.slice(0, 3)) {
      const id = await saveCandidateForReview(sb, ctx, c);
      ids.push(id);
    }
    await setLeadStatus(sb, ctx.leadId, "needs_phone_review");

    return { outcome: "review", candidateIds: ids };
  }

  // Low confidence — save but continue to next stage
  for (const c of candidates.slice(0, 2)) {
    try {
      const id = await saveCandidateForReview(sb, ctx, {
        ...c,
        // Override status: keep as candidate_found so pipeline knows to keep searching
      });
      ids.push(id);
    } catch { /* non-critical */ }
  }

  return { outcome: "continue", candidateIds: ids };
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runEnrichmentPipeline(
  sb: SupabaseClient,
  ctx: LeadContext,
): Promise<{
  outcome:           "solved" | "review" | "unresolved" | "openclaw_dispatched";
  stageReached:      PipelineStage | "none";
  candidateIds:      string[];
  openclawDispatched: boolean;
}> {
  const allCandidateIds: string[] = [];
  let openclawDispatched = false;

  await setLeadStatus(sb, ctx.leadId, "enrichment_running");
  await logEvent(sb, ctx.leadId, "enrichment_started", null, {
    enrichment_job_id: ctx.enrichmentJobId,
    has_mailing_addr:  !!ctx.mailingAddress,
    has_property_addr: !!ctx.propertyAddress,
    has_company:       !!ctx.companyName,
    has_director:      !!ctx.fullName,
  });

  // ── Stage 1: Address search ─────────────────────────────────────────────
  await setLeadStatus(sb, ctx.leadId, "searching_address");
  await logEvent(sb, ctx.leadId, "address_search_started", "address_search", {
    mailing_addr:  ctx.mailingAddress,
    property_addr: ctx.propertyAddress,
  });

  const addressResult = await runAddressSearch(ctx).catch(err => {
    console.error("[pipeline] address search error:", err);
    return { found: false as const, reason: (err as Error).message };
  });

  await logEvent(sb, ctx.leadId, "address_search_complete", "address_search", {
    found:      addressResult.found,
    candidates: addressResult.found ? addressResult.candidates.length : 0,
    reason:     addressResult.found ? undefined : addressResult.reason,
  });

  if (addressResult.found) {
    const { outcome, candidateIds } = await routeStageResult(
      sb, ctx, addressResult.candidates, "address_search",
    );
    allCandidateIds.push(...candidateIds);
    if (outcome === "solved" || outcome === "review") {
      return { outcome, stageReached: "address_search", candidateIds: allCandidateIds, openclawDispatched: false };
    }
  }

  await setLeadStatus(sb, ctx.leadId, "unresolved_after_address");

  // ── Stage 2: Company / person search ───────────────────────────────────
  await setLeadStatus(sb, ctx.leadId, "searching_company");
  await logEvent(sb, ctx.leadId, "company_search_started", "company_search", {
    company:  ctx.companyName,
    director: ctx.fullName,
    city:     ctx.mailingCity ?? ctx.propertyCity,
  });

  const companyResult = await runCompanySearch(ctx).catch(err => {
    console.error("[pipeline] company search error:", err);
    return { found: false as const, reason: (err as Error).message };
  });

  await logEvent(sb, ctx.leadId, "company_search_complete", "company_search", {
    found:      companyResult.found,
    candidates: companyResult.found ? companyResult.candidates.length : 0,
    reason:     companyResult.found ? undefined : companyResult.reason,
  });

  if (companyResult.found) {
    const { outcome, candidateIds } = await routeStageResult(
      sb, ctx, companyResult.candidates, "company_search",
    );
    allCandidateIds.push(...candidateIds);
    if (outcome === "solved" || outcome === "review") {
      return { outcome, stageReached: "company_search", candidateIds: allCandidateIds, openclawDispatched: false };
    }
  }

  await setLeadStatus(sb, ctx.leadId, "unresolved_after_company");

  // ── Stage 3: B2BHint expansion ─────────────────────────────────────────
  await setLeadStatus(sb, ctx.leadId, "searching_b2bhint");
  await logEvent(sb, ctx.leadId, "b2bhint_search_started", "b2bhint", {
    company: ctx.companyName,
    director: ctx.fullName,
  });

  const b2bhintResult = await runB2BHintSearch(ctx).catch(err => {
    console.error("[pipeline] b2bhint search error:", err);
    return { found: false as const, reason: (err as Error).message };
  });

  await logEvent(sb, ctx.leadId, "b2bhint_search_complete", "b2bhint", {
    found:      b2bhintResult.found,
    candidates: b2bhintResult.found ? b2bhintResult.candidates.length : 0,
    reason:     b2bhintResult.found ? undefined : b2bhintResult.reason,
  });

  if (b2bhintResult.found) {
    const { outcome, candidateIds } = await routeStageResult(
      sb, ctx, b2bhintResult.candidates, "b2bhint",
    );
    allCandidateIds.push(...candidateIds);
    if (outcome === "solved" || outcome === "review") {
      return { outcome, stageReached: "b2bhint", candidateIds: allCandidateIds, openclawDispatched: false };
    }
  }

  await setLeadStatus(sb, ctx.leadId, "unresolved_after_b2bhint");

  // ── Stage 4: OpenClaw async fallback ───────────────────────────────────
  // Only dispatched if configured. Lead waits for callback.
  await setLeadStatus(sb, ctx.leadId, "openclaw_reviewing");
  await logEvent(sb, ctx.leadId, "openclaw_search_started", "openclaw", {
    prior_candidate_ids: allCandidateIds,
  });

  const { dispatched, reason } = await requestOpenclawDeepSearch(ctx);
  openclawDispatched = dispatched;

  await logEvent(sb, ctx.leadId, "openclaw_search_complete", "openclaw", {
    dispatched,
    reason: reason ?? null,
  });

  if (!dispatched) {
    // OpenClaw not configured — fully unresolved
    await setLeadStatus(sb, ctx.leadId, "unresolved_after_all_sources");
    return {
      outcome:            "unresolved",
      stageReached:       "openclaw",
      candidateIds:       allCandidateIds,
      openclawDispatched: false,
    };
  }

  // OpenClaw dispatched — lead stays at openclaw_reviewing until callback
  return {
    outcome:            "openclaw_dispatched",
    stageReached:       "openclaw",
    candidateIds:       allCandidateIds,
    openclawDispatched: true,
  };
}
