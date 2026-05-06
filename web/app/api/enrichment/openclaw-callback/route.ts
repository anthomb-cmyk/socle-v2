// POST /api/enrichment/openclaw-callback
//
// Receives async results from the OpenClaw n8n workflow.
// Two modes (determined by body.mode):
//
//   "validation"  — OpenClaw validated a low-confidence candidate.
//                   Updates phone_candidates status based on verdict.
//
//   "deep_search" — OpenClaw completed a deep search fallback.
//                   Saves new phone candidates and routes them to review.
//
// Auth: Bearer ${N8N_SHARED_KEY}

import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { applyOpenclawValidation } from "@/lib/enrichment/openclaw-validate";
import { extractPhonesFromValue } from "@/lib/role-parser/phone-utils";
import type { OpenclawValidationResult } from "@/lib/enrichment/types";

const VerdictEnum = z.enum(["likely_match", "unlikely_match", "uncertain"]);

const ValidationBody = z.object({
  mode: z.literal("validation"),
  candidate_id: z.string().uuid(),
  verdict: VerdictEnum,
  confidence: z.number().min(0).max(100),
  evidence: z.string().default(""),
  reasoning: z.string().default(""),
});

const CandidateInput = z.object({
  phone_raw: z.string(),
  source_label: z.string().default("openclaw"),
  source_url: z.string().url().optional(),
  snippet: z.string().optional(),
  confidence: z.number().min(0).max(100).default(65),
});

const DeepSearchBody = z.object({
  mode: z.literal("deep_search"),
  lead_id: z.string().uuid(),
  enrichment_job_id: z.string().uuid().optional(),
  candidates: z.array(CandidateInput).max(5),
  reasoning_summary: z.string().optional(),
});

const Body = z.discriminatedUnion("mode", [ValidationBody, DeepSearchBody]);

// Back-compat: older W8 versions sent `phone_candidates` instead of `candidates`.
// Normalize the inbound body before Zod parse so either key works.
function normalizeBody(raw: unknown): unknown {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (r.mode === "deep_search" && r.candidates === undefined && Array.isArray(r.phone_candidates)) {
      return { ...r, candidates: r.phone_candidates };
    }
  }
  return raw;
}

export async function POST(request: Request) {
  // Auth: if N8N_SHARED_KEY is set, require matching Bearer token.
  // If not set, accept the request — the middleware already exempts this route
  // and network-level access is restricted to trusted callers.
  // This allows the system to function during initial setup / before the key is configured.
  const expected = process.env.N8N_SHARED_KEY;
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (expected && provided !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try { body = Body.parse(normalizeBody(await request.json())); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const sb = createSupabaseAdminClient();

  // ── Mode: validation ──────────────────────────────────────────────────────
  if (body.mode === "validation") {
    const result: OpenclawValidationResult = {
      verdict: body.verdict,
      confidence: body.confidence,
      evidence: body.evidence,
      reasoning: body.reasoning,
    };
    await applyOpenclawValidation(body.candidate_id, result);
    return NextResponse.json({ ok: true, data: { mode: "validation", candidateId: body.candidate_id, verdict: body.verdict } });
  }

  // ── Mode: deep_search ─────────────────────────────────────────────────────
  const { lead_id: leadId, enrichment_job_id: jobId, candidates, reasoning_summary } = body;

  // Log the callback received event (used by /admin/test health check)
  await sb.from("enrichment_events").insert({
    lead_id:    leadId,
    event_type: "openclaw_callback_received",
    stage:      "openclaw",
    payload:    { candidate_count: candidates?.length ?? 0, job_id: jobId ?? null },
  });

  if (candidates.length === 0) {
    // OpenClaw found nothing — mark lead fully unresolved.
    // The lead may already be openclaw_researching (force-openclaw set it), but we
    // overwrite unconditionally because OpenClaw has now spoken and produced no result.
    await sb.from("leads").update({ status: "unresolved_after_openclaw" }).eq("id", leadId);
    await sb.from("enrichment_events").insert({
      lead_id: leadId,
      event_type: "unresolved_after_openclaw",
      stage: "openclaw",
      payload: { reasoning_summary: reasoning_summary ?? null, source: "openclaw_callback" },
    });
    if (jobId) {
      await sb.from("enrichment_jobs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        raw_output: {
          outcome: "no_result",
          candidates: 0,
          reasoning_summary: reasoning_summary ?? "",
        },
      }).eq("id", jobId);
    }
    await sb.from("automation_events").insert({
      source: "n8n",
      event_type: "openclaw_callback_received",
      status: "success",
      related_lead_id: leadId,
      payload: { mode: "deep_search", outcome: "no_result", candidates: 0, job_id: jobId ?? null, reasoning_summary: reasoning_summary ?? "" },
    });
    return NextResponse.json({ ok: true, data: { mode: "deep_search", found: false, outcome: "no_result" } });
  }

  // Load contact_id for this lead
  const { data: leadRow } = await sb.from("leads").select("contact_id").eq("id", leadId).single();
  const contactId = (leadRow as { contact_id: string } | null)?.contact_id ?? null;

  const savedIds: string[] = [];

  for (const c of candidates) {
    const e164List = extractPhonesFromValue(c.phone_raw);
    const phoneE164 = e164List.length > 0 ? e164List[0] : null;

    const { data: row } = await sb.from("phone_candidates").insert({
      lead_id: leadId,
      contact_id: contactId,
      enrichment_job_id: jobId ?? null,
      phone_raw: c.phone_raw,
      phone_e164: phoneE164,
      stage: "openclaw",
      source_label: c.source_label,
      source_url: c.source_url ?? null,
      snippet: c.snippet ?? null,
      initial_confidence: c.confidence,
      candidate_status: "needs_anthony_review",
      review_reason: `OpenClaw deep search — confidence ${c.confidence}`,
    }).select("id").single();

    if (row) {
      const candidateId = (row as { id: string }).id;
      savedIds.push(candidateId);
      await sb.from("enrichment_events").insert({
        lead_id: leadId,
        event_type: "phone_candidate_found",
        stage: "openclaw",
        candidate_id: candidateId,
        payload: { phone_e164: phoneE164, confidence: c.confidence },
      });
      await sb.from("enrichment_events").insert({
        lead_id: leadId,
        event_type: "phone_candidate_needs_review",
        stage: "openclaw",
        candidate_id: candidateId,
        payload: { reason: "openclaw_deep_search" },
      });
    }
  }

  // Update lead status to needs_phone_review
  await sb.from("leads").update({ status: "needs_phone_review" }).eq("id", leadId);

  if (jobId) {
    await sb.from("enrichment_jobs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      raw_output: {
        outcome: "candidates_found",
        candidates: savedIds.length,
        reasoning_summary: reasoning_summary ?? "",
      },
    }).eq("id", jobId);
  }

  await sb.from("automation_events").insert({
    source: "n8n",
    event_type: "openclaw_callback_received",
    status: "success",
    related_lead_id: leadId,
    payload: { mode: "deep_search", outcome: "candidates_found", candidates: savedIds.length, candidateIds: savedIds, job_id: jobId ?? null, reasoning_summary: reasoning_summary ?? "" },
  });

  return NextResponse.json({
    ok: true,
    data: { mode: "deep_search", found: true, savedCandidates: savedIds.length, candidateIds: savedIds, outcome: "candidates_found" },
  });
}
