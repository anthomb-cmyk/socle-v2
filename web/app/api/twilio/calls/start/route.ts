// POST /api/twilio/calls/start
//
// Initiates an outbound call using the Twilio forward-to-phone bridge:
//   1. Twilio dials the caller's personal cell (twilio_forward_to from users_meta)
//   2. When the caller answers, Twilio bridges them to the lead's phone
//      via the outbound-bridge TwiML webhook
//
// Body: { leadId, phoneId }
//   leadId  — the lead being called
//   phoneId — which phone number to dial (from phones table)
//
// Returns: { ok: true, data: { callLogId, callSid, status } }

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import {
  getTwilioConfig,
  getAppUrl,
  callTwilioApi,
  normalizePhone,
  escapeXml,
} from "@/lib/twilio";

const Body = z.object({
  leadId:  z.string().uuid(),
  phoneId: z.string().uuid(),
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
      { ok: false, error: "leadId and phoneId (uuid) are required", errors: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const sb = createSupabaseAdminClient();

  // ── Resolve lead + contact (auth check) ───────────────────────────────
  const { data: lead } = await sb
    .from("leads")
    .select("id, assigned_to, contact_id, status")
    .eq("id", body.leadId)
    .single();
  if (!lead) return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });
  if (auth.role !== "admin" && lead.assigned_to !== user.id) {
    return NextResponse.json({ ok: false, error: "Not your lead" }, { status: 403 });
  }

  // ── Resolve the phone to dial ─────────────────────────────────────────
  const { data: phone } = await sb
    .from("phones")
    .select("e164, display")
    .eq("id", body.phoneId)
    .single();
  if (!phone) return NextResponse.json({ ok: false, error: "Phone not found" }, { status: 404 });

  const leadPhone = normalizePhone(phone.e164 ?? "");
  if (!leadPhone) {
    return NextResponse.json({ ok: false, error: "Phone number is not dialable" }, { status: 400 });
  }

  // ── Resolve the caller's numbers ─────────────────────────────────────
  // twilio_forward_to  = caller's personal cell (Twilio rings this first)
  // twilio_from_number = caller's Twilio number (what the lead sees as caller ID)
  const { data: meta } = await sb
    .from("users_meta")
    .select("twilio_forward_to, twilio_from_number, display_name")
    .eq("user_id", user.id)
    .single();

  const forwardToRaw =
    meta?.twilio_forward_to?.trim() ||
    process.env.TWILIO_FORWARD_TO?.trim() ||
    "";
  const forwardTo = normalizePhone(forwardToRaw);

  // Per-user Twilio "from" number, falls back to the shared env var
  const fromNumberRaw =
    meta?.twilio_from_number?.trim() ||
    process.env.TWILIO_PHONE_NUMBER?.trim() ||
    "";
  const fromNumber = normalizePhone(fromNumberRaw);

  if (!forwardTo) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Aucun numéro de renvoi configuré. " +
          "Demande à Anthony de l'ajouter dans Admin → Utilisateurs.",
      },
      { status: 400 },
    );
  }

  if (!fromNumber) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Aucun numéro Twilio configuré pour ce compte. " +
          "Demande à Anthony de l'ajouter dans Admin → Utilisateurs.",
      },
      { status: 400 },
    );
  }

  // ── Validate Twilio config ─────────────────────────────────────────────
  let twilioConfig: ReturnType<typeof getTwilioConfig>;
  let appUrl: string;
  try {
    twilioConfig = getTwilioConfig();
    appUrl = getAppUrl();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }

  // ── Create a pending call_log row first ───────────────────────────────
  const now = new Date().toISOString();
  const { data: log, error: logErr } = await sb
    .from("call_logs")
    .insert({
      lead_id:           body.leadId,
      contact_id:        lead.contact_id,
      phone_id:          body.phoneId,
      user_id:           user.id,
      direction:         "outbound",
      outcome:           null,
      transcript_status: "pending_recording",
      recorded_at:       now,
    })
    .select("id")
    .single();

  if (logErr || !log) {
    return NextResponse.json({ ok: false, error: logErr?.message ?? "Failed to create call log" }, { status: 500 });
  }

  // ── Build webhook URLs ─────────────────────────────────────────────────
  const callLogId   = log.id;
  const leadName    = encodeURIComponent(phone.display ?? leadPhone);
  const encodedPhone = encodeURIComponent(leadPhone);
  const encodedLogId = encodeURIComponent(callLogId);

  const statusCallbackUrl = `${appUrl}/api/twilio/voice/status?callLogId=${encodedLogId}`;
  const bridgeUrl = (
    `${appUrl}/api/twilio/voice/outbound-bridge` +
    `?callLogId=${encodedLogId}` +
    `&leadPhone=${encodedPhone}` +
    `&leadName=${leadName}`
  );

  // ── Initiate the Twilio call ───────────────────────────────────────────
  let twilioCall: Record<string, unknown>;
  try {
    twilioCall = await callTwilioApi("/Calls.json", {
      To:                    forwardTo,
      From:                  fromNumber,
      Url:                   bridgeUrl,
      Method:                "POST",
      StatusCallback:        statusCallbackUrl,
      StatusCallbackMethod:  "POST",
      StatusCallbackEvent:   ["initiated", "ringing", "answered", "completed"],
    });
  } catch (e) {
    // Roll back the pending call_log — it was never actually initiated
    await sb.from("call_logs").delete().eq("id", callLogId);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }

  // ── Save the Twilio call SID back into the log ─────────────────────────
  const callSid = String(twilioCall.sid ?? "").trim() || null;
  const callStatus = String(twilioCall.status ?? "queued").trim();

  await sb
    .from("call_logs")
    .update({ twilio_call_sid: callSid })
    .eq("id", callLogId);

  // ── Audit event ───────────────────────────────────────────────────────
  await sb.from("automation_events").insert({
    source:             "web_app",
    event_type:         "call_initiated",
    status:             "success",
    related_lead_id:    body.leadId,
    related_contact_id: lead.contact_id,
    triggered_by:       user.id,
    payload:            { callLogId, callSid, forwardTo: escapeXml(forwardTo), leadPhone },
  });

  return NextResponse.json({
    ok: true,
    data: { callLogId, callSid, status: callStatus },
  });
}
