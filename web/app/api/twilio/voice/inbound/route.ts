// POST /api/twilio/voice/inbound
//
// Public Twilio webhook for inbound calls to a Socle Twilio number.
// Records the forwarded two-party call, creates a CRM call log, and links the
// call to an investor or seller contact when the caller number is known.

import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { escapeXml, getAppUrl, normalizePhone, twimlResponse } from "@/lib/twilio";

export const runtime = "nodejs";

type MatchResult = {
  investorId: string | null;
  investorCallId: string | null;
  contactId: string | null;
  leadId: string | null;
  phoneId: string | null;
  matchType: "investor" | "contact" | "unmatched";
};

async function resolveCaller(sb: ReturnType<typeof createSupabaseAdminClient>, from: string): Promise<MatchResult> {
  const { data: investor } = await sb
    .from("investors")
    .select("id")
    .eq("phone_e164", from)
    .maybeSingle();

  if (investor?.id) {
    return {
      investorId: investor.id as string,
      investorCallId: null,
      contactId: null,
      leadId: null,
      phoneId: null,
      matchType: "investor",
    };
  }

  const { data: phone } = await sb
    .from("phones")
    .select("id, contact_id")
    .eq("e164", from)
    .not("contact_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const contactId = (phone?.contact_id as string | null) ?? null;
  if (!contactId) {
    return {
      investorId: null,
      investorCallId: null,
      contactId: null,
      leadId: null,
      phoneId: null,
      matchType: "unmatched",
    };
  }

  const { data: lead } = await sb
    .from("leads")
    .select("id")
    .eq("contact_id", contactId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    investorId: null,
    investorCallId: null,
    contactId,
    leadId: (lead?.id as string | null) ?? null,
    phoneId: (phone?.id as string | null) ?? null,
    matchType: "contact",
  };
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => new FormData());
  const callSid = String(form.get("CallSid") ?? "").trim();
  const from = normalizePhone(String(form.get("From") ?? ""));
  const to = normalizePhone(String(form.get("To") ?? ""));

  let appUrl: string;
  try {
    appUrl = getAppUrl();
  } catch {
    return twimlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Reject reason="busy"/>
</Response>`);
  }

  const forwardTo = normalizePhone(process.env.TWILIO_FORWARD_TO?.trim() ?? "");
  if (!forwardTo) {
    return twimlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="fr-CA" voice="alice">Erreur de configuration. Aucun numéro de renvoi n'est configuré.</Say>
  <Hangup/>
</Response>`);
  }

  const sb = createSupabaseAdminClient();
  const match = from ? await resolveCaller(sb, from) : {
    investorId: null,
    investorCallId: null,
    contactId: null,
    leadId: null,
    phoneId: null,
    matchType: "unmatched" as const,
  };

  const now = new Date().toISOString();
  const raw = {
    inbound: true,
    from,
    to,
    match_type: match.matchType,
    investor_id: match.investorId,
    contact_id: match.contactId,
    lead_id: match.leadId,
    phone_id: match.phoneId,
    twilio: Object.fromEntries(form.entries()),
  };

  let callLogId = "";
  const { data: existingLog } = callSid
    ? await sb.from("call_logs").select("id").eq("twilio_call_sid", callSid).maybeSingle()
    : { data: null };

  if (existingLog?.id) {
    callLogId = existingLog.id as string;
  } else {
    const { data: log, error } = await sb
      .from("call_logs")
      .insert({
        lead_id: match.leadId,
        contact_id: match.contactId,
        phone_id: match.phoneId,
        user_id: null,
        twilio_call_sid: callSid || null,
        direction: "inbound",
        outcome: null,
        transcript_status: "pending_recording",
        recorded_at: now,
        raw,
      })
      .select("id")
      .single();

    if (!error && log?.id) callLogId = log.id as string;
  }

  let investorCallId = "";
  if (match.investorId) {
    const { data: existingInvestorCall } = callSid
      ? await sb.from("investor_calls").select("id").eq("twilio_call_sid", callSid).maybeSingle()
      : { data: null };

    if (existingInvestorCall?.id) {
      investorCallId = existingInvestorCall.id as string;
    } else {
      const { data: investorCall } = await sb
        .from("investor_calls")
        .insert({
          investor_id: match.investorId,
          twilio_call_sid: callSid || null,
          direction: "inbound",
          duration_sec: null,
          transcript_status: "pending",
          started_at: now,
          recorded_at: null,
          raw,
        })
        .select("id")
        .single();
      investorCallId = (investorCall?.id as string | undefined) ?? "";
    }
  }

  const statusCallbackUrl =
    `${appUrl}/api/twilio/voice/status?callLogId=${encodeURIComponent(callLogId)}`;
  const recordingCallbackUrl =
    `${appUrl}/api/twilio/voice/recording?callLogId=${encodeURIComponent(callLogId)}` +
    (investorCallId ? `&investorCallId=${encodeURIComponent(investorCallId)}` : "");

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true" timeout="20" record="record-from-answer-dual" recordingStatusCallback="${escapeXml(recordingCallbackUrl)}" recordingStatusCallbackMethod="POST">
    <Number statusCallback="${escapeXml(statusCallbackUrl)}" statusCallbackMethod="POST" statusCallbackEvent="initiated ringing answered completed">${escapeXml(forwardTo)}</Number>
  </Dial>
</Response>`;

  return twimlResponse(twiml);
}
