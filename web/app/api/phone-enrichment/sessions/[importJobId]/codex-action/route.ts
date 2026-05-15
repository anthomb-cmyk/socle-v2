// POST /api/phone-enrichment/sessions/[importJobId]/codex-action
// Single gated write path for Phase 1 Codex phone-enrichment operator actions.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { requirePhoneEnrichmentOperator, touchCodexSession } from "@/lib/phone-enrichment/auth";
import { extractPhonesFromValue, formatDisplay } from "@/lib/role-parser/phone-utils";
import {
  assertBudgetCanSpend,
  buildReviewProposal,
  estimatePhoneEnrichmentAiCostUsd,
  getBudgetStatus,
  getEligibleStartLeadIds,
  getImportLeadIds,
  getOperatorEnabled,
  leadBelongsToImport,
  type CodexActionType,
} from "@/lib/phone-enrichment/session";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const ACTION_TYPES = [
  "start_enrichment",
  "retry_enrichment_job",
  "mark_stale_jobs_failed",
  "propose_review_decisions",
  "apply_trusted_review_decisions",
] as const;

const Body = z.object({
  action_type: z.enum(ACTION_TYPES),
  payload: z.record(z.unknown()).default({}),
  idempotency_key: z.string().trim().min(1).max(200).optional(),
  dry_run: z.boolean().optional(),
}).strict();

type RouteCtx = { params: Promise<{ importJobId: string }> };

type AnyRecord = Record<string, unknown>;

function jsonError(error: string, status = 400, code = "bad_request") {
  return NextResponse.json({ ok: false, error, code }, { status });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeMinutes(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 10);
  return Math.max(1, Math.min(720, Number.isFinite(n) ? Math.round(n) : 10));
}

function keyPart(value: string | null | undefined): string {
  return value?.trim() || "__unknown__";
}

function getAutoReviewEnabled(): boolean {
  return (process.env.SOCLE_CODEX_AUTO_REVIEW_ENABLED ?? "").toLowerCase() === "true";
}

async function findPriorAction(
  sb: ReturnType<typeof createSupabaseAdminClient>,
  importJobId: string,
  idempotencyKey: string | undefined,
) {
  if (!idempotencyKey) return null;
  const { data, error } = await sb
    .from("automation_events")
    .select("id,event_type,status,payload,result,error_message,occurred_at")
    .eq("related_import_id", importJobId)
    .eq("actor_kind", "codex")
    .eq("event_type", "codex_action")
    .order("occurred_at", { ascending: false })
    .limit(250);

  if (error) throw new Error(error.message);
  return (data ?? []).find((row: { payload?: unknown }) => {
    const payload = (row.payload ?? {}) as { codex?: { idempotency_key?: string } };
    return payload.codex?.idempotency_key === idempotencyKey;
  }) ?? null;
}

async function logCodexAction(input: {
  sb: ReturnType<typeof createSupabaseAdminClient>;
  importJobId: string;
  userId: string | null;
  actionType: CodexActionType;
  idempotencyKey?: string;
  status?: "success" | "partial" | "failed";
  beforeState?: unknown;
  afterState?: unknown;
  reversible: boolean;
  undoPayload?: unknown;
  validation: AnyRecord;
  result: unknown;
  errorMessage?: string | null;
}) {
  const { data, error } = await input.sb
    .from("automation_events")
    .insert({
      source: "web_app",
      actor_kind: "codex",
      event_type: "codex_action",
      status: input.status ?? "success",
      related_import_id: input.importJobId,
      triggered_by: input.userId,
      payload: {
        codex: {
          action_type: input.actionType,
          before_state: input.beforeState ?? null,
          after_state: input.afterState ?? null,
          reversible: input.reversible,
          undo_payload: input.undoPayload ?? null,
          idempotency_key: input.idempotencyKey ?? null,
          validation: input.validation,
        },
      },
      result: input.result,
      error_message: input.errorMessage ?? null,
    })
    .select("id,occurred_at")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function callInternal(request: Request, path: string, body?: unknown) {
  const cookie = request.headers.get("cookie") ?? "";
  const res = await fetch(new URL(path, request.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? `Internal ${path} returned ${res.status}`);
  }
  return json;
}

async function startEnrichment(
  request: Request,
  sb: ReturnType<typeof createSupabaseAdminClient>,
  importJobId: string,
  dryRun: boolean,
  budget: Awaited<ReturnType<typeof getBudgetStatus>>,
) {
  const leadIds = await getEligibleStartLeadIds(sb, importJobId);
  const estimatedAiCostUsd = estimatePhoneEnrichmentAiCostUsd(leadIds.length);
  const budgetCheck = assertBudgetCanSpend(budget, estimatedAiCostUsd);
  const validation = {
    import_scoped: true,
    eligible_leads: leadIds.length,
    endpoint: "/api/enrichment-jobs/batch",
    estimated_ai_cost_usd: estimatedAiCostUsd,
    budget_check: budgetCheck,
  };

  if (dryRun) {
    return { beforeState: { leadIds }, afterState: null, validation, result: { dryRun: true, leadCount: leadIds.length } };
  }

  if (!budgetCheck.ok) {
    throw new Error(budgetCheck.error);
  }

  if (leadIds.length === 0) {
    return { beforeState: { leadIds }, afterState: { skipped: true }, validation, result: { counts: { created: 0, skipped: 0, failed: 0 }, results: [] } };
  }

  const result = await callInternal(request, "/api/enrichment-jobs/batch", {
    leadIds,
    jobType: "find_phone",
    force: false,
  });

  return {
    beforeState: { leadIds },
    afterState: result.data ?? result,
    validation,
    result: result.data ?? result,
  };
}

async function retryJob(
  request: Request,
  sb: ReturnType<typeof createSupabaseAdminClient>,
  importJobId: string,
  payload: AnyRecord,
  dryRun: boolean,
  budget: Awaited<ReturnType<typeof getBudgetStatus>>,
) {
  const jobId = payload.jobId;
  if (!isUuid(jobId)) throw new Error("payload.jobId must be a UUID.");

  const { data: job, error } = await sb
    .from("enrichment_jobs")
    .select("id,lead_id,contact_id,status,attempts,max_attempts,workflow_id,error_message,raw_output")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("Job not found.");

  const row = job as { id: string; lead_id: string | null; status: string; attempts: number; max_attempts: number };
  if (!(await leadBelongsToImport(sb, row.lead_id, importJobId))) {
    throw new Error("Job does not belong to this import.");
  }
  if (row.status === "pending" || row.status === "processing") {
    throw new Error(`Job is ${row.status}; it is not retryable.`);
  }
  if ((row.attempts ?? 0) >= (row.max_attempts ?? 3)) {
    throw new Error("Job has reached max_attempts.");
  }

  const estimatedAiCostUsd = estimatePhoneEnrichmentAiCostUsd(1);
  const budgetCheck = assertBudgetCanSpend(budget, estimatedAiCostUsd);
  const validation = {
    import_scoped: true,
    retryable_status: row.status,
    attempts: row.attempts ?? 0,
    max_attempts: row.max_attempts ?? 3,
    estimated_ai_cost_usd: estimatedAiCostUsd,
    budget_check: budgetCheck,
  };

  if (dryRun) {
    return { beforeState: job, afterState: null, validation, result: { dryRun: true, jobId } };
  }

  if (!budgetCheck.ok) {
    throw new Error(budgetCheck.error);
  }

  const result = await callInternal(request, `/api/enrichment-jobs/${jobId}/retry`);
  return { beforeState: job, afterState: result.data ?? result, validation, result: result.data ?? result };
}

async function markStaleJobsFailed(sb: ReturnType<typeof createSupabaseAdminClient>, importJobId: string, payload: AnyRecord, dryRun: boolean) {
  const minutes = normalizeMinutes(payload.minutes);
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
  const leadIds = await getImportLeadIds(sb, importJobId);

  if (leadIds.length === 0) {
    return { beforeState: [], afterState: [], validation: { cutoff_minutes: minutes }, result: { timed_out: 0, jobIds: [] } };
  }

  const { data: stuck, error } = await sb
    .from("enrichment_jobs")
    .select("id,lead_id,workflow_id,status,started_at,created_at,error_message,raw_output")
    .in("lead_id", leadIds)
    .eq("status", "processing")
    .or("workflow_id.ilike.%openclaw%,workflow_id.ilike.%ai_second_pass%")
    .lt("started_at", cutoff);
  if (error) throw new Error(error.message);

  const jobs = (stuck ?? []) as Array<{
    id: string;
    lead_id: string | null;
    workflow_id: string | null;
    started_at: string | null;
    created_at: string;
    error_message: string | null;
    raw_output: unknown;
  }>;

  const validation = { import_scoped: true, cutoff_minutes: minutes, stale_jobs: jobs.length };
  if (dryRun) {
    return { beforeState: jobs, afterState: null, validation, result: { dryRun: true, timed_out: jobs.length, jobIds: jobs.map(j => j.id) } };
  }

  const now = new Date().toISOString();
  const failedIds: string[] = [];
  for (const job of jobs) {
    const workflow = job.workflow_id?.toLowerCase() ?? "";
    const errMsg = `no_callback_timeout: workflow did not complete within ${minutes} min`;
    await sb.from("enrichment_jobs").update({
      status: "failed",
      completed_at: now,
      error_message: errMsg,
      raw_output: {
        outcome: "no_callback_timeout",
        stuck_for_minutes: minutes,
        cleared_by: "codex_action",
        workflow_id: job.workflow_id,
        started_at: job.started_at,
      },
    }).eq("id", job.id);

    if (job.lead_id && workflow.includes("openclaw")) {
      await sb.from("leads")
        .update({ status: "unresolved_after_openclaw" })
        .eq("id", job.lead_id)
        .eq("status", "openclaw_researching");

      await sb.from("enrichment_events").insert({
        lead_id: job.lead_id,
        event_type: "unresolved_after_openclaw",
        stage: "openclaw",
        payload: {
          reason: "no_callback_timeout",
          source: "codex_action",
          cutoff_minutes: minutes,
          job_id: job.id,
        },
      });
    }

    failedIds.push(job.id);
  }

  return {
    beforeState: jobs,
    afterState: { failedIds },
    validation,
    result: { timed_out: jobs.length, jobIds: failedIds },
  };
}

async function proposeReviewDecisions(sb: ReturnType<typeof createSupabaseAdminClient>, importJobId: string, dryRun: boolean) {
  const leadIds = await getImportLeadIds(sb, importJobId);
  if (leadIds.length === 0) {
    return { beforeState: [], afterState: [], validation: { candidates: 0 }, result: { proposals: [] } };
  }

  const { data, error } = await sb
    .from("phone_candidates")
    .select("id,lead_id,phone_e164,phone_raw,source_label,source_url,snippet,matched_on,initial_confidence,review_reason,candidate_status")
    .in("lead_id", leadIds)
    .in("candidate_status", ["needs_anthony_review", "weak_review"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  const candidates = (data ?? []) as Array<{
    id: string;
    phone_e164: string | null;
    phone_raw: string | null;
    source_label: string | null;
    source_url: string | null;
    snippet: string | null;
    matched_on: string | null;
    initial_confidence: number | null;
    review_reason: string | null;
  }>;
  const proposals = candidates.map(buildReviewProposal);
  const validation = {
    import_scoped: true,
    candidates: candidates.length,
    writes_to_phone_candidates: false,
    automatic_approval_enabled: false,
  };

  return {
    beforeState: candidates.map(c => ({ id: c.id, status: "reviewable" })),
    afterState: dryRun ? null : { proposals },
    validation,
    result: { dryRun, proposals },
  };
}

async function applyTrustedReviewDecisions(
  sb: ReturnType<typeof createSupabaseAdminClient>,
  importJobId: string,
  payload: AnyRecord,
  userId: string | null,
  dryRun: boolean,
) {
  const limit = Math.max(1, Math.min(50, Number(payload.limit ?? 25) || 25));
  const leadIds = await getImportLeadIds(sb, importJobId);
  if (leadIds.length === 0) {
    return {
      beforeState: [],
      afterState: [],
      validation: { import_scoped: true, candidates: 0, auto_review_enabled: getAutoReviewEnabled() },
      result: { applied: [], skipped: [] },
    };
  }

  const { data, error } = await sb
    .from("phone_candidates")
    .select(`
      id,lead_id,contact_id,phone_e164,phone_raw,source_label,source_url,snippet,
      matched_on,source_class,initial_confidence,review_reason,candidate_status,
      reviewed_by,reviewed_at,review_note
    `)
    .in("lead_id", leadIds)
    .in("candidate_status", ["needs_anthony_review", "weak_review"])
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const candidates = (data ?? []) as Array<{
    id: string;
    lead_id: string;
    contact_id: string | null;
    phone_e164: string | null;
    phone_raw: string | null;
    source_label: string | null;
    source_url: string | null;
    snippet: string | null;
    matched_on: string | null;
    source_class: string | null;
    initial_confidence: number | null;
    review_reason: string | null;
    candidate_status: string;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_note: string | null;
  }>;

  const { data: thresholds, error: thresholdErr } = await sb
    .from("codex_trust_thresholds")
    .select("action_type,source_label,source_class,matched_on,sample_size,agreement_rate,enabled,cold_start")
    .eq("enabled", true);
  if (thresholdErr) throw new Error(thresholdErr.message);

  const thresholdByKey = new Map<string, {
    sample_size: number;
    agreement_rate: number;
    enabled: boolean;
  }>();
  for (const threshold of thresholds ?? []) {
    const row = threshold as {
      action_type: string;
      source_label: string | null;
      source_class: string | null;
      matched_on: string | null;
      sample_size: number;
      agreement_rate: number;
      enabled: boolean;
    };
    thresholdByKey.set(
      [row.action_type, keyPart(row.source_label), keyPart(row.source_class), keyPart(row.matched_on)].join("|"),
      { sample_size: row.sample_size, agreement_rate: Number(row.agreement_rate), enabled: row.enabled },
    );
  }

  const decisions = candidates.map(candidate => {
    const proposal = buildReviewProposal(candidate);
    const actionType =
      proposal.verdict === "approve"
        ? "approve_phone_candidate"
        : proposal.verdict === "reject"
          ? "reject_phone_candidate"
          : null;
    const trust = actionType
      ? thresholdByKey.get([actionType, keyPart(candidate.source_label), keyPart(candidate.source_class), keyPart(candidate.matched_on)].join("|")) ?? null
      : null;
    return { candidate, proposal, actionType, trust };
  });

  const eligible = decisions.filter(decision =>
    decision.actionType &&
    decision.trust?.enabled &&
    decision.trust.sample_size >= 50 &&
    decision.trust.agreement_rate >= 0.95,
  );
  const skipped = decisions
    .filter(decision => !eligible.includes(decision))
    .map(decision => ({
      candidateId: decision.candidate.id,
      verdict: decision.proposal.verdict,
      reason: decision.proposal.reason,
      trust: decision.trust,
    }));

  const validation = {
    import_scoped: true,
    candidates: candidates.length,
    eligible: eligible.length,
    auto_review_enabled: getAutoReviewEnabled(),
    trust_rule: "enabled threshold with sample_size >= 50 and agreement_rate >= 0.95",
  };

  if (dryRun || !getAutoReviewEnabled()) {
    return {
      beforeState: candidates,
      afterState: dryRun ? null : { skipped_reason: "SOCLE_CODEX_AUTO_REVIEW_ENABLED is not true" },
      validation,
      result: {
        dryRun,
        applied: [],
        wouldApply: eligible.map(decision => ({
          candidateId: decision.candidate.id,
          actionType: decision.actionType,
          reason: decision.proposal.reason,
          trust: decision.trust,
        })),
        skipped,
      },
    };
  }

  const now = new Date().toISOString();
  const applied: Array<{ candidateId: string; actionType: string; phoneId?: string | null }> = [];
  const undoPayload: Array<{
    candidate: unknown;
    phoneBefore: unknown;
    phoneId: string | null;
    actionType: string;
  }> = [];

  for (const decision of eligible) {
    const candidate = decision.candidate;
    const actionType = decision.actionType!;
    let phoneId: string | null = null;
    let phoneBefore: unknown = null;

    if (actionType === "approve_phone_candidate") {
      const e164 = candidate.phone_e164 ?? extractPhonesFromValue(candidate.phone_raw ?? "")[0] ?? null;
      if (!e164 || !candidate.contact_id) {
        skipped.push({
          candidateId: candidate.id,
          verdict: "approve",
          reason: "Missing parseable phone or contact_id.",
          trust: decision.trust,
        });
        continue;
      }

      const { data: existingPhone } = await sb
        .from("phones")
        .select("*")
        .eq("contact_id", candidate.contact_id)
        .eq("e164", e164)
        .maybeSingle();
      phoneBefore = existingPhone ?? null;

      const { data: phoneRow, error: phoneErr } = await sb.from("phones").upsert({
        contact_id: candidate.contact_id,
        e164,
        display: formatDisplay(e164),
        status: "verified",
        source: "enrichment_other",
        confidence: candidate.initial_confidence ?? 0,
        evidence: candidate.source_url ?? candidate.source_label ?? "codex_trusted_review",
        notes: `codex trusted review candidate=${candidate.id} trust=${decision.trust?.agreement_rate ?? null}`,
      }, { onConflict: "contact_id,e164", ignoreDuplicates: false }).select("id").single();
      if (phoneErr) throw new Error(phoneErr.message);
      phoneId = (phoneRow as { id: string }).id;

      await sb.from("phone_candidates").update({
        candidate_status: "approved_by_codex",
        reviewed_by: userId,
        reviewed_at: now,
        review_note: decision.proposal.reason,
      }).eq("id", candidate.id);
      await sb.from("leads").update({ status: "phone_verified" }).eq("id", candidate.lead_id);
      await sb.from("enrichment_events").insert({
        lead_id: candidate.lead_id,
        event_type: "phone_approved_by_codex",
        stage: null,
        candidate_id: candidate.id,
        payload: { source: "codex_trusted_review", phone_e164: e164, reason: decision.proposal.reason },
      });
      await sb.from("source_trust_observations").insert({
        lead_id: candidate.lead_id,
        phone_id: phoneId,
        phone_candidate_id: candidate.id,
        source_label: candidate.source_label,
        source_class: candidate.source_class,
        matched_on: candidate.matched_on,
        observation: "auto_approved",
        confidence: Number(((candidate.initial_confidence ?? 0) / 100).toFixed(4)),
        observed_by: userId,
        payload: { reason: decision.proposal.reason, trust: decision.trust },
      });
    } else {
      await sb.from("phone_candidates").update({
        candidate_status: "rejected_by_codex",
        reviewed_by: userId,
        reviewed_at: now,
        review_note: decision.proposal.reason,
      }).eq("id", candidate.id);
      await sb.from("enrichment_events").insert({
        lead_id: candidate.lead_id,
        event_type: "phone_rejected_by_codex",
        stage: null,
        candidate_id: candidate.id,
        payload: { source: "codex_trusted_review", reason: decision.proposal.reason },
      });
      await sb.from("source_trust_observations").insert({
        lead_id: candidate.lead_id,
        phone_candidate_id: candidate.id,
        source_label: candidate.source_label,
        source_class: candidate.source_class,
        matched_on: candidate.matched_on,
        observation: "auto_rejected",
        confidence: Number(((candidate.initial_confidence ?? 0) / 100).toFixed(4)),
        observed_by: userId,
        payload: { reason: decision.proposal.reason, trust: decision.trust },
      });
    }

    undoPayload.push({ candidate, phoneBefore, phoneId, actionType });
    applied.push({ candidateId: candidate.id, actionType, phoneId });
  }

  return {
    beforeState: candidates,
    afterState: { applied, skipped },
    validation,
    result: { applied, skipped },
    undoPayload,
  };
}

export async function POST(request: Request, ctx: RouteCtx) {
  const { importJobId } = await ctx.params;
  const auth = await requirePhoneEnrichmentOperator(request, importJobId);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  const dryRun = body.dry_run === true;

  const { data: importJob, error: importErr } = await sb
    .from("import_jobs")
    .select("id")
    .eq("id", importJobId)
    .maybeSingle();
  if (importErr) return jsonError(importErr.message, 500, "db_error");
  if (!importJob) return jsonError("Import not found.", 404, "not_found");

  const prior = await findPriorAction(sb, importJobId, body.idempotency_key);
  if (prior) {
    return NextResponse.json({ ok: true, data: { duplicate: true, priorAction: prior } });
  }

  if (!dryRun && !getOperatorEnabled()) {
    return jsonError("Codex operator mode is disabled. Set SOCLE_CODEX_OPERATOR_ENABLED=true.", 403, "operator_disabled");
  }

  try {
    const budget = await getBudgetStatus(sb, importJobId);
    let actionResult: {
      beforeState?: unknown;
      afterState?: unknown;
      validation: AnyRecord;
      result: unknown;
      undoPayload?: unknown;
    };

    if (body.action_type === "start_enrichment") {
      actionResult = await startEnrichment(request, sb, importJobId, dryRun, budget);
    } else if (body.action_type === "retry_enrichment_job") {
      actionResult = await retryJob(request, sb, importJobId, body.payload, dryRun, budget);
    } else if (body.action_type === "mark_stale_jobs_failed") {
      actionResult = await markStaleJobsFailed(sb, importJobId, body.payload, dryRun);
    } else if (body.action_type === "propose_review_decisions") {
      actionResult = await proposeReviewDecisions(sb, importJobId, dryRun);
    } else if (body.action_type === "apply_trusted_review_decisions") {
      actionResult = await applyTrustedReviewDecisions(sb, importJobId, body.payload, auth.userId, dryRun);
    } else {
      return jsonError("Unsupported action type.", 400, "unsupported_action");
    }

    const validation = {
      ...actionResult.validation,
      operator_enabled: getOperatorEnabled(),
      dry_run: dryRun,
      budget,
      actor_spoofing_blocked: true,
    };

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        data: {
          dryRun: true,
          actionType: body.action_type,
          validation,
          result: actionResult.result,
        },
      });
    }

    const event = await logCodexAction({
      sb,
      importJobId,
      userId: auth.userId,
      actionType: body.action_type,
      idempotencyKey: body.idempotency_key,
      beforeState: actionResult.beforeState,
      afterState: actionResult.afterState,
      reversible: body.action_type === "mark_stale_jobs_failed" || Boolean(actionResult.undoPayload),
      undoPayload: body.action_type === "mark_stale_jobs_failed" ? actionResult.beforeState : actionResult.undoPayload ?? null,
      validation,
      result: actionResult.result,
    });
    if (auth.sessionId) await touchCodexSession(auth.sessionId).catch(() => undefined);

    return NextResponse.json({
      ok: true,
      data: {
        actionId: (event as { id: string }).id,
        actionType: body.action_type,
        result: actionResult.result,
        validation,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!dryRun && getOperatorEnabled()) {
      await logCodexAction({
        sb,
        importJobId,
        userId: auth.userId,
        actionType: body.action_type,
        idempotencyKey: body.idempotency_key,
        status: "failed",
        reversible: false,
        validation: { dry_run: false, operator_enabled: true },
        result: null,
        errorMessage: message,
      }).catch(() => undefined);
    }
    return jsonError(message, 400, "action_failed");
  }
}
