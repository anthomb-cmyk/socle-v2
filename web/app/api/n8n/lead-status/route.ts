// POST /api/n8n/lead-status
//
// n8n updates a lead's pipeline status (enrichment stages, etc.)
// Auth: Bearer ${N8N_SHARED_KEY}
//
// Body:
//   lead_id:              uuid (required)
//   status:               lead_status value (required)
//   enrichment_job_id?:   uuid — marks the associated job completed/failed
//   job_outcome?:         'success' | 'failed' | 'no_result'

import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const ALL_LEAD_STATUSES = [
  "new", "enriching", "needs_enrichment", "ready_to_call",
  "brave_queued", "unresolved_after_brave",
  "directory_411_queued", "unresolved_after_411",
  "places_queued", "unresolved_after_places",
  "openclaw_queued", "needs_human_review", "no_contact_found",
  "in_outreach", "meeting_set", "qualified", "no_answer", "rejected", "do_not_contact",
] as const;

const Body = z.object({
  lead_id: z.string().uuid(),
  status: z.enum(ALL_LEAD_STATUSES),
  enrichment_job_id: z.string().uuid().optional(),
  job_outcome: z.enum(["success", "failed", "no_result"]).optional(),
});

export async function POST(request: Request) {
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

  const sb = createSupabaseAdminClient();

  const { error: leadErr } = await sb.from("leads")
    .update({ status: body.status, updated_at: new Date().toISOString() })
    .eq("id", body.lead_id);
  if (leadErr) return NextResponse.json({ ok: false, error: leadErr.message }, { status: 500 });

  // Optionally update the enrichment job
  if (body.enrichment_job_id && body.job_outcome) {
    const jobStatus = body.job_outcome === "success" ? "success"
      : body.job_outcome === "no_result" ? "completed"
      : "failed";
    await sb.from("enrichment_jobs")
      .update({ status: jobStatus, completed_at: new Date().toISOString() })
      .eq("id", body.enrichment_job_id);
  }

  await sb.from("automation_events").insert({
    source: "n8n",
    event_type: "lead_status_updated",
    status: "success",
    related_lead_id: body.lead_id,
    payload: { new_status: body.status, enrichment_job_id: body.enrichment_job_id ?? null },
  });

  return NextResponse.json({ ok: true });
}
