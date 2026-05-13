// POST /api/twilio/messages/send
//
// Sends an SMS from the caller's configured Twilio number to the selected lead
// phone. This is the safe reply path: the recipient sees the Twilio number as
// the sender, not the caller's personal phone or Twilio's forwarding wrapper.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import {
  callTwilioApi,
  getTwilioCredentials,
  normalizePhone,
} from "@/lib/twilio";

const Body = z.object({
  leadId:  z.string().uuid(),
  phoneId: z.string().uuid(),
  message: z.string().trim().min(1).max(1000),
});

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "leadId, phoneId and message are required", errors: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const sb = createSupabaseAdminClient();

  const { data: lead } = await sb
    .from("leads")
    .select("id, assigned_to, contact_id")
    .eq("id", body.leadId)
    .single();
  if (!lead) return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });
  if (auth.role !== "admin" && lead.assigned_to !== user.id) {
    return NextResponse.json({ ok: false, error: "Not your lead" }, { status: 403 });
  }

  const { data: phone } = await sb
    .from("phones")
    .select("id, contact_id, e164, display")
    .eq("id", body.phoneId)
    .single();
  if (!phone) return NextResponse.json({ ok: false, error: "Phone not found" }, { status: 404 });
  if (phone.contact_id !== lead.contact_id) {
    return NextResponse.json({ ok: false, error: "Phone does not belong to this lead" }, { status: 400 });
  }

  const toNumber = normalizePhone(phone.e164 ?? "");
  if (!toNumber) {
    return NextResponse.json({ ok: false, error: "Phone number is not textable" }, { status: 400 });
  }

  const { data: meta } = await sb
    .from("users_meta")
    .select("twilio_forward_to, twilio_from_number")
    .eq("user_id", user.id)
    .single();

  const fromNumber = normalizePhone(
    meta?.twilio_from_number?.trim() ||
    process.env.TWILIO_PHONE_NUMBER?.trim() ||
    "",
  );
  const forwardTo = normalizePhone(
    meta?.twilio_forward_to?.trim() ||
    process.env.TWILIO_FORWARD_TO?.trim() ||
    "",
  );

  if (!fromNumber) {
    return NextResponse.json(
      { ok: false, error: "No Twilio sender number is configured for this account." },
      { status: 400 },
    );
  }
  if (toNumber === fromNumber || (forwardTo && toNumber === forwardTo)) {
    return NextResponse.json(
      { ok: false, error: "Refusing to send SMS to your own Twilio/forwarding number." },
      { status: 400 },
    );
  }

  try {
    getTwilioCredentials();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }

  let twilioMessage: Record<string, unknown>;
  try {
    twilioMessage = await callTwilioApi("/Messages.json", {
      To:   toNumber,
      From: fromNumber,
      Body: body.message,
    });
  } catch (e) {
    await sb.from("automation_events").insert({
      source:             "web_app",
      event_type:         "sms_send_failed",
      status:             "failed",
      related_lead_id:    body.leadId,
      related_contact_id: lead.contact_id,
      triggered_by:       user.id,
      payload:            { to: toNumber, from: fromNumber, phoneId: body.phoneId },
      error_message:      (e as Error).message,
    });
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }

  const sid = String(twilioMessage.sid ?? "").trim();
  const status = String(twilioMessage.status ?? "queued").trim();

  await sb.from("automation_events").insert({
    source:             "web_app",
    event_type:         "sms_sent",
    status:             "success",
    related_lead_id:    body.leadId,
    related_contact_id: lead.contact_id,
    triggered_by:       user.id,
    payload:            { to: toNumber, from: fromNumber, phoneId: body.phoneId, body: body.message },
    result:             { sid, status },
  });

  return NextResponse.json({ ok: true, data: { sid, status, to: toNumber, from: fromNumber } });
}
