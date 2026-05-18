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
import {
  APPROVED_CANDIDATE_STATUSES,
  classifyPhoneReviewTrust,
  REJECTED_CANDIDATE_STATUSES,
  REVIEWABLE_CANDIDATE_STATUSES,
  reviewPriorityLabel,
  type ReviewPriority,
} from "@/lib/phone-enrichment/review-trust";

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
  source_url: string | null;
  snippet: string | null;
  openclaw_evidence: string | null;
  openclaw_reasoning: string | null;
  review_reason: string | null;
};

type TrustSourceStat = {
  key: string;
  label: string;
  kind: string;
  total: number;
  needsReview: number;
  weak: number;
  reviewable: number;
  priority: number;
  judgment: number;
  noisy: number;
  approved: number;
  rejected: number;
  avgConfidence: number | null;
};

function buildQualitySummary(candidates: CandidateQualityRow[]) {
  const byPhoneSource = new Map<string, TrustSourceStat & { confidenceSum: number; confidenceCount: number }>();
  const byOwnerLink = new Map<string, TrustSourceStat & { confidenceSum: number; confidenceCount: number }>();
  let reviewable = 0;
  let priorityReviewable = 0;
  let judgmentReviewable = 0;
  let noisyReviewable = 0;

  function applyStat(
    map: Map<string, TrustSourceStat & { confidenceSum: number; confidenceCount: number }>,
    key: string,
    label: string,
    kind: string,
    candidate: CandidateQualityRow,
    priority: ReviewPriority,
  ) {
    const confidence = typeof candidate.initial_confidence === "number" && Number.isFinite(candidate.initial_confidence)
      ? candidate.initial_confidence
      : null;
    const current = map.get(key) ?? {
      key,
      label,
      kind,
      total: 0,
      needsReview: 0,
      weak: 0,
      reviewable: 0,
      priority: 0,
      judgment: 0,
      noisy: 0,
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
    if (REVIEWABLE_CANDIDATE_STATUSES.has(candidate.candidate_status)) {
      current.reviewable++;
      if (priority === "priority") current.priority++;
      if (priority === "judgment") current.judgment++;
      if (priority === "noisy") current.noisy++;
    }
    if (APPROVED_CANDIDATE_STATUSES.has(candidate.candidate_status)) current.approved++;
    if (REJECTED_CANDIDATE_STATUSES.has(candidate.candidate_status)) current.rejected++;
    map.set(key, current);
  }

  for (const candidate of candidates) {
    const classification = classifyPhoneReviewTrust(candidate);
    if (REVIEWABLE_CANDIDATE_STATUSES.has(candidate.candidate_status)) {
      reviewable++;
      if (classification.reviewPriority === "priority") {
        priorityReviewable++;
      } else if (classification.reviewPriority === "noisy") {
        noisyReviewable++;
      } else {
        judgmentReviewable++;
      }
    }

    applyStat(
      byPhoneSource,
      classification.phoneEvidenceSource.key,
      classification.phoneEvidenceSource.label,
      classification.phoneEvidenceSource.kind,
      candidate,
      classification.reviewPriority,
    );
    applyStat(
      byOwnerLink,
      classification.ownerLinkSource.key,
      classification.ownerLinkSource.label,
      classification.ownerLinkSource.key,
      candidate,
      classification.reviewPriority,
    );
  }

  function finalize(map: Map<string, TrustSourceStat & { confidenceSum: number; confidenceCount: number }>) {
    return Array.from(map.values())
      .map(({ confidenceSum: _confidenceSum, confidenceCount: _confidenceCount, ...row }) => ({
        ...row,
        avgConfidence: _confidenceCount > 0 ? Number((_confidenceSum / _confidenceCount).toFixed(1)) : null,
      }))
      .sort((a, b) =>
        (b.reviewable - a.reviewable) ||
        (b.priority - a.priority) ||
        (b.total - a.total) ||
        a.label.localeCompare(b.label),
      )
      .slice(0, 10);
  }

  const priorityCounts = {
    priority: priorityReviewable,
    judgment: judgmentReviewable,
    noisy: noisyReviewable,
  };
  const priorityLabels = {
    priority: reviewPriorityLabel("priority"),
    judgment: reviewPriorityLabel("judgment"),
    noisy: reviewPriorityLabel("noisy"),
  };

  return {
    reviewable,
    priorityReviewable,
    judgmentReviewable,
    noisyReviewable,
    priorityCounts,
    priorityLabels,
    phoneSourceStats: finalize(byPhoneSource),
    ownerLinkStats: finalize(byOwnerLink),
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
          snippet: string | null;
          openclaw_evidence: string | null;
          openclaw_reasoning: string | null;
          review_reason: string | null;
          created_at: string;
        }>(leadIds, (chunk) =>
          sb
          .from("phone_candidates")
          .select("id,lead_id,candidate_status,openclaw_verdict,initial_confidence,source_label,source_class,matched_on,source_url,snippet,openclaw_evidence,openclaw_reasoning,review_reason,created_at")
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
