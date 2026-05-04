// POST /api/twilio/voice/outbound-bridge
//
// TwiML webhook — Twilio calls this URL when the caller answers their phone.
// Returns TwiML that bridges the caller to the lead's phone number.
//
// All calls are recorded (record-from-answer-dual):
//   - one track for the caller, one for the lead
//   - recording webhook → /api/twilio/voice/recording
//
// Query params (set by /api/twilio/calls/start):
//   callLogId  — our internal call_log row id
//   leadPhone  — E.164 number to dial for the lead
//   leadName   — display name for the lead (shown in Twilio console)
//
// No auth — this endpoint is called by Twilio's servers directly.
// Twilio signature validation is left as a future hardening step.

import { getAppUrl, escapeXml, twimlResponse, normalizePhone } from "@/lib/twilio";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const callLogId  = url.searchParams.get("callLogId") ?? "";
  const leadPhone  = normalizePhone(url.searchParams.get("leadPhone") ?? "");
  const leadName   = url.searchParams.get("leadName") ?? "";

  // Guard: if the lead phone couldn't be resolved, say so and hang up
  if (!leadPhone) {
    return twimlResponse(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="fr-CA" voice="alice">Numéro du contact invalide. Fin de l'appel.</Say>
</Response>`
    );
  }

  let appUrl: string;
  try {
    appUrl = getAppUrl();
  } catch {
    return twimlResponse(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="fr-CA" voice="alice">Erreur de configuration du serveur. Fin de l'appel.</Say>
</Response>`
    );
  }

  const encodedLogId = encodeURIComponent(callLogId);
  const statusCallbackUrl   = `${appUrl}/api/twilio/voice/status?callLogId=${encodedLogId}`;
  const recordingCallbackUrl = `${appUrl}/api/twilio/voice/recording?callLogId=${encodedLogId}`;

  // <Dial> attributes:
  //   answerOnBridge  — caller hears ringing until lead picks up
  //   record          — record-from-answer-dual records both audio tracks
  //   recordingStatusCallback — fires POST when recording is ready
  //
  // <Number> attributes:
  //   statusCallback / statusCallbackEvent — fires for each leg status change
  //   (these go on <Number>, NOT on <Dial> — Twilio silently ignores them on <Dial>)
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial answerOnBridge="true" timeout="20" record="record-from-answer-dual" recordingStatusCallback="${escapeXml(recordingCallbackUrl)}" recordingStatusCallbackMethod="POST">
    <Number statusCallback="${escapeXml(statusCallbackUrl)}" statusCallbackMethod="POST" statusCallbackEvent="initiated ringing answered completed">${escapeXml(leadPhone)}</Number>
  </Dial>
</Response>`;

  // Return TwiML immediately — Twilio has a short webhook timeout.
  // Log the bridge attempt fire-and-forget after the response is sent.
  if (callLogId) {
    const sb = createSupabaseAdminClient();
    sb.from("call_logs")
      .update({ raw: { bridge_attempted_at: new Date().toISOString(), lead_name: leadName } })
      .eq("id", callLogId)
      .then(() => {/* fire and forget */});
  }

  return twimlResponse(twiml);
}
