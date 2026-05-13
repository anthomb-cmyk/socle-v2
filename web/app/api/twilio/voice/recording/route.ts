// POST /api/twilio/voice/recording
//
// Twilio recording status callback — fires when a recording is ready.
// Body fields of interest:
//   RecordingStatus   — "completed" | "failed" | "absent"
//   RecordingUrl      — bare URL (no extension) to the recording
//   RecordingSid      — Twilio RecordingSid
//   CallSid           — SID of the call that was recorded
//
// On "completed":
//   1. Update call_log with recording_url + recording_sid
//   2. Set transcript_status = "processing"
//   3. Kick off async Whisper transcription (fire-and-forget)
//   4. Update transcript + transcript_status when done
//
// No auth — called directly by Twilio.
// Query param: callLogId — our internal call_log row id

import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { transcribeTwilioRecording } from "@/lib/transcribe";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const callLogId = url.searchParams.get("callLogId") ?? "";
  const investorCallId = url.searchParams.get("investorCallId") ?? "";

  const form = await request.formData().catch(() => new FormData());
  const recordingStatus   = String(form.get("RecordingStatus") ?? "").trim();
  const recordingUrl      = String(form.get("RecordingUrl") ?? "").trim();
  const recordingSid      = String(form.get("RecordingSid") ?? "").trim();
  const callSid           = String(form.get("CallSid") ?? "").trim();
  const recordingDuration = Number(form.get("RecordingDuration") ?? 0);

  const sb = createSupabaseAdminClient();

  // Resolve call_log
  let logId = callLogId;
  if (!logId && callSid) {
    const { data } = await sb
      .from("call_logs")
      .select("id")
      .or(`twilio_call_sid.eq.${callSid},parent_call_sid.eq.${callSid}`)
      .maybeSingle();
    if (data) logId = data.id as string;
  }

  let investorLogId = investorCallId;
  if (!investorLogId && callSid) {
    const { data } = await sb
      .from("investor_calls")
      .select("id")
      .or(`twilio_call_sid.eq.${callSid},parent_call_sid.eq.${callSid}`)
      .maybeSingle();
    if (data) investorLogId = data.id as string;
  }

  if (!logId && !investorLogId) return new Response(null, { status: 204 });

  if (recordingStatus !== "completed" || !recordingUrl) {
    // Recording failed or absent — mark as failed and bail
    if (logId) {
      await sb
        .from("call_logs")
        .update({ transcript_status: "failed" })
        .eq("id", logId);
    }
    if (investorLogId) {
      await sb
        .from("investor_calls")
        .update({ transcript_status: "failed" })
        .eq("id", investorLogId);
    }
    return new Response(null, { status: 204 });
  }

  // Update the call log: store recording URL + SID, mark transcription as processing
  const updates: Record<string, unknown> = {
    recording_url:      recordingUrl,
    recording_sid:      recordingSid,
    transcript_status:  "processing",
  };
  if (recordingDuration > 0) {
    updates.duration_sec = recordingDuration;
  }
  if (logId) await sb.from("call_logs").update(updates).eq("id", logId);
  if (investorLogId) {
    await sb
      .from("investor_calls")
      .update({
        recording_url: recordingUrl,
        recording_sid: recordingSid,
        transcript_status: "processing",
        duration_sec: recordingDuration > 0 ? recordingDuration : undefined,
        recorded_at: new Date().toISOString(),
      })
      .eq("id", investorLogId);
  }

  // ── Fire-and-forget transcription ──────────────────────────────────────
  // We respond 204 immediately so Twilio doesn't time out waiting for us.
  // The transcription runs async and writes back to the DB when done.
  (async () => {
    try {
      const transcript = await transcribeTwilioRecording(recordingUrl, recordingSid);
      if (logId) {
        await sb
          .from("call_logs")
          .update({
            transcript:        transcript || null,
            transcript_status: "completed",
          })
          .eq("id", logId);
      }
      if (investorLogId) {
        await sb
          .from("investor_calls")
          .update({
            transcript:        transcript || null,
            transcript_status: "completed",
          })
          .eq("id", investorLogId);
      }
    } catch (err) {
      console.error("[twilio:recording] transcription failed", logId || investorLogId, err);
      if (logId) {
        await sb
          .from("call_logs")
          .update({ transcript_status: "failed" })
          .eq("id", logId);
      }
      if (investorLogId) {
        await sb
          .from("investor_calls")
          .update({ transcript_status: "failed" })
          .eq("id", investorLogId);
      }
    }
  })();

  return new Response(null, { status: 204 });
}
