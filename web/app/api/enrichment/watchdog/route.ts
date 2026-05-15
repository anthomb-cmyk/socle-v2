// POST /api/enrichment/watchdog?minutes=10
//
// Admin-only timeout watchdog. Scans enrichment_jobs for OpenClaw / AI second-pass jobs
// (workflow_id ILIKE '%openclaw%' OR '%ai_second_pass%') that have been status='processing' for
// longer than `minutes` (default 10, max 720). For each:
//   - sets job.status = 'failed', completed_at = now,
//     error_message = 'no_callback_timeout: ...',
//     raw_output = { outcome: 'no_callback_timeout', ... }
//   - if the lead is still 'openclaw_researching', sets it to
//     'unresolved_after_openclaw' (won't clobber user-driven updates)
//   - inserts an enrichment_events row tagged source='watchdog'
// Writes a single automation_events summary row for the run.
//
// Safe to call repeatedly. Idempotent: a job already 'failed'/'completed'
// is not touched.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const url = new URL(request.url);
  const minStr = url.searchParams.get("minutes") ?? "10";
  const parsed = parseInt(minStr, 10);
  const cutoffMin = Math.max(1, Math.min(720, Number.isFinite(parsed) ? parsed : 10));
  const cutoff = new Date(Date.now() - cutoffMin * 60_000).toISOString();

  const sb = createSupabaseAdminClient();

  const { data: stuck, error: stuckErr } = await sb
    .from("enrichment_jobs")
    .select("id, lead_id, workflow_id, started_at, created_at")
    .eq("status", "processing")
    .or("workflow_id.ilike.%openclaw%,workflow_id.ilike.%ai_second_pass%")
    .lt("started_at", cutoff);

  if (stuckErr) {
    return NextResponse.json({ ok: false, error: stuckErr.message }, { status: 500 });
  }

  const jobs = (stuck ?? []) as Array<{
    id: string;
    lead_id: string | null;
    workflow_id: string | null;
    started_at: string;
    created_at: string;
  }>;

  const failedJobs: string[] = [];
  const now = new Date().toISOString();

  for (const j of jobs) {
    const errMsg = `no_callback_timeout: enrichment workflow did not complete within ${cutoffMin} min`;
    await sb.from("enrichment_jobs").update({
      status:        "failed",
      completed_at:  now,
      error_message: errMsg,
      raw_output:    {
        outcome:           "no_callback_timeout",
        stuck_for_minutes: cutoffMin,
        cleared_by:        "watchdog",
        started_at:        j.started_at,
      },
    }).eq("id", j.id);

    if (j.lead_id) {
      // Only update lead if still in openclaw_researching — don't clobber
      // a status the user may have manually set in the meantime.
      await sb.from("leads")
        .update({ status: "unresolved_after_openclaw" })
        .eq("id", j.lead_id)
        .eq("status", "openclaw_researching");

      await sb.from("enrichment_events").insert({
        lead_id:    j.lead_id,
        event_type: "unresolved_after_openclaw",
        stage:      "openclaw",
        payload:    {
          reason:           "no_callback_timeout",
          source:           "watchdog",
          cutoff_minutes:   cutoffMin,
          job_id:           j.id,
          started_at:       j.started_at,
        },
      });
    }

    failedJobs.push(j.id);
  }

  await sb.from("automation_events").insert({
    source:       "web_app",
    event_type:   "openclaw_watchdog_run",
    status:       jobs.length > 0 ? "partial" : "success",
    triggered_by: user.id,
    payload:      {
      jobs_timed_out: jobs.length,
      cutoff_minutes: cutoffMin,
      jobIds:         failedJobs,
    },
  });

  return NextResponse.json({
    ok: true,
    data: {
      timed_out:      jobs.length,
      cutoff_minutes: cutoffMin,
      jobIds:         failedJobs,
    },
  });
}

// GET also supported as a convenience (admin browsers can hit it directly).
export async function GET(request: Request) {
  return POST(request);
}
