// OpenClaw — dual role:
//   Role 1: Fallback deep search when all other stages find nothing.
//   Role 2: First-round validation of low-confidence candidates.
//
// OpenClaw is the enrichment n8n workflow (W7 / OpenClaw deeper search).
// It communicates asynchronously: we fire a webhook and it calls back via
// POST /api/enrichment/openclaw-callback.
//
// Required env:
//   OPENCLAW_WEBHOOK_URL   — n8n webhook URL for the OpenClaw workflow
//   N8N_SHARED_KEY         — shared bearer token (reused from existing setup)
//
// If OPENCLAW_WEBHOOK_URL is not set, this module logs a warning and
// returns a "skipped" result so the pipeline degrades gracefully.

import type { LeadContext, OpenclawValidationResult, PhoneCandidate, StageResult } from "./types";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

// ── Role 2: Validate a low-confidence candidate ───────────────────────────
//
// Fires a webhook and immediately returns so the API route is not blocked.
// The OpenClaw workflow calls back asynchronously via POST /api/enrichment/openclaw-callback.
// The candidate stays in status = 'validating_with_openclaw' until the callback arrives.

export async function requestOpenclawValidation(
  candidateId: string,
  candidate: PhoneCandidate,
  ctx: LeadContext,
): Promise<{ dispatched: boolean; reason?: string }> {
  const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL;
  if (!webhookUrl) {
    return {
      dispatched: false,
      reason: "OPENCLAW_WEBHOOK_URL not configured — validation skipped",
    };
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
        mode: "validate",
        candidate_id: candidateId,
        lead_id: ctx.leadId,
        phone_raw: candidate.phoneRaw,
        phone_e164: candidate.phoneE164,
        stage: candidate.stage,
        snippet: candidate.snippet,
        // Full lead context for OpenClaw to do its research
        lead_context: {
          full_name: ctx.fullName,
          company_name: ctx.companyName,
          secondary_name: ctx.secondaryName,
          property_address: ctx.propertyAddress,
          property_city: ctx.propertyCity,
          mailing_address: ctx.mailingAddress,
          mailing_city: ctx.mailingCity,
          mailing_postal: ctx.mailingPostal,
        },
      }),
    });
    if (!res.ok) {
      return { dispatched: false, reason: `OpenClaw webhook ${res.status}` };
    }
    return { dispatched: true };
  } catch (err) {
    return { dispatched: false, reason: (err as Error).message };
  }
}

// ── Role 1: Fallback deep search ──────────────────────────────────────────
//
// Called when Brave, 411, and Place API all found nothing.
// OpenClaw performs its own deep research and calls back via POST /api/enrichment/openclaw-callback.
// The callback handler saves any found candidates and queues them for Anthony review.

export async function requestOpenclawDeepSearch(
  ctx: LeadContext,
): Promise<{ dispatched: boolean; reason?: string }> {
  const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL;
  if (!webhookUrl) {
    return {
      dispatched: false,
      reason: "OPENCLAW_WEBHOOK_URL not configured — deep search skipped",
    };
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
        mode: "deep_search",
        lead_id: ctx.leadId,
        enrichment_job_id: ctx.enrichmentJobId,
        lead_context: {
          full_name: ctx.fullName,
          company_name: ctx.companyName,
          secondary_name: ctx.secondaryName,
          property_address: ctx.propertyAddress,
          property_city: ctx.propertyCity,
          mailing_address: ctx.mailingAddress,
          mailing_city: ctx.mailingCity,
          mailing_postal: ctx.mailingPostal,
          matricule: ctx.matricule,
        },
      }),
    });
    if (!res.ok) {
      return { dispatched: false, reason: `OpenClaw webhook ${res.status}` };
    }
    return { dispatched: true };
  } catch (err) {
    return { dispatched: false, reason: (err as Error).message };
  }
}

// ── Apply OpenClaw validation result ─────────────────────────────────────
// Called by POST /api/enrichment/openclaw-callback when OpenClaw has validated
// a candidate. Updates candidate status and queues for review if appropriate.

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
      reviewReason = "OpenClaw validation: likely match";
      break;
    case "uncertain":
      newStatus = "needs_anthony_review";
      reviewReason = "OpenClaw validation: uncertain — needs human judgement";
      break;
    case "unlikely_match":
      newStatus = "rejected_by_openclaw";
      break;
  }

  await sb.from("phone_candidates").update({
    openclaw_verdict: result.verdict,
    openclaw_confidence: result.confidence,
    openclaw_evidence: result.evidence,
    openclaw_reasoning: result.reasoning,
    candidate_status: newStatus,
    review_reason: reviewReason,
  }).eq("id", candidateId);

  // Log the event
  const { data: cand } = await sb
    .from("phone_candidates")
    .select("lead_id")
    .eq("id", candidateId)
    .single();

  if (cand) {
    const leadId = (cand as { lead_id: string }).lead_id;
    await sb.from("enrichment_events").insert({
      lead_id: leadId,
      event_type: "openclaw_validation_complete",
      stage: "openclaw",
      candidate_id: candidateId,
      payload: {
        verdict: result.verdict,
        confidence: result.confidence,
        new_status: newStatus,
      },
    });

    // If needs review, update the lead status
    if (newStatus === "needs_anthony_review") {
      await sb.from("leads").update({ status: "needs_human_review" }).eq("id", leadId);
      await sb.from("enrichment_events").insert({
        lead_id: leadId,
        event_type: "phone_candidate_needs_review",
        stage: "openclaw",
        candidate_id: candidateId,
        payload: { review_reason: reviewReason },
      });
    }
  }
}
