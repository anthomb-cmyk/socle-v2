// POST /api/phone-enrichment/trust/calibrate
// Recomputes Codex review trust thresholds from Anthony's historical decisions.

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { requirePhoneEnrichmentOperator } from "@/lib/phone-enrichment/auth";
import { buildReviewProposal, getOperatorEnabled } from "@/lib/phone-enrichment/session";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type GroupStats = {
  actionType: "approve_phone_candidate" | "reject_phone_candidate";
  sourceLabel: string;
  sourceClass: string;
  matchedOn: string;
  sampleSize: number;
  agreement: number;
};

function keyPart(value: string | null | undefined): string {
  return value?.trim() || "__unknown__";
}

function groupKey(stats: Pick<GroupStats, "actionType" | "sourceLabel" | "sourceClass" | "matchedOn">): string {
  return [stats.actionType, stats.sourceLabel, stats.sourceClass, stats.matchedOn].join("|");
}

export async function POST(request: Request) {
  const auth = await requirePhoneEnrichmentOperator(request);
  if (!auth.ok) return auth.response;
  if (!getOperatorEnabled()) {
    return NextResponse.json(
      { ok: false, error: "Codex operator mode is disabled. Set SOCLE_CODEX_OPERATOR_ENABLED=true." },
      { status: 403 },
    );
  }

  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("phone_candidates")
    .select(`
      id,phone_e164,phone_raw,source_label,source_url,snippet,matched_on,source_class,
      initial_confidence,review_reason,candidate_status,reviewed_at
    `)
    .in("candidate_status", ["approved_by_anthony", "rejected_by_anthony"])
    .not("reviewed_at", "is", null)
    .order("reviewed_at", { ascending: false })
    .limit(1000);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const groups = new Map<string, GroupStats>();
  for (const row of data ?? []) {
    const candidate = row as {
      id: string;
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
    };
    const proposal = buildReviewProposal(candidate);
    if (proposal.verdict === "manual") continue;

    const actionType =
      proposal.verdict === "approve"
        ? "approve_phone_candidate"
        : "reject_phone_candidate";
    const actualMatches =
      (actionType === "approve_phone_candidate" && candidate.candidate_status === "approved_by_anthony") ||
      (actionType === "reject_phone_candidate" && candidate.candidate_status === "rejected_by_anthony");

    const stats: GroupStats = {
      actionType,
      sourceLabel: keyPart(candidate.source_label),
      sourceClass: keyPart(candidate.source_class),
      matchedOn: keyPart(candidate.matched_on),
      sampleSize: 0,
      agreement: 0,
    };
    const key = groupKey(stats);
    const existing = groups.get(key) ?? stats;
    existing.sampleSize++;
    if (actualMatches) existing.agreement++;
    groups.set(key, existing);
  }

  const rows = Array.from(groups.values()).map(group => {
    const agreementRate = group.sampleSize > 0 ? group.agreement / group.sampleSize : 0;
    return {
      action_type: group.actionType,
      source_label: group.sourceLabel,
      source_class: group.sourceClass,
      matched_on: group.matchedOn,
      sample_size: group.sampleSize,
      agreement_rate: Number(agreementRate.toFixed(4)),
      enabled: group.sampleSize >= 50 && agreementRate >= 0.95,
      cold_start: group.sampleSize < 50,
      computed_at: new Date().toISOString(),
      payload: {
        agreement: group.agreement,
        rule: "enabled when sample_size >= 50 and agreement_rate >= 0.95",
      },
    };
  });

  if (rows.length > 0) {
    const { error: upsertErr } = await sb
      .from("codex_trust_thresholds")
      .upsert(rows, { onConflict: "action_type,source_label,source_class,matched_on" });
    if (upsertErr) return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 500 });
  }

  await sb.from("automation_events").insert({
    source: "web_app",
    actor_kind: "codex",
    event_type: "codex_trust_calibrated",
    status: "success",
    triggered_by: auth.userId,
    payload: {
      codex: {
        action_type: "calibrate_trust_thresholds",
        reviewed_candidates: data?.length ?? 0,
        groups: rows.length,
      },
    },
    result: {
      groups: rows,
    },
  });

  return NextResponse.json({
    ok: true,
    data: {
      reviewedCandidates: data?.length ?? 0,
      groups: rows,
      enabledGroups: rows.filter(row => row.enabled).length,
    },
  });
}
