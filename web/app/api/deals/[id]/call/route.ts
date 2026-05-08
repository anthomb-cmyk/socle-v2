// POST /api/deals/[id]/call
//
// Initiates an outbound Twilio call for a deal's seller contact, using the
// same bridge model as /api/twilio/calls/start (lead queue flow):
//   1. Twilio dials the user's personal cell (twilio_forward_to)
//   2. When they answer, Twilio bridges them to the seller's phone
//
// Body: { phone_e164 }  — the seller's E.164 number (deal.contact_phone)
//
// Returns: { ok: true, data: { callLogId, callSid, status } }
//
// The call_log row is created with lead_id=null / phone_id=null (both are
// nullable FKs in schema). The deal_id is stored in the raw JSONB column
// for traceability.

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

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id: dealId } = await ctx.params;

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

  // ── Verify deal exists ────────────────────────────────────────────────────
  const { data: deal } = await sb
    .from("deals")
    .select("id, title, contact_name")
    .eq("id", dealId)
    .single();

  if (!deal) {
    return NextResponse.json({ ok: false, error: "Deal non trouvé" }, { status: 404 });
  }

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
  // lead_id and phone_id are nullable — we store deal_id in raw for tracing.
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
      raw:               { deal_id: dealId, deal_title: deal.title, lead_phone: leadPhone },
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
  const callLogId     = log.id as string;
  const contactName   = escapeXml(deal.contact_name ?? "Vendeur");
  const encodedLogId  = encodeURIComponent(callLogId);
  const encodedPhone  = encodeURIComponent(leadPhone);
  const encodedName   = encodeURIComponent(contactName);

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
    // Roll back the pending call_log — the call was never initiated
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
