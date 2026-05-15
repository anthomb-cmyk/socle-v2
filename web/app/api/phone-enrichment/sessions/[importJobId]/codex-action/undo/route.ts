// POST /api/phone-enrichment/sessions/[importJobId]/codex-action/undo
// Reverts a reversible Codex action and writes a second audited Codex action.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { requirePhoneEnrichmentOperator, touchCodexSession } from "@/lib/phone-enrichment/auth";
import { getOperatorEnabled } from "@/lib/phone-enrichment/session";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const Body = z.object({
  action_id: z.string().uuid(),
}).strict();

type RouteCtx = { params: Promise<{ importJobId: string }> };

function jsonError(error: string, status = 400, code = "bad_request") {
  return NextResponse.json({ ok: false, error, code }, { status });
}

function asCodexPayload(payload: unknown): {
  action_type?: string;
  reversible?: boolean;
  undo_payload?: unknown;
  before_state?: unknown;
  after_state?: unknown;
} {
  return ((payload ?? {}) as { codex?: Record<string, unknown> }).codex ?? {};
}

async function findPriorUndo(
  sb: ReturnType<typeof createSupabaseAdminClient>,
  importJobId: string,
  actionId: string,
) {
  const { data, error } = await sb
    .from("automation_events")
    .select("id,payload,occurred_at")
    .eq("related_import_id", importJobId)
    .eq("actor_kind", "codex")
    .eq("event_type", "codex_action")
    .order("occurred_at", { ascending: false })
    .limit(250);

  if (error) throw new Error(error.message);
  return (data ?? []).find((row: { payload?: unknown }) => {
    const codex = asCodexPayload(row.payload) as { undo_of_action_id?: string; action_type?: string };
    return codex.action_type === "undo_codex_action" && codex.undo_of_action_id === actionId;
  }) ?? null;
}

async function undoMarkStaleJobsFailed(
  sb: ReturnType<typeof createSupabaseAdminClient>,
  undoPayload: unknown,
) {
  const jobs = Array.isArray(undoPayload) ? undoPayload : [];
  const restoredJobIds: string[] = [];
  const restoredLeadIds: string[] = [];

  for (const item of jobs) {
    const job = item as {
      id?: string;
      lead_id?: string | null;
      workflow_id?: string | null;
      started_at?: string | null;
      error_message?: string | null;
      raw_output?: unknown;
    };
    if (!job.id) continue;

    const { error } = await sb
      .from("enrichment_jobs")
      .update({
        status: "processing",
        completed_at: null,
        started_at: job.started_at ?? new Date().toISOString(),
        error_message: job.error_message ?? null,
        raw_output: job.raw_output ?? null,
      })
      .eq("id", job.id);
    if (error) throw new Error(error.message);
    restoredJobIds.push(job.id);

    if (job.lead_id && (job.workflow_id ?? "").toLowerCase().includes("openclaw")) {
      await sb
        .from("leads")
        .update({ status: "openclaw_researching" })
        .eq("id", job.lead_id)
        .eq("status", "unresolved_after_openclaw");
      restoredLeadIds.push(job.lead_id);
    }
  }

  return { restoredJobIds, restoredLeadIds };
}

async function undoApplyTrustedReviewDecisions(
  sb: ReturnType<typeof createSupabaseAdminClient>,
  undoPayload: unknown,
) {
  const items = Array.isArray(undoPayload) ? undoPayload : [];
  const restoredCandidateIds: string[] = [];
  const restoredPhoneIds: string[] = [];
  const deletedPhoneIds: string[] = [];
  const restoredLeadIds: string[] = [];

  for (const item of items) {
    const row = item as {
      candidate?: {
        id?: string;
        lead_id?: string;
        candidate_status?: string;
        reviewed_by?: string | null;
        reviewed_at?: string | null;
        review_note?: string | null;
      };
      phoneBefore?: {
        id?: string;
        e164?: string | null;
        display?: string | null;
        status?: string | null;
        source?: string | null;
        confidence?: number | null;
        evidence?: string | null;
        notes?: string | null;
      } | null;
      phoneId?: string | null;
      actionType?: string;
    };
    if (!row.candidate?.id) continue;

    await sb.from("phone_candidates").update({
      candidate_status: row.candidate.candidate_status ?? "needs_anthony_review",
      reviewed_by: row.candidate.reviewed_by ?? null,
      reviewed_at: row.candidate.reviewed_at ?? null,
      review_note: row.candidate.review_note ?? null,
    }).eq("id", row.candidate.id);
    restoredCandidateIds.push(row.candidate.id);

    if (row.actionType === "approve_phone_candidate" && row.phoneId) {
      if (row.phoneBefore?.id) {
        await sb.from("phones").update({
          e164: row.phoneBefore.e164,
          display: row.phoneBefore.display,
          status: row.phoneBefore.status,
          source: row.phoneBefore.source,
          confidence: row.phoneBefore.confidence,
          evidence: row.phoneBefore.evidence,
          notes: row.phoneBefore.notes,
        }).eq("id", row.phoneBefore.id);
        restoredPhoneIds.push(row.phoneBefore.id);
      } else {
        await sb.from("phones").delete().eq("id", row.phoneId);
        deletedPhoneIds.push(row.phoneId);
      }
    }

    if (row.candidate.lead_id) {
      await sb
        .from("leads")
        .update({ status: "needs_phone_review" })
        .eq("id", row.candidate.lead_id)
        .in("status", ["phone_verified", "ready_to_call", "unresolved_after_openclaw", "unresolved_after_all_sources"]);
      restoredLeadIds.push(row.candidate.lead_id);
    }
  }

  return { restoredCandidateIds, restoredPhoneIds, deletedPhoneIds, restoredLeadIds };
}

export async function POST(request: Request, ctx: RouteCtx) {
  const { importJobId } = await ctx.params;
  const auth = await requirePhoneEnrichmentOperator(request, importJobId);
  if (!auth.ok) return auth.response;

  if (!getOperatorEnabled()) {
    return jsonError("Codex operator mode is disabled. Set SOCLE_CODEX_OPERATOR_ENABLED=true.", 403, "operator_disabled");
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();

  const { data: action, error } = await sb
    .from("automation_events")
    .select("id,status,payload,result,error_message,occurred_at")
    .eq("id", body.action_id)
    .eq("related_import_id", importJobId)
    .eq("actor_kind", "codex")
    .eq("event_type", "codex_action")
    .maybeSingle();

  if (error) return jsonError(error.message, 500, "db_error");
  if (!action) return jsonError("Codex action not found for this import.", 404, "not_found");

  const priorUndo = await findPriorUndo(sb, importJobId, body.action_id);
  if (priorUndo) {
    return NextResponse.json({ ok: true, data: { duplicate: true, priorUndo } });
  }

  const codex = asCodexPayload((action as { payload: unknown }).payload);
  if (!codex.reversible) return jsonError("This Codex action is not reversible.", 409, "not_reversible");

  let undoResult: unknown;
  if (codex.action_type === "mark_stale_jobs_failed") {
    undoResult = await undoMarkStaleJobsFailed(sb, codex.undo_payload);
  } else if (codex.action_type === "apply_trusted_review_decisions") {
    undoResult = await undoApplyTrustedReviewDecisions(sb, codex.undo_payload);
  } else {
    return jsonError(`Undo is not implemented for ${codex.action_type ?? "unknown action"}.`, 409, "undo_not_supported");
  }

  const { data: undoEvent, error: insertErr } = await sb
    .from("automation_events")
    .insert({
      source: "web_app",
      actor_kind: "codex",
      event_type: "codex_action",
      status: "success",
      related_import_id: importJobId,
      triggered_by: auth.userId,
      payload: {
        codex: {
          action_type: "undo_codex_action",
          undo_of_action_id: body.action_id,
          before_state: { action },
          after_state: undoResult,
          reversible: false,
          undo_payload: null,
          idempotency_key: `undo:${body.action_id}`,
          validation: {
            import_scoped: true,
            original_action_type: codex.action_type ?? null,
          },
        },
      },
      result: undoResult,
    })
    .select("id,occurred_at")
    .single();

  if (insertErr) return jsonError(insertErr.message, 500, "db_error");
  if (auth.sessionId) await touchCodexSession(auth.sessionId).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    data: {
      actionId: (undoEvent as { id: string }).id,
      actionType: "undo_codex_action",
      result: undoResult,
    },
  });
}
