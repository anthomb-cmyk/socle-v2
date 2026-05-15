import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export const DEFAULT_SESSION_BUDGET_USD = 5;
export const DEFAULT_DAILY_BUDGET_USD = 20;
export const DEFAULT_PHONE_ENRICHMENT_ESTIMATED_COST_PER_LEAD_USD = 0.005;
export const DEFAULT_AI_SECOND_PASS_ESTIMATED_COST_PER_LEAD_USD = 0.02;

const VALID_PHONE_STATUSES = ["unverified", "valid", "verified"] as const;

export type RecoverabilityReason =
  | "bad_query"
  | "no_public_data"
  | "weak_evidence"
  | "pipeline_error";

export type CodexActionType =
  | "start_enrichment"
  | "retry_enrichment_job"
  | "mark_stale_jobs_failed"
  | "propose_review_decisions"
  | "run_ai_second_pass"
  | "undo_codex_action"
  | "apply_trusted_review_decisions";

export type BudgetStatus = {
  dailyBudgetUsd: number;
  sessionBudgetUsd: number;
  dailySpentUsd: number;
  sessionSpentUsd: number;
  dailyRemainingUsd: number;
  sessionRemainingUsd: number;
  overDailyBudget: boolean;
  overSessionBudget: boolean;
};

export type RecoverabilitySummary = {
  counts: Record<RecoverabilityReason, number>;
  examples: Array<{
    leadId: string;
    reason: RecoverabilityReason;
    detail: string;
  }>;
};

type AnyClient = SupabaseClient<Database>;

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readBudgetEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function estimatePhoneEnrichmentAiCostUsd(leadCount: number): number {
  const perLead = readBudgetEnv(
    "SOCLE_AI_ESTIMATED_PHONE_LEAD_USD",
    DEFAULT_PHONE_ENRICHMENT_ESTIMATED_COST_PER_LEAD_USD,
  );
  return Number((Math.max(0, leadCount) * perLead).toFixed(6));
}

export function estimateAiSecondPassCostUsd(leadCount: number): number {
  const perLead = readBudgetEnv(
    "SOCLE_AI_SECOND_PASS_ESTIMATED_USD_PER_LEAD",
    DEFAULT_AI_SECOND_PASS_ESTIMATED_COST_PER_LEAD_USD,
  );
  return Number((Math.max(0, leadCount) * perLead).toFixed(6));
}

export function getOperatorEnabled(): boolean {
  return (process.env.SOCLE_CODEX_OPERATOR_ENABLED ?? "").toLowerCase() === "true";
}

export async function getImportLeadIds(sb: AnyClient, importJobId: string): Promise<string[]> {
  const { data, error } = await sb
    .from("leads")
    .select("id")
    .eq("source_import_job_id", importJobId)
    .limit(5000);

  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { id: string }) => row.id);
}

export async function getEligibleStartLeadIds(sb: AnyClient, importJobId: string): Promise<string[]> {
  const leadIds = await getImportLeadIds(sb, importJobId);
  if (leadIds.length === 0) return [];

  const { data, error } = await sb
    .from("leads_view")
    .select("lead_id,status,best_phone")
    .in("lead_id", leadIds)
    .in("status", ["new", "needs_enrichment"])
    .is("best_phone", null)
    .limit(500);

  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { lead_id: string }) => row.lead_id);
}

export async function leadBelongsToImport(
  sb: AnyClient,
  leadId: string | null,
  importJobId: string,
): Promise<boolean> {
  if (!leadId) return false;
  const { data, error } = await sb
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("source_import_job_id", importJobId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function getBudgetStatus(
  sb: AnyClient,
  importJobId: string,
): Promise<BudgetStatus> {
  const dailyBudgetUsd = readBudgetEnv("SOCLE_AI_DAILY_BUDGET_USD", DEFAULT_DAILY_BUDGET_USD);
  const sessionBudgetUsd = readBudgetEnv("SOCLE_AI_SESSION_BUDGET_USD", DEFAULT_SESSION_BUDGET_USD);
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const leadIds = await getImportLeadIds(sb, importJobId);

  const [dailyRes, sessionRes] = await Promise.all([
    sb
      .from("llm_usage_log")
      .select("cost_usd")
      .gte("created_at", since.toISOString()),
    leadIds.length > 0
      ? sb
          .from("llm_usage_log")
          .select("cost_usd")
          .in("lead_id", leadIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (dailyRes.error) throw new Error(dailyRes.error.message);
  if (sessionRes.error) throw new Error(sessionRes.error.message);

  const dailySpentUsd = (dailyRes.data ?? []).reduce(
    (sum: number, row: { cost_usd: unknown }) => sum + toNumber(row.cost_usd),
    0,
  );
  const sessionSpentUsd = (sessionRes.data ?? []).reduce(
    (sum: number, row: { cost_usd: unknown }) => sum + toNumber(row.cost_usd),
    0,
  );

  return {
    dailyBudgetUsd,
    sessionBudgetUsd,
    dailySpentUsd,
    sessionSpentUsd,
    dailyRemainingUsd: Math.max(0, dailyBudgetUsd - dailySpentUsd),
    sessionRemainingUsd: Math.max(0, sessionBudgetUsd - sessionSpentUsd),
    overDailyBudget: dailySpentUsd >= dailyBudgetUsd,
    overSessionBudget: sessionSpentUsd >= sessionBudgetUsd,
  };
}

export function assertBudgetCanSpend(
  budget: BudgetStatus,
  estimatedCostUsd: number,
): { ok: true } | { ok: false; error: string } {
  if (budget.dailySpentUsd + estimatedCostUsd > budget.dailyBudgetUsd) {
    return { ok: false, error: "Daily AI budget would be exceeded." };
  }
  if (budget.sessionSpentUsd + estimatedCostUsd > budget.sessionBudgetUsd) {
    return { ok: false, error: "Session AI budget would be exceeded." };
  }
  return { ok: true };
}

export function classifyRecoverability(input: {
  latestJob?: { status?: string | null; error_message?: string | null; raw_output?: unknown } | null;
  weakCandidateCount: number;
  quarantinedCandidateCount: number;
  queryBuiltCount: number;
}): { reason: RecoverabilityReason; detail: string } {
  const raw = (input.latestJob?.raw_output ?? {}) as Record<string, unknown>;
  const outcome = typeof raw.outcome === "string" ? raw.outcome : "";
  const errorMessage = input.latestJob?.error_message ?? "";

  if (
    errorMessage ||
    outcome === "runner_error" ||
    outcome === "search_unavailable" ||
    outcome === "no_callback_timeout"
  ) {
    return { reason: "pipeline_error", detail: errorMessage || outcome || "job error" };
  }

  if (input.weakCandidateCount > 0 || input.quarantinedCandidateCount > 0) {
    return {
      reason: "weak_evidence",
      detail: `${input.weakCandidateCount} weak, ${input.quarantinedCandidateCount} quarantined`,
    };
  }

  if (input.queryBuiltCount > 0 && input.queryBuiltCount < 3) {
    return { reason: "bad_query", detail: `${input.queryBuiltCount} query event(s) logged` };
  }

  return { reason: "no_public_data", detail: outcome || "no accepted candidate" };
}

export async function buildRecoverabilitySummary(
  sb: AnyClient,
  importJobId: string,
): Promise<RecoverabilitySummary> {
  const leadIds = await getImportLeadIds(sb, importJobId);
  const counts: Record<RecoverabilityReason, number> = {
    bad_query: 0,
    no_public_data: 0,
    weak_evidence: 0,
    pipeline_error: 0,
  };
  const examples: RecoverabilitySummary["examples"] = [];
  if (leadIds.length === 0) return { counts, examples };

  const [leadsRes, jobsRes, candidatesRes, eventsRes] = await Promise.all([
    sb
      .from("leads")
      .select("id,status")
      .in("id", leadIds)
      .in("status", ["unresolved_after_all_sources", "unresolved_after_openclaw", "needs_phone_review"]),
    sb
      .from("enrichment_jobs")
      .select("id,lead_id,status,error_message,raw_output,created_at,completed_at")
      .in("lead_id", leadIds)
      .eq("job_type", "find_phone")
      .order("created_at", { ascending: false })
      .limit(2000),
    sb
      .from("phone_candidates")
      .select("lead_id,candidate_status")
      .in("lead_id", leadIds),
    sb
      .from("enrichment_events")
      .select("lead_id,event_type")
      .in("lead_id", leadIds)
      .eq("event_type", "query_built")
      .limit(5000),
  ]);

  if (leadsRes.error) throw new Error(leadsRes.error.message);
  if (jobsRes.error) throw new Error(jobsRes.error.message);
  if (candidatesRes.error) throw new Error(candidatesRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);

  const latestJobByLead = new Map<string, { status?: string | null; error_message?: string | null; raw_output?: unknown }>();
  for (const job of jobsRes.data ?? []) {
    const row = job as { lead_id: string | null; status?: string | null; error_message?: string | null; raw_output?: unknown };
    if (row.lead_id && !latestJobByLead.has(row.lead_id)) latestJobByLead.set(row.lead_id, row);
  }

  const weakByLead = new Map<string, number>();
  const quarantinedByLead = new Map<string, number>();
  for (const candidate of candidatesRes.data ?? []) {
    const row = candidate as { lead_id: string; candidate_status: string };
    if (row.candidate_status === "weak_review") {
      weakByLead.set(row.lead_id, (weakByLead.get(row.lead_id) ?? 0) + 1);
    }
    if (row.candidate_status === "quarantined" || row.candidate_status === "pipeline_rejected") {
      quarantinedByLead.set(row.lead_id, (quarantinedByLead.get(row.lead_id) ?? 0) + 1);
    }
  }

  const queryBuiltByLead = new Map<string, number>();
  for (const event of eventsRes.data ?? []) {
    const row = event as { lead_id: string };
    queryBuiltByLead.set(row.lead_id, (queryBuiltByLead.get(row.lead_id) ?? 0) + 1);
  }

  for (const lead of leadsRes.data ?? []) {
    const leadId = (lead as { id: string }).id;
    const item = classifyRecoverability({
      latestJob: latestJobByLead.get(leadId) ?? null,
      weakCandidateCount: weakByLead.get(leadId) ?? 0,
      quarantinedCandidateCount: quarantinedByLead.get(leadId) ?? 0,
      queryBuiltCount: queryBuiltByLead.get(leadId) ?? 0,
    });
    counts[item.reason]++;
    if (examples.length < 8) {
      examples.push({ leadId, reason: item.reason, detail: item.detail });
    }
  }

  return { counts, examples };
}

export function buildReviewProposal(candidate: {
  id: string;
  phone_e164: string | null;
  phone_raw: string | null;
  source_label: string | null;
  source_url: string | null;
  snippet: string | null;
  matched_on?: string | null;
  initial_confidence: number | null;
  review_reason: string | null;
}): { candidateId: string; verdict: "approve" | "reject" | "manual"; reason: string } {
  const text = [
    candidate.source_label,
    candidate.source_url,
    candidate.snippet,
    candidate.review_reason,
    candidate.matched_on,
  ].filter(Boolean).join(" ").toLowerCase();
  const confidence = candidate.initial_confidence ?? 0;

  if (/\bfax\b|t[ée]l[ée]copieur/.test(text)) {
    return { candidateId: candidate.id, verdict: "reject", reason: "Fax detected in source evidence." };
  }
  if (/ch sld|chsld|r[ée]sidence|rpa|manoir|centre d['’]h[ée]bergement/.test(text)) {
    return { candidateId: candidate.id, verdict: "reject", reason: "Source looks like an institution, not the owner." };
  }
  if (text.includes("mailing_address") && confidence >= 80) {
    return { candidateId: candidate.id, verdict: "approve", reason: "Mailing address signal with high confidence." };
  }
  if (/(canada411|411\.ca|pagesjaunes|yellowpages)/.test(text) && confidence >= 75) {
    return { candidateId: candidate.id, verdict: "approve", reason: "Public directory signal with review-level confidence." };
  }
  return { candidateId: candidate.id, verdict: "manual", reason: "Evidence remains ambiguous; Anthony should decide." };
}

export async function contactHasValidPhone(
  sb: AnyClient,
  contactId: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from("phones")
    .select("id")
    .eq("contact_id", contactId)
    .in("status", VALID_PHONE_STATUSES as unknown as string[])
    .limit(1);
  if (error) throw new Error(error.message);
  return Boolean(data && data.length > 0);
}
