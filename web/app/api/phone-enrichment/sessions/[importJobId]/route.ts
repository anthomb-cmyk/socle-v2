// GET /api/phone-enrichment/sessions/[importJobId]
// Import-scoped phone enrichment operator summary for the Codex session page.

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { requirePhoneEnrichmentOperator } from "@/lib/phone-enrichment/auth";
import {
  buildRecoverabilitySummary,
  getBudgetStatus,
  getEligibleStartLeadIds,
  getImportLeadIds,
  getOperatorEnabled,
} from "@/lib/phone-enrichment/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ importJobId: string }> };

function countBy<T extends Record<string, unknown>>(rows: T[], field: keyof T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = String(row[field] ?? "unknown");
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function isStaleJob(job: { status: string; created_at: string; started_at: string | null }): boolean {
  const now = Date.now();
  if (job.status === "pending") {
    return now - new Date(job.created_at).getTime() > 30 * 60_000;
  }
  if (job.status === "processing") {
    return now - new Date(job.started_at ?? job.created_at).getTime() > 60 * 60_000;
  }
  return false;
}

export async function GET(request: Request, ctx: RouteCtx) {
  const { importJobId } = await ctx.params;
  const auth = await requirePhoneEnrichmentOperator(request, importJobId);
  if (!auth.ok) return auth.response;

  const sb = createSupabaseAdminClient();

  const { data: importJob, error: importErr } = await sb
    .from("import_jobs")
    .select("id,file_name,status,format_detected,total_rows,created_at,completed_at")
    .eq("id", importJobId)
    .maybeSingle();

  if (importErr) return NextResponse.json({ ok: false, error: importErr.message }, { status: 500 });
  if (!importJob) return NextResponse.json({ ok: false, error: "Import not found" }, { status: 404 });

  const leadIds = await getImportLeadIds(sb, importJobId);
  const eligibleStartLeadIds = await getEligibleStartLeadIds(sb, importJobId);

  const [
    summaryRes,
    queueRes,
    jobsRes,
    candidatesRes,
    actionsRes,
    budget,
    recoverability,
  ] = await Promise.all([
    sb.from("phone_enrichment_import_summary").select("*").eq("import_job_id", importJobId).maybeSingle(),
    leadIds.length > 0
      ? sb
          .from("lead_post_processing_queue")
          .select("id,lead_id,task_type,priority,status,attempts,last_error,scheduled_for,started_at,completed_at,created_at")
          .in("lead_id", leadIds)
          .eq("task_type", "enrichment")
      : Promise.resolve({ data: [], error: null }),
    leadIds.length > 0
      ? sb
          .from("enrichment_jobs")
          .select("id,lead_id,contact_id,job_type,workflow_id,status,attempts,max_attempts,started_at,completed_at,created_at,error_message,raw_output")
          .in("lead_id", leadIds)
          .eq("job_type", "find_phone")
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    leadIds.length > 0
      ? sb
          .from("phone_candidates")
          .select("id,lead_id,candidate_status,openclaw_verdict,initial_confidence,source_label,source_url,review_reason,created_at")
          .in("lead_id", leadIds)
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    sb
      .from("automation_events")
      .select("id,event_type,status,payload,result,error_message,occurred_at")
      .eq("related_import_id", importJobId)
      .eq("actor_kind", "codex")
      .order("occurred_at", { ascending: false })
      .limit(100),
    getBudgetStatus(sb, importJobId),
    buildRecoverabilitySummary(sb, importJobId),
  ]);

  if (summaryRes.error) return NextResponse.json({ ok: false, error: summaryRes.error.message }, { status: 500 });
  if (queueRes.error) return NextResponse.json({ ok: false, error: queueRes.error.message }, { status: 500 });
  if (jobsRes.error) return NextResponse.json({ ok: false, error: jobsRes.error.message }, { status: 500 });
  if (candidatesRes.error) return NextResponse.json({ ok: false, error: candidatesRes.error.message }, { status: 500 });
  if (actionsRes.error) return NextResponse.json({ ok: false, error: actionsRes.error.message }, { status: 500 });

  const jobs = (jobsRes.data ?? []) as Array<{
    id: string;
    lead_id: string | null;
    workflow_id: string | null;
    status: string;
    attempts: number;
    max_attempts: number;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    error_message: string | null;
    raw_output: unknown;
  }>;
  const queueRows = (queueRes.data ?? []) as Array<{ status: string }>;
  const candidates = (candidatesRes.data ?? []) as Array<{ candidate_status: string }>;
  const staleJobs = jobs.filter(isStaleJob).slice(0, 25);

  return NextResponse.json({
    ok: true,
    data: {
      import: importJob,
      operator: {
        enabled: getOperatorEnabled(),
        disabledReason: getOperatorEnabled() ? null : "SOCLE_CODEX_OPERATOR_ENABLED is not true",
      },
      summary: summaryRes.data,
      budget,
      canStart: eligibleStartLeadIds.length > 0,
      eligibleStartLeadCount: eligibleStartLeadIds.length,
      counts: {
        leads: leadIds.length,
        queueByStatus: countBy(queueRows, "status"),
        jobsByStatus: countBy(jobs, "status"),
        candidatesByStatus: countBy(candidates, "candidate_status"),
        staleJobs: staleJobs.length,
      },
      staleJobs,
      actions: actionsRes.data ?? [],
      recoverability,
    },
  });
}
