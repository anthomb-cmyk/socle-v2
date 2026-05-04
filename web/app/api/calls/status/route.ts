// GET /api/calls/status?callLogId=
//
// Returns the current state of a call_log row so the client can poll
// for status updates while a Twilio call is in progress.
//
// Response: { ok: true, data: { statusEvents, durationSec, transcriptStatus } }

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const callLogId = new URL(request.url).searchParams.get("callLogId");
  if (!callLogId) {
    return NextResponse.json({ ok: false, error: "callLogId required" }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();

  const { data: log } = await sb
    .from("call_logs")
    .select("id, user_id, duration_sec, transcript_status, transcript, raw")
    .eq("id", callLogId)
    .single();

  if (!log) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  // Only admin or the caller who initiated this call can poll its status
  if (auth.role !== "admin" && log.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const raw = (log.raw as Record<string, unknown> | null) ?? {};
  const statusEvents = (raw.status_events as unknown[]) ?? [];

  return NextResponse.json({
    ok: true,
    data: {
      statusEvents,
      durationSec:      log.duration_sec,
      transcriptStatus: log.transcript_status,
      transcript:       log.transcript ?? null,
    },
  });
}
