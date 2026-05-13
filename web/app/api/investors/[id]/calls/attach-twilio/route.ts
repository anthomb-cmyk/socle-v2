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
  uri: string;
  date_created?: string;
  duration?: string | number | null;
  channels?: number;
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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id: investorId } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const callSid = String(body.call_sid ?? "").trim();
  if (!/^CA[0-9a-f]{32}$/i.test(callSid)) {
    return NextResponse.json(
      { ok: false, error: "call_sid invalide (doit ressembler à CA…)" },
      { status: 400 },
    );
  }

  const sb = createSupabaseAdminClient();

  // ── 1. Check this SID isn't already attached somewhere ────────────────────
  const { data: existing } = await sb
    .from("investor_calls")
    .select("id, investor_id")
    .eq("twilio_call_sid", callSid)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      {
        ok: false,
        error: "Cet appel est déjà rattaché à un investisseur.",
        data: { existing_call_id: existing.id, existing_investor_id: existing.investor_id },
      },
      { status: 409 },
    );
  }

  // ── 2. Fetch call metadata from Twilio ────────────────────────────────────
  let call: TwilioCall;
  try {
    call = await twilioGet<TwilioCall>(`/Calls/${callSid}.json`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: `Twilio API: ${msg}` }, { status: 502 });
  }

  // ── 3. Fetch recordings for that call ─────────────────────────────────────
  type RecListResp = { recordings: TwilioRecording[] };
  let recordings: TwilioRecording[] = [];
  try {
    const list = await twilioGet<RecListResp>(`/Calls/${callSid}/Recordings.json`);
    recordings = list.recordings ?? [];
  } catch (err) {
    // Non-fatal — we'll still log the call without a recording
    console.warn("[attach-twilio] couldn't list recordings", err);
  }

  const recording = recordings[0];
  const recordingSid = recording?.sid ?? null;
  // Bare URL (no extension) — transcribeTwilioRecording appends .mp3 as needed.
  const recordingUrl = recordingSid
    ? `https://api.twilio.com/2010-04-01/Accounts/${getTwilioConfig().accountSid}/Recordings/${recordingSid}`
    : null;

  // ── 4. Insert investor_calls row ──────────────────────────────────────────
  const duration = Number(call.duration ?? recording?.duration ?? 0) || null;
  const startedAt = call.start_time ?? null;
  const recordedAt = recording?.date_created ?? null;

  // Normalize direction: Twilio uses "inbound" / "outbound-api" / "outbound-dial"
  let direction: "inbound" | "outbound" | "manual" = "manual";
  if (typeof call.direction === "string") {
    direction = call.direction.startsWith("outbound") ? "outbound" : "inbound";
  }

  const { data: inserted, error: insErr } = await sb
    .from("investor_calls")
    .insert({
      investor_id: investorId,
      twilio_call_sid: callSid,
      parent_call_sid: call.parent_call_sid ?? null,
      direction,
      duration_sec: duration,
      recording_url: recordingUrl,
      recording_sid: recordingSid,
      transcript_status: recordingUrl ? "processing" : "skipped",
      started_at: startedAt,
      recorded_at: recordedAt,
      logged_by: auth.user.id,
      raw: { call, recording: recording ?? null } as Record<string, unknown>,
    })
    .select("id")
    .single();

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
        transcript_status: recordingUrl ? "processing" : "skipped",
        direction,
        duration_sec: duration,
      },
    },
    { status: 202 },
  );
}
