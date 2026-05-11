// POST /api/quick-call/start
//
// Initiates an outbound Twilio call for an unknown caller — no lead context.
// Same bridge model as /api/deals/[id]/call/route.ts:
//   1. Twilio dials the user's personal cell (twilio_forward_to)
//   2. When they answer, Twilio bridges them to the given phone number
//
// Body: { phone_e164 }
// Returns: { ok: true, data: { callLogId, callSid, status } }
//
// The call_log row is created with lead_id=null / contact_id=null / phone_id=null.
// quick_call=true + phone_e164 are stored in raw JSONB for the convert endpoint.

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
  phone_e164: z.string().min(1),
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
      { ok: false, error: "phone_e164 est requis", errors: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const leadPhone = normalizePhone(body.phone_e164);
  if (!leadPhone) {
    return NextResponse.json(
      { ok: false, error: "Numéro de téléphone invalide ou non composable." },
      { status: 400 },
    );
  }

  const sb = createSupabaseAdminClient();

  // ── Resolve caller's forward-to and from numbers ──────────────────────────
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

  // ── Validate Twilio config ────────────────────────────────────────────────
  let appUrl: string;
  try {
    getTwilioConfig();
    appUrl = getAppUrl();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }

  // ── Create pending call_log row ───────────────────────────────────────────
  const now = new Date().toISOString();
  const { data: log, error: logErr } = await sb
    .from("call_logs")
    .insert({
      lead_id:           null,
      contact_id:        null,
      phone_id:          null,
      user_id:           user.id,
      direction:         "outbound",
      outcome:           null,
      transcript_status: "pending_recording",
      recorded_at:       now,
      raw:               { quick_call: true, phone_e164: leadPhone },
    })
    .select("id")
    .single();

  if (logErr || !log) {
    return NextResponse.json(
      { ok: false, error: logErr?.message ?? "Impossible de créer le journal d'appel" },
      { status: 500 },
    );
  }

  // ── Build Twilio webhook URLs ─────────────────────────────────────────────
  const callLogId    = log.id as string;
  const contactName  = escapeXml("Inconnu");
  const encodedLogId = encodeURIComponent(callLogId);
  const encodedPhone = encodeURIComponent(leadPhone);
  const encodedName  = encodeURIComponent(contactName);

  const statusCallbackUrl = `${appUrl}/api/twilio/voice/status?callLogId=${encodedLogId}`;
  const bridgeUrl = (
    `${appUrl}/api/twilio/voice/outbound-bridge` +
    `?callLogId=${encodedLogId}` +
    `&leadPhone=${encodedPhone}` +
    `&leadName=${encodedName}`
  );

  // ── Initiate Twilio call ──────────────────────────────────────────────────
  let twilioCall: Record<string, unknown>;
  try {
    twilioCall = await callTwilioApi("/Calls.json", {
      To:                   forwardTo,
      From:                 fromNumber,
      Url:                  bridgeUrl,
      Method:               "POST",
      StatusCallback:       statusCallbackUrl,
      StatusCallbackMethod: "POST",
      StatusCallbackEvent:  ["initiated", "ringing", "answered", "completed"],
    });
  } catch (e) {
    await sb.from("call_logs").delete().eq("id", callLogId);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }

  // ── Persist Twilio call SID ───────────────────────────────────────────────
  const callSid    = String(twilioCall.sid ?? "").trim() || null;
  const callStatus = String(twilioCall.status ?? "queued").trim();

  await sb
    .from("call_logs")
    .update({ twilio_call_sid: callSid })
    .eq("id", callLogId);

  return NextResponse.json({
    ok: true,
    data: { callLogId, callSid, status: callStatus },
  });
}
