// Centralized Anthropic API client with automatic cost logging.
//
// Every Haiku/Sonnet call in the codebase goes through callAnthropic().
// Each call writes a row to llm_usage_log capturing:
//   - feature  : "g6_haiku_validation" | "address_fallback" | "briefing" | ...
//   - model    : the model string
//   - input/output token counts (from the API response)
//   - cost in USD (computed from MODEL_PRICING)
//   - latency ms
//   - lead_id / candidate_id when available
//   - success/failure + error_message
//
// All cost-tracking and per-feature analytics flow from this single table.
// Failures are logged too — if Anthropic returns 429/500 we still want the
// row so the admin /admin/costs page can show outage windows.

import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { computeCostUsd } from "./pricing";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export type LlmFeature =
  | "g6_haiku_validation"
  | "address_fallback"
  | "name_fallback"
  | "owner_kind_fallback"
  | "format_detection"
  | "briefing"
  | "query_rewriting"
  | "evidence_summary"
  | "call_summary"
  | "deal_fit_score"
  | "auto_segment"
  | "outreach_draft"
  | "chat_with_data"
  | "objection_coach";

export interface CallAnthropicOptions {
  /** Which feature is calling — used for cost-tracking analytics. */
  feature: LlmFeature;
  /** Model string. Defaults to claude-haiku-4-5. */
  model?: string;
  /** Max tokens to generate. Default 400. */
  maxTokens?: number;
  /** The user message content. */
  prompt: string;
  /** Optional system prompt. */
  system?: string;
  /** Lead this call relates to (for per-lead cost drill-down). */
  leadId?: string;
  /** Candidate this call relates to (for per-candidate cost drill-down). */
  candidateId?: string;
  /** Free-form metadata to store on the log row. */
  metadata?: Record<string, unknown>;
}

export interface CallAnthropicResult {
  /** Raw text content of the model response. */
  text: string;
  /** Was the call successful? */
  ok: boolean;
  /** Token counts from the API. */
  inputTokens: number;
  outputTokens: number;
  /** Computed USD cost. */
  costUsd: number;
  /** Wall-clock latency in ms. */
  latencyMs: number;
  /** HTTP status. */
  status: number;
  /** Error message if !ok. */
  error?: string;
  /** Logged usage row id. */
  usageLogId?: string;
}

/** Make an Anthropic Messages API call, log usage, return the result.
 *  Returns ok:false (not throws) when the API key is missing or the call fails,
 *  so callers can have graceful no-op behavior. */
export async function callAnthropic(opts: CallAnthropicOptions): Promise<CallAnthropicResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = opts.model ?? "claude-haiku-4-5";
  const maxTokens = opts.maxTokens ?? 400;
  const startedAt = Date.now();

  if (!apiKey) {
    // No-op gracefully so callers can let deterministic logic carry on.
    return {
      text: "",
      ok: false,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      status: 0,
      error: "ANTHROPIC_API_KEY not set",
    };
  }

  const messages: Array<{ role: "user"; content: string }> = [
    { role: "user", content: opts.prompt },
  ];
  const body: Record<string, unknown> = { model, max_tokens: maxTokens, messages };
  if (opts.system) body.system = opts.system;

  let res: Response;
  let httpStatus = 0;
  let errMsg: string | undefined;

  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
    httpStatus = res.status;
  } catch (err) {
    errMsg = `fetch failed: ${(err as Error).message}`;
    const latencyMs = Date.now() - startedAt;
    await logUsage({
      feature: opts.feature, model, inputTokens: 0, outputTokens: 0, costUsd: 0,
      latencyMs, success: false, status: 0, error: errMsg,
      leadId: opts.leadId, candidateId: opts.candidateId, metadata: opts.metadata,
    });
    return { text: "", ok: false, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs, status: 0, error: errMsg };
  }

  if (!res.ok) {
    errMsg = `${res.status}: ${(await res.text().catch(() => "")) || res.statusText}`;
    const latencyMs = Date.now() - startedAt;
    await logUsage({
      feature: opts.feature, model, inputTokens: 0, outputTokens: 0, costUsd: 0,
      latencyMs, success: false, status: httpStatus, error: errMsg,
      leadId: opts.leadId, candidateId: opts.candidateId, metadata: opts.metadata,
    });
    return { text: "", ok: false, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs, status: httpStatus, error: errMsg };
  }

  let data: {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  try { data = await res.json(); }
  catch (err) {
    errMsg = `bad JSON: ${(err as Error).message}`;
    const latencyMs = Date.now() - startedAt;
    await logUsage({
      feature: opts.feature, model, inputTokens: 0, outputTokens: 0, costUsd: 0,
      latencyMs, success: false, status: httpStatus, error: errMsg,
      leadId: opts.leadId, candidateId: opts.candidateId, metadata: opts.metadata,
    });
    return { text: "", ok: false, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs, status: httpStatus, error: errMsg };
  }

  const text = (data.content ?? []).map(c => c.text ?? "").join("").trim();
  const inputTokens  = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  const costUsd = computeCostUsd(model, inputTokens, outputTokens);
  const latencyMs = Date.now() - startedAt;

  const usageLogId = await logUsage({
    feature: opts.feature, model, inputTokens, outputTokens, costUsd,
    latencyMs, success: true, status: httpStatus,
    leadId: opts.leadId, candidateId: opts.candidateId, metadata: opts.metadata,
  });

  return { text, ok: true, inputTokens, outputTokens, costUsd, latencyMs, status: httpStatus, usageLogId };
}

interface LogUsageInput {
  feature: LlmFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  success: boolean;
  status: number;
  error?: string;
  leadId?: string;
  candidateId?: string;
  metadata?: Record<string, unknown>;
}

async function logUsage(input: LogUsageInput): Promise<string | undefined> {
  try {
    const sb = createSupabaseAdminClient();
    const { data } = await sb.from("llm_usage_log").insert({
      feature:        input.feature,
      model:          input.model,
      input_tokens:   input.inputTokens,
      output_tokens:  input.outputTokens,
      cost_usd:       input.costUsd,
      latency_ms:     input.latencyMs,
      success:        input.success,
      http_status:    input.status,
      error_message:  input.error ?? null,
      lead_id:        input.leadId ?? null,
      candidate_id:   input.candidateId ?? null,
      metadata:       input.metadata ?? null,
    }).select("id").single();
    return (data as { id: string } | null)?.id;
  } catch (err) {
    // Never let logging break the actual call.
    console.error("[anthropic-client] usage logging failed:", err);
    return undefined;
  }
}

/** Helper: parse the first JSON object out of a Haiku response.
 *  Many features ask for structured JSON output; this lifts the parsing
 *  into one place. */
export function parseFirstJson<T>(text: string): T | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; }
  catch { return null; }
}
