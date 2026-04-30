// POST /api/n8n/enrichment-result
//
// n8n posts back a single result from a phone/email/website/owner_identity
// search. We NEVER overwrite primary records here — every result lands as an
// `enrichment_results` row in status='unverified', and Anthony approves it
// via /leads/[id] (or /review).
//
// Auth: Bearer ${N8N_SHARED_KEY} (or open in dev).
//
// Body:
//   enrichment_job_id?: uuid
//   lead_id?:           uuid
//   contact_id?:        uuid (required if lead_id missing)
//   result_type:        'phone' | 'email' | 'website' | 'owner_identity'
//                       | 'property_fact' | 'note'
//   value:              string
//   source?:            free-text (e.g. 'brave', 'google_places', 'pages_jaunes')
//   source_url?:        url
//   confidence?:        0..100 (default 50)
//   evidence?:          string
//   raw_payload?:       any

import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const RESULT_TYPES = ["phone", "email", "website", "owner_identity", "property_fact", "note"] as const;

const Body = z.object({
  enrichment_job_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  result_type: z.enum(RESULT_TYPES),
  value: z.string().min(1),
  source: z.string().default("n8n"),
  source_url: z.string().url().optional(),
  confidence: z.number().min(0).max(100).optional(),
  evidence: z.string().optional(),
  raw_payload: z.unknown().optional(),
});

export async function POST(request: Request) {
  // Auth
  const expected = process.env.N8N_SHARED_KEY;
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (expected) {
    if (provided !== expected) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "N8N_SHARED_KEY not configured" }, { status: 500 });
  }

  let body;
  try { body = Body.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  if (!body.lead_id && !body.contact_id) {
    return NextResponse.json({ ok: false, error: "Either lead_id or contact_id is required" }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();

  // Resolve contact_id from lead if not provided
  let contactId = body.contact_id ?? null;
  if (!contactId && body.lead_id) {
    const { data } = await sb.from("leads").select("contact_id").eq("id", body.lead_id).single();
    contactId = (data as { contact_id: string } | null)?.contact_id ?? null;
  }

  // Insert result. Always status='unverified' — approval happens elsewhere.
  const { data: rowRes, error } = await sb.from("enrichment_results").insert({
    contact_id: contactId,
    lead_id: body.lead_id ?? null,
    kind: body.result_type,
    value: body.value,
    source: body.source,
    source_url: body.source_url ?? null,
    confidence: body.confidence ?? 50,
    evidence: body.evidence ?? null,
    raw_payload: body.raw_payload ?? null,
    status: "unverified",
    found_in_job_id: body.enrichment_job_id ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const resultId = (rowRes as { id: string }).id;

  // If this came from a job, advance the job (if not already terminal)
  if (body.enrichment_job_id) {
    const { data: jobRow } = await sb.from("enrichment_jobs").select("status").eq("id", body.enrichment_job_id).single();
    const jobStatus = (jobRow as { status: string } | null)?.status;
    if (jobStatus && !["success", "failed", "skipped", "cancelled"].includes(jobStatus)) {
      await sb.from("enrichment_jobs").update({
        status: "success",
        completed_at: new Date().toISOString(),
      }).eq("id", body.enrichment_job_id);
    }
  }

  await sb.from("automation_events").insert({
    source: "n8n",
    event_type: "enrichment_result_received",
    status: "success",
    related_lead_id: body.lead_id ?? null,
    related_contact_id: contactId,
    payload: {
      enrichment_job_id: body.enrichment_job_id ?? null,
      result_type: body.result_type,
      value: body.value,
      source: body.source,
      confidence: body.confidence ?? 50,
    },
    result: { resultId },
  });

  return NextResponse.json({ ok: true, data: { resultId, status: "unverified" } });
}
