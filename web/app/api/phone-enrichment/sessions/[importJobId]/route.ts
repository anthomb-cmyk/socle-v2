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
  queryLeadIdChunks,
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

type CandidateQualityRow = {
  candidate_status: string;
  initial_confidence: number | null;
  source_label: string | null;
  source_class: string | null;
  matched_on: string | null;
  openclaw_verdict: string | null;
};

type SourceQualityStat = {
  key: string;
  label: string;
  sourceLabel: string | null;
  sourceClass: string | null;
  matchedOn: string | null;
  total: number;
  needsReview: number;
  weak: number;
  reviewable: number;
  highSignal: number;
  approved: number;
  rejected: number;
  avgConfidence: number | null;
};

const REVIEWABLE_STATUSES = new Set(["needs_anthony_review", "weak_review"]);
const APPROVED_STATUSES = new Set(["approved_by_anthony", "approved_by_codex", "auto_attached"]);
const REJECTED_STATUSES = new Set([
  "rejected_by_openclaw",
  "rejected_by_anthony",
  "rejected_by_codex",
  "pipeline_rejected",
  "quarantined",
]);
const HIGH_SIGNAL_SOURCES = new Set([
  "req_phone",
  "req_address_lookup",
  "name_postal_directory",
  "company_website",
  "pages_jaunes_business",
]);
const HIGH_SIGNAL_CLASSES = new Set(["directory_authoritative", "company_website"]);

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function qualityKey(row: CandidateQualityRow): string {
  return [
    row.source_label ?? "unknown_source",
    row.source_class ?? "unknown_class",
    row.matched_on ?? "unknown_match",
  ].join("|");
}

function qualityLabel(row: CandidateQualityRow): string {
  return row.source_label ?? row.source_class ?? row.matched_on ?? "source inconnue";
}

function isHighSignal(row: CandidateQualityRow): boolean {
  const confidence = toFiniteNumber(row.initial_confidence) ?? 0;
  return (
    REVIEWABLE_STATUSES.has(row.candidate_status) &&
    (
      confidence >= 70 ||
      HIGH_SIGNAL_SOURCES.has(row.source_label ?? "") ||
      HIGH_SIGNAL_CLASSES.has(row.source_class ?? "") ||
      row.openclaw_verdict === "likely_match"
    )
  );
}

function buildQualitySummary(candidates: CandidateQualityRow[]) {
  const bySource = new Map<string, SourceQualityStat & { confidenceSum: number; confidenceCount: number }>();
  let reviewable = 0;
  let highSignalReviewable = 0;
  let weakHighSignal = 0;
  let needsReviewHighSignal = 0;

  for (const candidate of candidates) {
    const key = qualityKey(candidate);
    const confidence = toFiniteNumber(candidate.initial_confidence);
    const current = bySource.get(key) ?? {
      key,
      label: qualityLabel(candidate),
      sourceLabel: candidate.source_label,
      sourceClass: candidate.source_class,
      matchedOn: candidate.matched_on,
      total: 0,
      needsReview: 0,
      weak: 0,
      reviewable: 0,
      highSignal: 0,
      approved: 0,
      rejected: 0,
      avgConfidence: null,
      confidenceSum: 0,
      confidenceCount: 0,
    };

    current.total++;
    if (confidence !== null) {
      current.confidenceSum += confidence;
      current.confidenceCount++;
    }
    if (candidate.candidate_status === "needs_anthony_review") current.needsReview++;
    if (candidate.candidate_status === "weak_review") current.weak++;
    if (REVIEWABLE_STATUSES.has(candidate.candidate_status)) {
      current.reviewable++;
      reviewable++;
    }
    if (APPROVED_STATUSES.has(candidate.candidate_status)) current.approved++;
    if (REJECTED_STATUSES.has(candidate.candidate_status)) current.rejected++;
    if (isHighSignal(candidate)) {
      current.highSignal++;
      highSignalReviewable++;
      if (candidate.candidate_status === "weak_review") weakHighSignal++;
      if (candidate.candidate_status === "needs_anthony_review") needsReviewHighSignal++;
    }
    bySource.set(key, current);
  }

  const sourceStats = Array.from(bySource.values())
    .map(({ confidenceSum: _confidenceSum, confidenceCount: _confidenceCount, ...row }) => ({
      ...row,
      avgConfidence: _confidenceCount > 0 ? Number((_confidenceSum / _confidenceCount).toFixed(1)) : null,
    }))
    .sort((a, b) =>
      (b.reviewable - a.reviewable) ||
      (b.highSignal - a.highSignal) ||
      (b.total - a.total) ||
      a.label.localeCompare(b.label),
    )
    .slice(0, 10);

  return {
    reviewable,
    highSignalReviewable,
    weakHighSignal,
    needsReviewHighSignal,
    sourceStats,
  };
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
    queueRows,
    jobs,
    candidates,
    actionsRes,
    budget,
    recoverability,
  ] = await Promise.all([
    sb.from("phone_enrichment_import_summary").select("*").eq("import_job_id", importJobId).maybeSingle(),
    leadIds.length > 0
      ? queryLeadIdChunks<{
          id: string;
          lead_id: string;
          task_type: string;
          priority: number | null;
          status: string;
          attempts: number;
          last_error: string | null;
          scheduled_for: string;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        }>(leadIds, (chunk) =>
          sb
          .from("lead_post_processing_queue")
          .select("id,lead_id,task_type,priority,status,attempts,last_error,scheduled_for,started_at,completed_at,created_at")
          .in("lead_id", chunk)
          .eq("task_type", "enrichment"),
        )
      : Promise.resolve([]),
    leadIds.length > 0
      ? queryLeadIdChunks<{
          id: string;
          lead_id: string | null;
          contact_id: string | null;
          job_type: string;
          workflow_id: string | null;
          status: string;
          attempts: number;
          max_attempts: number;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          error_message: string | null;
          raw_output: unknown;
        }>(leadIds, (chunk) =>
          sb
          .from("enrichment_jobs")
          .select("id,lead_id,contact_id,job_type,workflow_id,status,attempts,max_attempts,started_at,completed_at,created_at,error_message,raw_output")
          .in("lead_id", chunk)
          .eq("job_type", "find_phone")
          .order("created_at", { ascending: false }),
        )
      : Promise.resolve([]),
    leadIds.length > 0
      ? queryLeadIdChunks<{
          id: string;
          lead_id: string;
          candidate_status: string;
          openclaw_verdict: string | null;
          initial_confidence: number | null;
          source_label: string | null;
          source_class: string | null;
          matched_on: string | null;
          source_url: string | null;
          review_reason: string | null;
          created_at: string;
        }>(leadIds, (chunk) =>
          sb
          .from("phone_candidates")
          .select("id,lead_id,candidate_status,openclaw_verdict,initial_confidence,source_label,source_class,matched_on,source_url,review_reason,created_at")
          .in("lead_id", chunk)
          .order("created_at", { ascending: false })
          .limit(500),
        )
      : Promise.resolve([]),
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
  if (actionsRes.error) return NextResponse.json({ ok: false, error: actionsRes.error.message }, { status: 500 });

  jobs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  candidates.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const staleJobs = jobs.filter(isStaleJob).slice(0, 25);
  const quality = buildQualitySummary(candidates);

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
      quality,
    },
  });
}
