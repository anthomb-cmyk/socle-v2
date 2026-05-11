// GET /api/quick-call/history?callLogId=
//
// Returns a HistoryRow array (same shape as CallHistoryPanel expects) for a
// single quick-call call_log row. The client polls this after the call
// completes to surface the recording + transcript panel.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const callLogId = new URL(request.url).searchParams.get("callLogId");
  if (!callLogId) {
    return NextResponse.json({ ok: false, error: "callLogId requis" }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();

  const { data: log } = await sb
    .from("call_logs")
    .select(
      "id, user_id, outcome, notes, recorded_at, duration_sec, recording_url, transcript_status, transcript",
    )
    .eq("id", callLogId)
    .single();

  if (!log) {
    return NextResponse.json({ ok: false, error: "Non trouvé" }, { status: 404 });
  }

  // Only admin or the initiating caller may see this log
  if (auth.role !== "admin" && log.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Accès refusé" }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    data: [
      {
        id:                log.id,
        outcome:           log.outcome ?? null,
        notes:             log.notes ?? null,
        recorded_at:       log.recorded_at ?? null,
        duration_sec:      log.duration_sec ?? null,
        recording_url:     log.recording_url ?? null,
        transcript_status: log.transcript_status ?? null,
        transcript:        log.transcript ?? null,
      },
    ],
  });
}
