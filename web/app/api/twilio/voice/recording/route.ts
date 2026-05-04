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

  if (!logId) return new Response(null, { status: 204 });

  if (recordingStatus !== "completed" || !recordingUrl) {
    // Recording failed or absent — mark as failed and bail
    await sb
      .from("call_logs")
      .update({ transcript_status: "failed" })
      .eq("id", logId);
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
  await sb.from("call_logs").update(updates).eq("id", logId);

  // ── Fire-and-forget transcription ──────────────────────────────────────
  // We respond 204 immediately so Twilio doesn't time out waiting for us.
  // The transcription runs async and writes back to the DB when done.
  (async () => {
    try {
      const transcript = await transcribeTwilioRecording(recordingUrl, recordingSid);
      await sb
        .from("call_logs")
        .update({
          transcript:        transcript || null,
          transcript_status: "completed",
        })
        .eq("id", logId);
    } catch (err) {
      console.error("[twilio:recording] transcription failed", logId, err);
      await sb
        .from("call_logs")
        .update({ transcript_status: "failed" })
        .eq("id", logId);
    }
  })();

  return new Response(null, { status: 204 });
}
