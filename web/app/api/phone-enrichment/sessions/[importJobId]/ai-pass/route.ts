// POST /api/phone-enrichment/sessions/[importJobId]/ai-pass
// Runs the measured AI second pass on unresolved/weak leads for one import.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { requirePhoneEnrichmentOperator, touchCodexSession } from "@/lib/phone-enrichment/auth";
import { loadLeadContext } from "@/lib/phone-enrichment/lead-context";
import {
  assertBudgetCanSpend,
  estimateAiSecondPassCostUsd,
  getBudgetStatus,
  getImportLeadIds,
  getOperatorEnabled,
} from "@/lib/phone-enrichment/session";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const Body = z.object({
  leadIds: z.array(z.string().uuid()).max(50).optional(),
  maxLeads: z.number().int().min(1).max(50).optional(),
  idempotency_key: z.string().trim().min(1).max(200).optional(),
  dry_run: z.boolean().optional(),
}).strict();

type RouteCtx = { params: Promise<{ importJobId: string }> };

function jsonError(error: string, status = 400, code = "bad_request") {
  return NextResponse.json({ ok: false, error, code }, { status });
}

async function findPriorRun(
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
    const codex = ((row.payload ?? {}) as { codex?: { idempotency_key?: string } }).codex;
    return codex?.idempotency_key === idempotencyKey;
  }) ?? null;
}

async function getPriorQueries(
  sb: ReturnType<typeof createSupabaseAdminClient>,
  leadId: string,
): Promise<string[]> {
  const { data, error } = await sb
    .from("enrichment_events")
    .select("payload")
    .eq("lead_id", leadId)
    .eq("event_type", "query_built")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);

  const queries: string[] = [];
  for (const row of data ?? []) {
    const payload = ((row as { payload?: unknown }).payload ?? {}) as {
      query?: unknown;
      queries?: Array<{ query?: unknown }>;
    };
    if (typeof payload.query === "string") queries.push(payload.query);
    if (Array.isArray(payload.queries)) {
      for (const item of payload.queries) {
        if (typeof item.query === "string") queries.push(item.query);
      }
    }
  }
  return Array.from(new Set(queries));
}

async function getEligibleAiPassLeadIds(
  sb: ReturnType<typeof createSupabaseAdminClient>,
  importJobId: string,
  requestedLeadIds: string[] | undefined,
  maxLeads: number,
): Promise<string[]> {
  const importLeadIds = await getImportLeadIds(sb, importJobId);
  if (importLeadIds.length === 0) return [];

  const requested = requestedLeadIds && requestedLeadIds.length > 0
    ? requestedLeadIds.filter(id => importLeadIds.includes(id))
    : importLeadIds;
  if (requested.length === 0) return [];

  const [viewRes, candidateRes, activeJobsRes] = await Promise.all([
    sb
      .from("leads_view")
      .select("lead_id,status,best_phone")
      .in("lead_id", requested)
      .is("best_phone", null),
    sb
      .from("phone_candidates")
      .select("lead_id,candidate_status")
      .in("lead_id", requested)
      .in("candidate_status", ["weak_review", "needs_anthony_review", "quarantined", "pipeline_rejected"]),
    sb
      .from("enrichment_jobs")
      .select("lead_id")
      .in("lead_id", requested)
      .eq("job_type", "find_phone")
      .in("status", ["pending", "processing"]),
  ]);

  if (viewRes.error) throw new Error(viewRes.error.message);
  if (candidateRes.error) throw new Error(candidateRes.error.message);
  if (activeJobsRes.error) throw new Error(activeJobsRes.error.message);

  const active = new Set((activeJobsRes.data ?? []).map((row: { lead_id: string | null }) => row.lead_id).filter(Boolean));
  const weakLeads = new Set((candidateRes.data ?? [])
    .filter((row: { candidate_status: string }) => row.candidate_status !== "needs_anthony_review")
    .map((row: { lead_id: string }) => row.lead_id));

  const eligible: string[] = [];
  for (const row of (viewRes.data ?? []) as Array<{ lead_id: string; status: string | null; best_phone: string | null }>) {
    if (active.has(row.lead_id)) continue;
    if (
      row.status === "unresolved_after_all_sources" ||
      row.status === "unresolved_after_openclaw" ||
      (row.status === "needs_phone_review" && weakLeads.has(row.lead_id)) ||
      weakLeads.has(row.lead_id)
    ) {
      eligible.push(row.lead_id);
    }
    if (eligible.length >= maxLeads) break;
  }

  return eligible;
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

  const dryRun = body.dry_run === true;
  if (!dryRun && !getOperatorEnabled()) {
    return jsonError("Codex operator mode is disabled. Set SOCLE_CODEX_OPERATOR_ENABLED=true.", 403, "operator_disabled");
  }

  const sb = createSupabaseAdminClient();
  const prior = await findPriorRun(sb, importJobId, body.idempotency_key);
  if (prior) {
    return NextResponse.json({ ok: true, data: { duplicate: true, priorAction: prior } });
  }

  const { data: importJob, error: importErr } = await sb
    .from("import_jobs")
    .select("id")
    .eq("id", importJobId)
    .maybeSingle();
  if (importErr) return jsonError(importErr.message, 500, "db_error");
  if (!importJob) return jsonError("Import not found.", 404, "not_found");

  const maxLeads = body.maxLeads ?? 10;
  const leadIds = await getEligibleAiPassLeadIds(sb, importJobId, body.leadIds, maxLeads);
  const estimatedAiCostUsd = estimateAiSecondPassCostUsd(leadIds.length);
  const budget = await getBudgetStatus(sb, importJobId);
  const budgetCheck = assertBudgetCanSpend(budget, estimatedAiCostUsd);
  const validation = {
    import_scoped: true,
    eligible_leads: leadIds.length,
    requested_leads: body.leadIds?.length ?? null,
    estimated_ai_cost_usd: estimatedAiCostUsd,
    budget_check: budgetCheck,
    uses_existing_scorer_and_g6_threshold: true,
  };

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      data: {
        dryRun: true,
        actionType: "run_ai_second_pass",
        validation,
        result: { leadIds },
      },
    });
  }

  if (!budgetCheck.ok) return jsonError(budgetCheck.error, 402, "budget_exceeded");

  const startedAt = new Date().toISOString();
  const beforeState = { leadIds, startedAt };
  const results: Array<{
    leadId: string;
    jobId?: string;
    outcome: string;
    candidateIds?: string[];
    queriesIssued?: number;
    totalResults?: number;
    error?: string;
  }> = [];

  const { runAiSecondPassLegacy } = await import("@/lib/enrichment/pipeline-legacy");

  for (const leadId of leadIds) {
    const { data: leadRow } = await sb
      .from("leads")
      .select("contact_id")
      .eq("id", leadId)
      .maybeSingle();
    const contactId = (leadRow as { contact_id?: string | null } | null)?.contact_id ?? null;

    const { data: job, error: jobErr } = await sb
      .from("enrichment_jobs")
      .insert({
        lead_id: leadId,
        contact_id: contactId,
        workflow_id: "ai_second_pass_v1",
        job_type: "find_phone",
        status: "processing",
        started_at: new Date().toISOString(),
        raw_input: {
          leadId,
          importJobId,
          source: "codex_ai_second_pass",
          idempotency_key: body.idempotency_key ?? null,
        },
      })
      .select("id")
      .single();

    if (jobErr || !job) {
      results.push({ leadId, outcome: "failed", error: jobErr?.message ?? "job insert failed" });
      continue;
    }

    const jobId = (job as { id: string }).id;
    try {
      const ctxLead = await loadLeadContext(sb, leadId, jobId);
      if (!ctxLead) throw new Error("Lead not found.");
      const priorQueries = await getPriorQueries(sb, leadId);
      const result = await runAiSecondPassLegacy(sb, ctxLead, priorQueries);
      await sb.from("enrichment_jobs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        raw_output: {
          outcome: result.outcome,
          candidateIds: result.candidateIds,
          queriesSuggested: result.queriesSuggested,
          queriesIssued: result.queriesIssued,
          totalResults: result.totalResults,
          pipeline: "ai_second_pass_v1",
        },
      }).eq("id", jobId);
      results.push({
        leadId,
        jobId,
        outcome: result.outcome,
        candidateIds: result.candidateIds,
        queriesIssued: result.queriesIssued,
        totalResults: result.totalResults,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await sb.from("enrichment_jobs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: message,
        raw_output: { outcome: "runner_error", pipeline: "ai_second_pass_v1" },
      }).eq("id", jobId);
      results.push({ leadId, jobId, outcome: "failed", error: message });
    }
  }

  const counts = {
    solved: results.filter(r => r.outcome === "solved").length,
    review: results.filter(r => r.outcome === "review").length,
    unresolved: results.filter(r => r.outcome === "unresolved").length,
    unsuitable: results.filter(r => r.outcome === "unsuitable").length,
    failed: results.filter(r => r.outcome === "failed").length,
  };

  const { data: event, error: eventErr } = await sb
    .from("automation_events")
    .insert({
      source: "web_app",
      actor_kind: "codex",
      event_type: "codex_action",
      status: counts.failed > 0 ? "partial" : "success",
      related_import_id: importJobId,
      triggered_by: auth.userId,
      payload: {
        codex: {
          action_type: "run_ai_second_pass",
          before_state: beforeState,
          after_state: { counts, results },
          reversible: false,
          undo_payload: null,
          idempotency_key: body.idempotency_key ?? null,
          validation,
        },
      },
      result: { counts, results },
      error_message: counts.failed > 0 ? `${counts.failed} lead(s) failed` : null,
    })
    .select("id,occurred_at")
    .single();

  if (eventErr) return jsonError(eventErr.message, 500, "db_error");
  if (auth.sessionId) await touchCodexSession(auth.sessionId).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    data: {
      actionId: (event as { id: string }).id,
      actionType: "run_ai_second_pass",
      result: { counts, results },
      validation,
    },
  });
}
