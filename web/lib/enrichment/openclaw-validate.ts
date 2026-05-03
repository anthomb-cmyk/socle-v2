// OpenClaw — async fallback deep search + candidate validation.
//
// Role 1: Fallback deep search (Stage 4)
//   Called when address, company, and B2BHint searches all found nothing.
//   OpenClaw performs its own deep research and calls back via
//   POST /api/enrichment/openclaw-callback.
//
// Role 2: Candidate validation (low-confidence only)
//   Can be used to validate an uncertain candidate already found.
//   Callback: POST /api/enrichment/openclaw-callback with mode=validate_candidate.
//
// Required env:
//   OPENCLAW_WEBHOOK_URL  — n8n webhook URL for the OpenClaw workflow
//   N8N_SHARED_KEY        — shared bearer token
//
// If OPENCLAW_WEBHOOK_URL is not set, stage is skipped cleanly.

import type { LeadContext, OpenclawValidationResult, PhoneCandidate } from "./types";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

// ── Role 1: Fallback deep search ─────────────────────────────────────────────

export async function requestOpenclawDeepSearch(
  ctx: LeadContext,
): Promise<{ dispatched: boolean; reason?: string }> {
  const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL;
  if (!webhookUrl) {
    return { dispatched: false, reason: "OPENCLAW_WEBHOOK_URL not configured — stage skipped" };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.N8N_SHARED_KEY) {
    headers["Authorization"] = `Bearer ${process.env.N8N_SHARED_KEY}`;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode:               "deep_search",
        lead_id:            ctx.leadId,
        enrichment_job_id:  ctx.enrichmentJobId,
        // Full context for OpenClaw to decide what to search
        lead_context: {
          full_name:        ctx.fullName,
          company_name:     ctx.companyName,
          secondary_name:   ctx.secondaryName,
          property_address: ctx.propertyAddress,
          property_city:    ctx.propertyCity,
          mailing_address:  ctx.mailingAddress,
          mailing_city:     ctx.mailingCity,
          mailing_postal:   ctx.mailingPostal,
          matricule:        ctx.matricule,
        },
        // Tell OpenClaw what was already tried so it doesn't repeat
        stages_exhausted: ["address_search", "company_search", "b2bhint"],
        // OpenClaw must include in callback:
        //   proposed_phone, owner_name, source_url, source_snippet,
        //   confidence, reasoning, human_review_required, entities_searched
        callback_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/enrichment/openclaw-callback`,
      }),
    });
    if (!res.ok) return { dispatched: false, reason: `OpenClaw webhook ${res.status}` };
    return { dispatched: true };
  } catch (err) {
    return { dispatched: false, reason: (err as Error).message };
  }
}

// ── Role 2: Validate a low-confidence candidate ───────────────────────────────

export async function requestOpenclawValidation(
  candidateId: string,
  candidate: PhoneCandidate,
  ctx: LeadContext,
): Promise<{ dispatched: boolean; reason?: string }> {
  const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL;
  if (!webhookUrl) {
    return { dispatched: false, reason: "OPENCLAW_WEBHOOK_URL not configured — validation skipped" };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.N8N_SHARED_KEY) {
    headers["Authorization"] = `Bearer ${process.env.N8N_SHARED_KEY}`;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode:          "validate_candidate",
        candidate_id:  candidateId,
        lead_id:       ctx.leadId,
        phone_raw:     candidate.phoneRaw,
        phone_e164:    candidate.phoneE164,
        stage:         candidate.stage,
        matched_on:    candidate.matchedOn,
        snippet:       candidate.snippet,
        search_query:  candidate.searchQuery,
        lead_context: {
          full_name:        ctx.fullName,
          company_name:     ctx.companyName,
          secondary_name:   ctx.secondaryName,
          property_address: ctx.propertyAddress,
          property_city:    ctx.propertyCity,
          mailing_address:  ctx.mailingAddress,
          mailing_city:     ctx.mailingCity,
          mailing_postal:   ctx.mailingPostal,
        },
      }),
    });
    if (!res.ok) return { dispatched: false, reason: `OpenClaw webhook ${res.status}` };
    return { dispatched: true };
  } catch (err) {
    return { dispatched: false, reason: (err as Error).message };
  }
}

// ── Apply OpenClaw callback result ───────────────────────────────────────────
// Called by POST /api/enrichment/openclaw-callback.
// Updates the candidate status and queues for human review if needed.

export async function applyOpenclawValidation(
  candidateId: string,
  result: OpenclawValidationResult,
): Promise<void> {
  const sb = createSupabaseAdminClient();

  let newStatus: string;
  let reviewReason: string | null = null;

  switch (result.verdict) {
    case "likely_match":
      newStatus = "needs_anthony_review";
      reviewReason = "OpenClaw: likely match — needs human approval before attaching";
      break;
    case "uncertain":
      newStatus = "needs_anthony_review";
      reviewReason = "OpenClaw: uncertain — needs human judgement";
      break;
    case "unlikely_match":
      newStatus = "rejected_by_openclaw";
      break;
  }

  await sb.from("phone_candidates").update({
    openclaw_verdict:    result.verdict,
    openclaw_confidence: result.confidence,
    openclaw_evidence:   result.evidence,
    openclaw_reasoning:  result.reasoning,
    candidate_status:    newStatus,
    review_reason:       reviewReason,
  }).eq("id", candidateId);

  const { data: cand } = await sb
    .from("phone_candidates")
    .select("lead_id")
    .eq("id", candidateId)
    .single();

  if (!cand) return;
  const leadId = (cand as { lead_id: string }).lead_id;

  await sb.from("enrichment_events").insert({
    lead_id:      leadId,
    event_type:   "openclaw_validation_complete",
    stage:        "openclaw",
    candidate_id: candidateId,
    payload: {
      verdict:    result.verdict,
      confidence: result.confidence,
      new_status: newStatus,
    },
  });

  if (newStatus === "needs_anthony_review") {
    await sb.from("leads").update({ status: "needs_phone_review" }).eq("id", leadId);
    await sb.from("enrichment_events").insert({
      lead_id:      leadId,
      event_type:   "phone_candidate_needs_review",
      stage:        "openclaw",
      candidate_id: candidateId,
      payload:      { review_reason: reviewReason },
    });
  }
}
