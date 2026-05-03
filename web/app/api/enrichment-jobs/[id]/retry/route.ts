// POST /api/enrichment-jobs/[id]/retry — admin only.
// Resets a failed/cancelled/success job back to pending and (best-effort) re-fires the webhook.
// Bumps attempts.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const { id } = await ctx.params;

  const sb = createSupabaseAdminClient();
  const { data: jobRaw } = await sb.from("enrichment_jobs").select("*").eq("id", id).single();
  const job = jobRaw as {
    id: string; lead_id: string | null; contact_id: string | null; job_type: string;
    status: string; attempts: number; max_attempts: number;
  } | null;
  if (!job) return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  if (job.status === "processing" || job.status === "pending") {
    return NextResponse.json({ ok: false, error: `Job is ${job.status} — cancel first if you want to retry from a clean slate.` }, { status: 409 });
  }

  await sb.from("enrichment_jobs").update({
    status: "pending",
    attempts: (job.attempts ?? 0) + 1,
    started_at: null,
    completed_at: null,
    error_message: null,
  }).eq("id", id);

  // Best-effort webhook fire
  let webhookCalled = false;
  let webhookError: string | null = null;
  const webhookUrl = process.env.N8N_ENRICHMENT_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (process.env.N8N_SHARED_KEY) headers["Authorization"] = `Bearer ${process.env.N8N_SHARED_KEY}`;
      const r = await fetch(webhookUrl, {
        method: "POST", headers,
        body: JSON.stringify({ enrichment_job_id: id, lead_id: job.lead_id, contact_id: job.contact_id, job_type: job.job_type, retry: true }),
      });
      if (r.ok) {
        webhookCalled = true;
        await sb.from("enrichment_jobs").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", id);
      } else {
        webhookError = `Webhook returned ${r.status}`;
      }
    } catch (err) {
      webhookError = (err as Error).message;
    }
  }

  await sb.from("automation_events").insert({
    source: "web_app", event_type: "enrichment_job_retried",
    status: webhookError ? "partial" : "success",
    related_lead_id: job.lead_id, related_contact_id: job.contact_id,
    triggered_by: user.id,
    payload: { jobId: id, attempts: (job.attempts ?? 0) + 1, webhookCalled, webhookConfigured: !!webhookUrl },
    error_message: webhookError,
  });

  return NextResponse.json({ ok: true, data: { jobId: id, attempts: (job.attempts ?? 0) + 1, webhookCalled, webhookError } });
}
