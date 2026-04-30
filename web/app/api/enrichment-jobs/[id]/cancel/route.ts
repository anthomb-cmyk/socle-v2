// POST /api/enrichment-jobs/[id]/cancel — admin only.
// Marks a queued or running job as cancelled. n8n is expected to honor the
// cancellation if it polls; otherwise the cancel just stops the CRM from
// expecting more results. Already-arrived results are kept (status=unverified).

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const { id } = await ctx.params;

  const sb = createSupabaseAdminClient();
  const { data: jobRaw } = await sb.from("enrichment_jobs").select("status, lead_id, contact_id").eq("id", id).single();
  const job = jobRaw as { status: string; lead_id: string | null; contact_id: string | null } | null;
  if (!job) return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  if (["success", "failed", "cancelled", "skipped"].includes(job.status)) {
    return NextResponse.json({ ok: false, error: `Already ${job.status}` }, { status: 409 });
  }

  await sb.from("enrichment_jobs").update({
    status: "cancelled",
    completed_at: new Date().toISOString(),
  }).eq("id", id);

  await sb.from("automation_events").insert({
    source: "web_app", event_type: "enrichment_job_cancelled", status: "success",
    related_lead_id: job.lead_id, related_contact_id: job.contact_id,
    triggered_by: user.id, payload: { jobId: id, prior_status: job.status },
  });

  return NextResponse.json({ ok: true });
}
