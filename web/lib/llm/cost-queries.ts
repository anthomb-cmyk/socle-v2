// Query helpers for the /admin/costs page.
// All functions take a pre-built Supabase admin client and a date filter.
// Queries use server-side grouping via Postgres RPC or raw SQL through
// Supabase's .rpc() / .from() interface — we never load all rows into JS.

import type { SupabaseClient } from "@supabase/supabase-js";

export type CostRange = "24h" | "7d" | "30d" | "all";

/** Return a UTC ISO timestamp string representing the start of the range,
 *  or null when range === "all". */
export function rangeToSince(range: CostRange): string | null {
  if (range === "all") return null;
  const now = new Date();
  const hours = range === "24h" ? 24 : range === "7d" ? 24 * 7 : 24 * 30;
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

/** Number of calendar days the range covers (used for projection). */
export function rangeToDays(range: CostRange): number {
  if (range === "24h") return 1;
  if (range === "7d") return 7;
  if (range === "30d") return 30;
  return 30; // fallback for "all" — caller should handle separately
}

export interface TopStats {
  totalCostUsd: number;
  totalCalls: number;
  totalTokens: number;
  avgLatencyMs: number;
}

export interface FeatureRow {
  feature: string;
  calls: number;
  totalTokens: number;
  totalCostUsd: number;
  avgCostUsd: number;
  failureRate: number; // 0–1
}

export interface ModelRow {
  model: string;
  calls: number;
  totalCostUsd: number;
  pctOfTotal: number; // 0–100
}

export interface DailyRow {
  day: string; // YYYY-MM-DD
  totalCostUsd: number;
}

export interface RecentCall {
  id: string;
  created_at: string;
  feature: string;
  model: string;
  cost_usd: number;
  latency_ms: number;
  success: boolean;
  lead_id: string | null;
}

/** Aggregate top-level stats for the selected range/feature/model. */
export async function fetchTopStats(
  sb: SupabaseClient,
  opts: { since: string | null; feature: string | null; model: string | null },
): Promise<TopStats> {
  let q = sb
    .from("llm_usage_log")
    .select("cost_usd, input_tokens, output_tokens, latency_ms");

  if (opts.since) q = q.gte("created_at", opts.since);
  if (opts.feature) q = q.eq("feature", opts.feature);
  if (opts.model) q = q.eq("model", opts.model);

  const { data, error } = await q;
  if (error || !data) return { totalCostUsd: 0, totalCalls: 0, totalTokens: 0, avgLatencyMs: 0 };

  let totalCostUsd = 0;
  let totalTokens = 0;
  let totalLatency = 0;
  for (const row of data) {
    totalCostUsd += Number(row.cost_usd ?? 0);
    totalTokens += (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
    totalLatency += row.latency_ms ?? 0;
  }
  return {
    totalCostUsd,
    totalCalls: data.length,
    totalTokens,
    avgLatencyMs: data.length > 0 ? Math.round(totalLatency / data.length) : 0,
  };
}

/** Per-feature breakdown. Uses JS grouping since Supabase JS client doesn't
 *  expose GROUP BY natively. The row count in range is bounded (< 10k typical)
 *  so this is acceptable; for very large tables use a Postgres view instead. */
export async function fetchFeatureBreakdown(
  sb: SupabaseClient,
  opts: { since: string | null; model: string | null },
): Promise<FeatureRow[]> {
  let q = sb
    .from("llm_usage_log")
    .select("feature, cost_usd, input_tokens, output_tokens, success");

  if (opts.since) q = q.gte("created_at", opts.since);
  if (opts.model) q = q.eq("model", opts.model);

  const { data, error } = await q;
  if (error || !data) return [];

  const map = new Map<string, { calls: number; tokens: number; cost: number; failures: number }>();
  for (const row of data) {
    const key = row.feature as string;
    const existing = map.get(key) ?? { calls: 0, tokens: 0, cost: 0, failures: 0 };
    existing.calls += 1;
    existing.tokens += (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
    existing.cost += Number(row.cost_usd ?? 0);
    if (!row.success) existing.failures += 1;
    map.set(key, existing);
  }

  const rows: FeatureRow[] = [];
  for (const [feature, agg] of map) {
    rows.push({
      feature,
      calls: agg.calls,
      totalTokens: agg.tokens,
      totalCostUsd: agg.cost,
      avgCostUsd: agg.calls > 0 ? agg.cost / agg.calls : 0,
      failureRate: agg.calls > 0 ? agg.failures / agg.calls : 0,
    });
  }
  return rows.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

/** Per-model breakdown. */
export async function fetchModelBreakdown(
  sb: SupabaseClient,
  opts: { since: string | null; feature: string | null },
): Promise<ModelRow[]> {
  let q = sb
    .from("llm_usage_log")
    .select("model, cost_usd");

  if (opts.since) q = q.gte("created_at", opts.since);
  if (opts.feature) q = q.eq("feature", opts.feature);

  const { data, error } = await q;
  if (error || !data) return [];

  const map = new Map<string, { calls: number; cost: number }>();
  let grandTotal = 0;
  for (const row of data) {
    const key = row.model as string;
    const existing = map.get(key) ?? { calls: 0, cost: 0 };
    existing.calls += 1;
    const c = Number(row.cost_usd ?? 0);
    existing.cost += c;
    grandTotal += c;
    map.set(key, existing);
  }

  const rows: ModelRow[] = [];
  for (const [model, agg] of map) {
    rows.push({
      model,
      calls: agg.calls,
      totalCostUsd: agg.cost,
      pctOfTotal: grandTotal > 0 ? (agg.cost / grandTotal) * 100 : 0,
    });
  }
  return rows.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

/** Daily cost aggregation for the bar chart. */
export async function fetchDailyCosts(
  sb: SupabaseClient,
  opts: { since: string | null; feature: string | null; model: string | null },
): Promise<DailyRow[]> {
  let q = sb
    .from("llm_usage_log")
    .select("created_at, cost_usd")
    .order("created_at", { ascending: true });

  if (opts.since) q = q.gte("created_at", opts.since);
  if (opts.feature) q = q.eq("feature", opts.feature);
  if (opts.model) q = q.eq("model", opts.model);

  const { data, error } = await q;
  if (error || !data) return [];

  const map = new Map<string, number>();
  for (const row of data) {
    const day = (row.created_at as string).slice(0, 10); // "YYYY-MM-DD"
    map.set(day, (map.get(day) ?? 0) + Number(row.cost_usd ?? 0));
  }

  return Array.from(map.entries())
    .map(([day, totalCostUsd]) => ({ day, totalCostUsd }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** Fetch the most recent N calls. */
export async function fetchRecentCalls(
  sb: SupabaseClient,
  opts: { since: string | null; feature: string | null; model: string | null; limit: number; offset: number },
): Promise<RecentCall[]> {
  let q = sb
    .from("llm_usage_log")
    .select("id, created_at, feature, model, cost_usd, latency_ms, success, lead_id")
    .order("created_at", { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1);

  if (opts.since) q = q.gte("created_at", opts.since);
  if (opts.feature) q = q.eq("feature", opts.feature);
  if (opts.model) q = q.eq("model", opts.model);

  const { data, error } = await q;
  if (error || !data) return [];
  return data as RecentCall[];
}
