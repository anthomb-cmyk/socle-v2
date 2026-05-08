/**
 * rate-limits.ts — daily rate caps for external API calls.
 *
 * Backed by the `api_daily_usage(date, key, count)` table.  Each call
 * atomically increments today's counter for the given key (via the
 * `increment_api_daily_usage` Postgres function) and returns whether the
 * caller is still under `max`.
 *
 * Used by:
 *   - lib/twilio/lookup.ts        key="twilio_lookups"   default cap 200
 *   - lib/enrichment/brave-search key="brave_queries"    default cap 1000
 *
 * If the RPC fails (e.g. migration not applied yet), we fail OPEN — return
 * `{ allowed: true, used: 0 }` and log.  The intent of caps is cost control
 * during cutover, not correctness.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

export interface CapResult {
  allowed: boolean;
  used: number;
}

/**
 * Atomically increment the daily counter for `key` and return whether the
 * caller is still within `max`.  When the new count exceeds `max`, returns
 * `{ allowed: false }` — the caller should skip the API call.
 *
 * NOTE: Because the increment happens before the check, exceeding `max` by 1
 * is recorded.  The next call sees `used > max` and is denied.  This is the
 * intentional simple semantics — no compensating decrement.
 */
export async function checkAndIncrementDailyCap(
  sb: AnyClient,
  key: string,
  max: number,
): Promise<CapResult> {
  try {
    const { data, error } = await sb.rpc("increment_api_daily_usage", {
      p_key: key,
    });
    if (error) {
      console.warn(`[rate-limits] RPC failed for ${key}:`, error.message);
      return { allowed: true, used: 0 };
    }
    const used = typeof data === "number" ? data : 0;
    return { allowed: used <= max, used };
  } catch (err) {
    console.warn(`[rate-limits] threw for ${key}:`, err);
    return { allowed: true, used: 0 };
  }
}

/**
 * Read today's counter for `key` without incrementing — used by the admin
 * monitoring page.  Returns 0 if no row exists yet.
 */
export async function getDailyUsage(
  sb: AnyClient,
  key: string,
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from("api_daily_usage")
    .select("count")
    .eq("date", today)
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return 0;
  return (data as { count: number }).count;
}

/** Default cap for Twilio Lookup v2 calls per day (override via env). */
export const DEFAULT_TWILIO_DAILY_CAP = 200;

/** Default cap for Brave Search queries per day (override via env). */
export const DEFAULT_BRAVE_DAILY_CAP = 1000;

/** Resolve the Twilio cap from env, falling back to the default. */
export function getTwilioDailyCap(): number {
  const raw = process.env.MAX_TWILIO_LOOKUPS_PER_DAY;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TWILIO_DAILY_CAP;
}

/** Resolve the Brave cap from env, falling back to the default. */
export function getBraveDailyCap(): number {
  const raw = process.env.MAX_BRAVE_QUERIES_PER_DAY;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BRAVE_DAILY_CAP;
}
