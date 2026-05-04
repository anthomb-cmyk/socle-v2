// POST /api/calls/[callLogId]/transcribe
//
// Manual transcription trigger — allows admin or the caller who logged
// the call to request (or re-request) a transcript for any recorded call.
//
// Requirements:
//   - Call must have a recording_url
//   - transcript_status must NOT already be "processing" (to prevent duplicate jobs)
//
// On success, immediately sets transcript_status = "processing" and kicks off
// Whisper async. Returns 202 Accepted while transcription runs in the background.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { transcribeTwilioRecording } from "@/lib/transcribe";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ callLogId: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { callLogId } = await params;

  const sb = createSupabaseAdminClient();

  const { data: log } = await sb
    .from("call_logs")
    .select("id, user_id, recording_url, recording_sid, transcript_status")
    .eq("id", callLogId)
    .single();

  if (!log) return NextResponse.json({ ok: false, error: "Call log not found" }, { status: 404 });

  // Only admin or the caller who made the call can request a transcript
  if (auth.role !== "admin" && log.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  if (!log.recording_url) {
    return NextResponse.json({ ok: false, error: "No recording available for this call" }, { status: 400 });
  }

  if (log.transcript_status === "processing") {
    return NextResponse.json(
      { ok: false, error: "Transcription already in progress" },
      { status: 409 },
    );
  }

  // Mark as processing immediately
  await sb
    .from("call_logs")
    .update({ transcript_status: "processing" })
    .eq("id", callLogId);

  // Fire-and-forget — client polls or refreshes to see the result
  const recordingUrl = log.recording_url as string;
  const recordingSid = (log.recording_sid as string | null) ?? callLogId;

  (async () => {
    try {
      const transcript = await transcribeTwilioRecording(recordingUrl, recordingSid);
      await sb
        .from("call_logs")
        .update({
          transcript:        transcript || null,
          transcript_status: "completed",
        })
        .eq("id", callLogId);
    } catch (err) {
      console.error("[transcribe:manual] failed", callLogId, err);
      await sb
        .from("call_logs")
        .update({ transcript_status: "failed" })
        .eq("id", callLogId);
    }
  })();

  return NextResponse.json({ ok: true, data: { status: "processing" } }, { status: 202 });
}
