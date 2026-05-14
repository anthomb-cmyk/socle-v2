// POST /api/twilio/messages/send-direct
//
// Sends an SMS reply from the Textos inbox. The recipient sees the configured
// Twilio number only. Optional lead/contact/deal ids keep the audit trail tied
// to the CRM record that the inbox already matched.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { callTwilioApi, getTwilioCredentials, normalizePhone } from "@/lib/twilio";

const Body = z.object({
  to:        z.string().min(1),
  message:   z.string().trim().min(1).max(1000),
  leadId:    z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  dealId:    z.string().uuid().nullable().optional(),
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
      { ok: false, error: "to and message are required", errors: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const sb = createSupabaseAdminClient();
  const toNumber = normalizePhone(body.to);
  if (!toNumber) return NextResponse.json({ ok: false, error: "Numéro invalide." }, { status: 400 });

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
    return NextResponse.json({ ok: false, error: "Aucun numéro Twilio configuré." }, { status: 400 });
  }
  if (toNumber === fromNumber || (forwardTo && toNumber === forwardTo)) {
    return NextResponse.json(
      { ok: false, error: "Refus d'envoyer un texto à ton propre numéro Twilio/renvoi." },
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
      related_lead_id:    body.leadId ?? null,
      related_contact_id: body.contactId ?? null,
      triggered_by:       user.id,
      payload:            { to: toNumber, from: fromNumber, dealId: body.dealId ?? null },
      error_message:      (e as Error).message,
    });
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }

  const sid = String(twilioMessage.sid ?? "").trim();
  const status = String(twilioMessage.status ?? "queued").trim();
  const payload = {
    to: toNumber,
    from: fromNumber,
    body: body.message,
    dealId: body.dealId ?? null,
  };

  await sb.from("automation_events").insert({
    source:             "web_app",
    event_type:         "sms_sent",
    status:             "success",
    related_lead_id:    body.leadId ?? null,
    related_contact_id: body.contactId ?? null,
    triggered_by:       user.id,
    payload,
    result:             { sid, status },
  });

  if (body.dealId) {
    await appendDealActivity(sb, body.dealId, `SMS envoyé à ${toNumber}: ${body.message}`);
  }

  return NextResponse.json({ ok: true, data: { sid, status, to: toNumber, from: fromNumber } });
}

async function appendDealActivity(sb: ReturnType<typeof createSupabaseAdminClient>, dealId: string, text: string) {
  const { data: deal } = await sb.from("deals").select("activities").eq("id", dealId).single();
  const prev = Array.isArray(deal?.activities) ? deal.activities : [];
  await sb
    .from("deals")
    .update({
      activities: [{ id: crypto.randomUUID(), text: text.slice(0, 500), time: new Date().toISOString() }, ...prev],
      updated_at: new Date().toISOString(),
    })
    .eq("id", dealId);
}
