// Shared Twilio helpers used by all /api/twilio/* route handlers.
//
// Required env vars:
//   TWILIO_ACCOUNT_SID   — Twilio account SID (starts with "AC…")
//   TWILIO_AUTH_TOKEN    — Twilio auth token
//   TWILIO_PHONE_NUMBER  — the E.164 Twilio number that places calls
//
// Optional:
//   TWILIO_FORWARD_TO    — global fallback caller cell (used if user has no
//                          twilio_forward_to set in their users_meta row)
//   APP_URL              — base URL for Twilio webhooks (falls back to
//                          NEXT_PUBLIC_APP_URL)

/** Returns the configured env vars or throws with a clear message. */
export function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const authToken  = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const fromNumber = process.env.TWILIO_PHONE_NUMBER?.trim() ?? "";
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error(
      "Twilio non configuré — définis TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN et TWILIO_PHONE_NUMBER dans .env.local"
    );
  }
  return { accountSid, authToken, fromNumber };
}

/** Returns REST API credentials without requiring a default sender number. */
export function getTwilioCredentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const authToken  = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  if (!accountSid || !authToken) {
    throw new Error("Twilio non configuré — définis TWILIO_ACCOUNT_SID et TWILIO_AUTH_TOKEN dans .env.local");
  }
  return { accountSid, authToken };
}

/** HTTP Basic auth header for Twilio REST API calls. */
export function twilioBasicAuth(accountSid: string, authToken: string): string {
  return "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
}

/** Public base URL for Twilio webhook callbacks. */
export function getAppUrl(): string {
  const url = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  if (!url) throw new Error("APP_URL (ou NEXT_PUBLIC_APP_URL) est requis pour les webhooks Twilio.");
  return url.replace(/\/$/, "");
}

/**
 * POST to the Twilio REST API.
 * endpoint — path after /2010-04-01/Accounts/{SID}, e.g. "/Calls.json"
 * body     — object whose keys become URL-encoded form fields
 */
export async function callTwilioApi(
  endpoint: string,
  body: Record<string, string | string[]>,
): Promise<Record<string, unknown>> {
  const { accountSid, authToken } = getTwilioCredentials();
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}${endpoint}`;

  // Twilio REST API uses application/x-www-form-urlencoded.
  // Arrays (e.g. StatusCallbackEvent) must become repeated fields:
  //   StatusCallbackEvent=initiated&StatusCallbackEvent=ringing&…
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(body)) {
    if (Array.isArray(val)) {
      for (const v of val) params.append(key, v);
    } else {
      params.append(key, val);
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: twilioBasicAuth(accountSid, authToken),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json.message as string) || `Twilio error ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/**
 * Normalise any phone string to E.164.
 * Strips all non-digit chars, adds +1 prefix if the result is 10 digits.
 * Returns "" if the input is empty or un-normalizable.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
  // Already E.164-ish (with or without "+")
  if (digits.length > 10) return `+${digits}`;
  return "";
}

/** Minimal XML escaping for TwiML strings. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Send a TwiML XML response (text/xml, no-cache). */
export function twimlResponse(twiml: string): Response {
  return new Response(twiml, {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
