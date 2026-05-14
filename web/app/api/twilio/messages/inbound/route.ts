// POST /api/twilio/messages/inbound
//
// Twilio inbound SMS webhook. Configure this URL in Twilio Console as:
// Phone Numbers > Active Numbers > Messaging > "A message comes in".
// It logs the inbound text and returns an empty TwiML response so Twilio does
// not auto-reply or forward a "New SMS from..." wrapper to anyone.

import twilio from "twilio";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { getAppUrl, normalizePhone, twimlResponse } from "@/lib/twilio";

function paramsFromForm(form: FormData): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}

function validationUrls(request: Request): string[] {
  const urls = new Set<string>();

  try {
    const incoming = new URL(request.url);
    const path = `${incoming.pathname}${incoming.search}`;
    urls.add(request.url);

    const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
    if (forwardedHost) {
      urls.add(`${forwardedProto}://${forwardedHost}${path}`);
      urls.add(`https://${forwardedHost}${path}`);
    }

    try {
      urls.add(`${getAppUrl()}${path}`);
    } catch {
      // APP_URL is useful in production, but request/forwarded URLs are enough
      // for local tunnels and some proxy setups.
    }
  } catch {
    urls.add(request.url);
  }

  return [...urls];
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => new FormData());
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const signature = request.headers.get("x-twilio-signature") ?? "";

  if (!authToken) return new Response("Twilio webhook validation is not configured", { status: 503 });

  const params = paramsFromForm(form);
  const valid = validationUrls(request).some((url) => (
    twilio.validateRequest(authToken, signature, url, params)
  ));
  if (!valid) return new Response("Forbidden", { status: 403 });

  const from = normalizePhone(String(form.get("From") ?? ""));
  const to = normalizePhone(String(form.get("To") ?? ""));
  const messageSid = String(form.get("MessageSid") ?? "").trim();
  const body = String(form.get("Body") ?? "").trim();
  const numMedia = Number(form.get("NumMedia") ?? 0);

  const sb = createSupabaseAdminClient();

  let contactId: string | null = null;
  let leadId: string | null = null;
  if (from) {
    const { data: phone } = await sb
      .from("phones")
      .select("contact_id")
      .eq("e164", from)
      .maybeSingle();
    contactId = (phone?.contact_id as string | null) ?? null;

    if (contactId) {
      const { data: lead } = await sb
        .from("leads")
        .select("id")
        .eq("contact_id", contactId)
        .order("last_contacted_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      leadId = (lead?.id as string | null) ?? null;
    }
  }

  await sb.from("automation_events").insert({
    source:             "web_app",
    event_type:         "sms_received",
    status:             "success",
    related_lead_id:    leadId,
    related_contact_id: contactId,
    payload:            { from, to, body, messageSid, numMedia, dealId: null },
    result:             { raw: params },
  });

  return twimlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
}
