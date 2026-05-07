/**
 * lookup.ts — Twilio Lookup v2 wrapper with Supabase cache.
 *
 * Cache table: twilio_lookup_log
 * TTL: 30 days (set at insert time via expires_at)
 * Cost: $0.04 per live call (caller-name + line_type_intelligence)
 *
 * If TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are missing, returns an error
 * object rather than throwing, so the pipeline can continue gracefully.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone } from "../twilio";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

export interface LookupResult {
  caller_name: string | null;
  caller_type: string | null;
  line_type: string | null;
  cached: boolean;
  error?: string;
}

interface TwilioCallerNameResult {
  caller_name: string | null;
  caller_type: string | null;
}

interface TwilioLineTypeResult {
  type: string | null;
}

interface TwilioLookupV2Response {
  caller_name?: TwilioCallerNameResult;
  line_type_intelligence?: TwilioLineTypeResult;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

interface CacheRow {
  carrier_name: string | null;
  caller_type: string | null;
  line_type: string | null;
}

async function getCachedLookup(
  sb: AnyClient,
  e164: string,
): Promise<CacheRow | null> {
  const { data } = await sb
    .from("twilio_lookup_log")
    .select("carrier_name, caller_type, line_type")
    .eq("phone_e164", e164)
    .gt("expires_at", new Date().toISOString())
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as CacheRow | null) ?? null;
}

async function insertCacheRow(
  sb: AnyClient,
  e164: string,
  callerName: string | null,
  callerType: string | null,
  lineType: string | null,
  rawResponse: TwilioLookupV2Response,
): Promise<void> {
  await sb.from("twilio_lookup_log").insert({
    phone_e164: e164,
    carrier_name: callerName,
    caller_type: callerType,
    line_type: lineType,
    cost_usd: 0.04,
    raw_response: rawResponse as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------
// Twilio API call
// ---------------------------------------------------------------------------

async function fetchFromTwilio(
  accountSid: string,
  authToken: string,
  e164: string,
): Promise<TwilioLookupV2Response> {
  const encoded = encodeURIComponent(e164);
  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encoded}?Fields=caller_name,line_type_intelligence`;

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio Lookup API ${res.status}: ${text}`);
  }

  return (await res.json()) as TwilioLookupV2Response;
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Look up caller-name and line-type for an E.164 phone number.
 *
 * - Checks the cache table first (rows with expires_at > now()).
 * - On cache miss, calls Twilio Lookup v2 and caches the result.
 * - If env vars are missing, returns an error object (does NOT throw).
 * - The `e164` parameter is normalised before the cache lookup.
 */
export async function lookupCallerName(
  sb: AnyClient,
  e164: string,
): Promise<LookupResult> {
  // Normalise input
  const normalized = normalizePhone(e164) || e164;

  // Check env vars
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";

  if (!accountSid || !authToken) {
    return {
      caller_name: null,
      caller_type: null,
      line_type: null,
      cached: false,
      error: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set",
    };
  }

  // Cache hit?
  try {
    const cached = await getCachedLookup(sb, normalized);
    if (cached) {
      return {
        caller_name: cached.carrier_name,
        caller_type: cached.caller_type,
        line_type: cached.line_type,
        cached: true,
      };
    }
  } catch (err) {
    console.error("[twilio/lookup] cache read error:", err);
    // Fall through to live call
  }

  // Live Twilio call
  try {
    const raw = await fetchFromTwilio(accountSid, authToken, normalized);

    const callerName = raw.caller_name?.caller_name ?? null;
    const callerType = raw.caller_name?.caller_type ?? null;
    const lineType = raw.line_type_intelligence?.type ?? null;

    await insertCacheRow(sb, normalized, callerName, callerType, lineType, raw);

    return {
      caller_name: callerName,
      caller_type: callerType,
      line_type: lineType,
      cached: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      caller_name: null,
      caller_type: null,
      line_type: null,
      cached: false,
      error: `Twilio lookup failed: ${msg}`,
    };
  }
}
