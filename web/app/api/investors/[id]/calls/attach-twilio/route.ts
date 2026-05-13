// POST /api/investors/[id]/calls/attach-twilio
//   body: { call_sid: "CA..." }
//
// Pulls the call details + recording URL from Twilio's REST API, creates an
// investor_calls row, and kicks off Whisper transcription in the background.
//
// Admin-only. Reuses TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + OPENAI_API_KEY
// from Railway env via lib/twilio.ts + lib/transcribe.ts.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { getTwilioConfig, twilioBasicAuth } from "@/lib/twilio";
import { transcribeTwilioRecording } from "@/lib/transcribe";

export const runtime = "nodejs";
export const maxDuration = 60;

type TwilioCall = {
  sid: string;
  parent_call_sid?: string | null;
  direction?: string;
  duration?: string | number | null;
  start_time?: string | null;
  end_time?: string | null;
  status?: string;
  from?: string;
  to?: string;
};

type TwilioRecording = {
  sid: string;
  call_sid?: string | null;
  uri: string;
  date_created?: string;
  duration?: string | number | null;
  channels?: number;
};

type RecordingCandidate = {
  callSid: string;
  recording: TwilioRecording;
};

async function twilioGet<T>(path: string): Promise<T> {
  const { accountSid, authToken } = getTwilioConfig();
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}${path}`, {
    headers: { Authorization: twilioBasicAuth(accountSid, authToken) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio ${res.status}: ${text.slice(0, 240)}`);
  }
  return (await res.json()) as T;
}

async function listRecordings(callSid: string): Promise<TwilioRecording[]> {
  type RecListResp = { recordings: TwilioRecording[] };
  const list = await twilioGet<RecListResp>(`/Calls/${callSid}/Recordings.json`);
  return list.recordings ?? [];
}

async function listAccountRecordingsForCall(callSid: string): Promise<TwilioRecording[]> {
  type RecListResp = { recordings: TwilioRecording[] };
  const params = new URLSearchParams({ CallSid: callSid });
  const list = await twilioGet<RecListResp>(`/Recordings.json?${params.toString()}`);
  return list.recordings ?? [];
}

async function getRecording(recordingSid: string): Promise<TwilioRecording> {
  return twilioGet<TwilioRecording>(`/Recordings/${recordingSid}.json`);
}

async function listChildCalls(callSid: string): Promise<TwilioCall[]> {
  type CallListResp = { calls: TwilioCall[] };
  const params = new URLSearchParams({ ParentCallSid: callSid });
  const list = await twilioGet<CallListResp>(`/Calls.json?${params.toString()}`);
  return list.calls ?? [];
}

async function findRecordingForCall(call: TwilioCall): Promise<{
  recording: RecordingCandidate | null;
  relatedCalls: TwilioCall[];
}> {
  const relatedCalls: TwilioCall[] = [];
  const callSids = new Set<string>([call.sid]);

  if (call.parent_call_sid) callSids.add(call.parent_call_sid);

  try {
    const children = await listChildCalls(call.sid);
    relatedCalls.push(...children);
    for (const child of children) callSids.add(child.sid);
  } catch (err) {
    console.warn("[attach-twilio] couldn't list child calls", err);
  }

  if (call.parent_call_sid) {
    try {
      const siblings = await listChildCalls(call.parent_call_sid);
      relatedCalls.push(...siblings);
      for (const sibling of siblings) callSids.add(sibling.sid);
    } catch (err) {
      console.warn("[attach-twilio] couldn't list sibling calls", err);
    }
  }

  for (const candidateCallSid of callSids) {
    try {
      const recordings = [
        ...await listRecordings(candidateCallSid),
        ...await listAccountRecordingsForCall(candidateCallSid),
      ];
      if (recordings[0]) {
        return {
          recording: { callSid: candidateCallSid, recording: recordings[0] },
          relatedCalls,
        };
      }
    } catch (err) {
      console.warn("[attach-twilio] couldn't list recordings", candidateCallSid, err);
    }
  }

  return { recording: null, relatedCalls };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id: investorId } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const rawCallSid = String(body.call_sid ?? "").trim();
  const rawRecordingSid = String(body.recording_sid ?? "").trim();
  const callSidFromBody = /^CA[0-9a-f]{32}$/i.test(rawCallSid) ? rawCallSid : null;
  const recordingSidFromBody = /^RE[0-9a-f]{32}$/i.test(rawRecordingSid || rawCallSid) ? (rawRecordingSid || rawCallSid) : null;

  if (!callSidFromBody && !recordingSidFromBody) {
    return NextResponse.json(
      { ok: false, error: "SID invalide (doit ressembler à CA… ou RE…)" },
      { status: 400 },
    );
  }

  const sb = createSupabaseAdminClient();

  let callSid = callSidFromBody;
  let manualRecording: TwilioRecording | null = null;
  if (recordingSidFromBody) {
    try {
      manualRecording = await getRecording(recordingSidFromBody);
      callSid = callSid ?? manualRecording.call_sid ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: `Twilio Recording API: ${msg}` }, { status: 502 });
    }
  }

  // ── 1. Check this SID isn't already attached somewhere ────────────────────
  const existingByCall = callSid
    ? await sb
        .from("investor_calls")
        .select("id, investor_id, transcript_status")
        .eq("twilio_call_sid", callSid)
        .maybeSingle()
    : { data: null };
  const existingByRecording = recordingSidFromBody
    ? await sb
        .from("investor_calls")
        .select("id, investor_id, transcript_status")
        .eq("recording_sid", recordingSidFromBody)
        .maybeSingle()
    : { data: null };
  const existing = existingByCall.data ?? existingByRecording.data ?? null;

  if (existing && existing.investor_id !== investorId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Cet appel est déjà rattaché à un investisseur.",
        data: { existing_call_id: existing.id, existing_investor_id: existing.investor_id },
      },
      { status: 409 },
    );
  }
  if (existing && ["processing", "completed"].includes(String(existing.transcript_status ?? ""))) {
    return NextResponse.json({
      ok: true,
      data: {
        id: existing.id,
        twilio_call_sid: callSid,
        transcript_status: existing.transcript_status,
      },
    });
  }

  // ── 2. Fetch call metadata from Twilio ────────────────────────────────────
  let call: TwilioCall | null = null;
  if (callSid) {
    try {
      call = await twilioGet<TwilioCall>(`/Calls/${callSid}.json`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: `Twilio API: ${msg}` }, { status: 502 });
    }
  }

  // ── 3. Fetch recordings for this call or related Twilio legs ──────────────
  const recordingMatch = call && !manualRecording
    ? await findRecordingForCall(call)
    : { recording: null, relatedCalls: [] as TwilioCall[] };
  const recording = manualRecording ?? recordingMatch.recording?.recording ?? null;
  const recordingSourceCallSid = manualRecording?.call_sid ?? recordingMatch.recording?.callSid ?? null;
  const recordingSid = recording?.sid ?? null;
  // Bare URL (no extension) — transcribeTwilioRecording appends .mp3 as needed.
  const recordingUrl = recordingSid
    ? `https://api.twilio.com/2010-04-01/Accounts/${getTwilioConfig().accountSid}/Recordings/${recordingSid}`
    : null;

  // ── 4. Insert or refresh investor_calls row ───────────────────────────────
  const duration = Number(call?.duration ?? recording?.duration ?? 0) || null;
  const startedAt = call?.start_time ?? null;
  const recordedAt = recording?.date_created ?? null;

  // Normalize direction: Twilio uses "inbound" / "outbound-api" / "outbound-dial"
  let direction: "inbound" | "outbound" | "manual" = "manual";
  if (typeof call?.direction === "string") {
    direction = call.direction.startsWith("outbound") ? "outbound" : "inbound";
  }

  const callPayload = {
      investor_id: investorId,
      twilio_call_sid: callSid,
      parent_call_sid: call?.parent_call_sid ?? null,
      direction,
      duration_sec: duration,
      recording_url: recordingUrl,
      recording_sid: recordingSid,
      transcript_status: recordingUrl ? "processing" : "skipped",
      transcript: null,
      started_at: startedAt,
      recorded_at: recordedAt,
      logged_by: auth.user.id,
      raw: {
        call,
        recording,
        recording_source_call_sid: recordingSourceCallSid,
        related_calls: recordingMatch.relatedCalls,
      } as Record<string, unknown>,
    };

  const write = existing
    ? sb
        .from("investor_calls")
        .update(callPayload)
        .eq("id", existing.id)
        .select("id")
        .single()
    : sb
        .from("investor_calls")
        .insert(callPayload)
    .select("id")
    .single();

  const { data: inserted, error: insErr } = await write;

  if (insErr) {
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
  }
  const callRowId = inserted!.id;

  // ── 5. Fire-and-forget transcription (if we have a recording) ─────────────
  if (recordingUrl && recordingSid) {
    (async () => {
      try {
        const transcript = await transcribeTwilioRecording(recordingUrl, recordingSid);
        await sb
          .from("investor_calls")
          .update({
            transcript: transcript || null,
            transcript_status: "completed",
          })
          .eq("id", callRowId);
      } catch (err) {
        console.error("[attach-twilio] transcribe failed", callRowId, err);
        await sb
          .from("investor_calls")
          .update({ transcript_status: "failed" })
          .eq("id", callRowId);
      }
    })();
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        id: callRowId,
        twilio_call_sid: callSid,
        recording_sid: recordingSid,
        recording_source_call_sid: recordingSourceCallSid,
        transcript_status: recordingUrl ? "processing" : "skipped",
        direction,
        duration_sec: duration,
      },
    },
    { status: 202 },
  );
}
