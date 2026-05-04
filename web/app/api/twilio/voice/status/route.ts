// POST /api/twilio/voice/status
//
// Twilio status callback — fires for every leg status change:
//   initiated → ringing → answered → completed
//
// Twilio sends this as application/x-www-form-urlencoded.
// We update the call_log row with the latest duration and append the raw
// status event to the `raw` JSON column for debugging.
//
// Query param: callLogId — our internal call_log row id
// No auth — called directly by Twilio.

import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { normalizePhone } from "@/lib/twilio";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const callLogId = url.searchParams.get("callLogId") ?? "";

  // Parse form-encoded body
  const form = await request.formData().catch(() => new FormData());
  const callSid        = String(form.get("CallSid") ?? "").trim();
  const parentCallSid  = String(form.get("ParentCallSid") ?? "").trim();
  const callStatus     = String(form.get("CallStatus") ?? "").trim();
  const callDuration   = Number(form.get("CallDuration") ?? 0);
  const fromRaw        = normalizePhone(String(form.get("From") ?? ""));
  const toRaw          = normalizePhone(String(form.get("To") ?? ""));

  const sb = createSupabaseAdminClient();

  // Resolve the call_log row — prefer our explicit callLogId, fall back to SID lookup
  let logId = callLogId;
  if (!logId && callSid) {
    const { data } = await sb
      .from("call_logs")
      .select("id")
      .or(`twilio_call_sid.eq.${callSid},parent_call_sid.eq.${callSid}`)
      .maybeSingle();
    if (data) logId = data.id as string;
  }

  if (!logId) {
    // Unknown call — still return 204 so Twilio doesn't retry
    return new Response(null, { status: 204 });
  }

  // Fetch the current row so we can merge safely
  const { data: log } = await sb
    .from("call_logs")
    .select("id, twilio_call_sid, parent_call_sid, duration_sec, raw")
    .eq("id", logId)
    .single();

  if (!log) return new Response(null, { status: 204 });

  const updates: Record<string, unknown> = {};

  // Store the parent SID once on first ringing/answered event
  if (parentCallSid && callSid && parentCallSid !== callSid) {
    // callSid here is the *child* (bridged) leg — the parent is already stored
    updates.parent_call_sid = parentCallSid;
  }
  if (!log.twilio_call_sid && callSid) {
    updates.twilio_call_sid = callSid;
  }

  // Update duration on completed events (Twilio only populates CallDuration at completion)
  if (callStatus === "completed" && callDuration > 0) {
    updates.duration_sec = callDuration;
  }

  // Append raw status event to the JSON column for debugging
  const existingRaw = (log.raw as Record<string, unknown> | null) ?? {};
  const events = (existingRaw.status_events as unknown[]) ?? [];
  events.push({
    at: new Date().toISOString(),
    status: callStatus,
    callSid,
    parentCallSid: parentCallSid || null,
    duration: callDuration || null,
    from: fromRaw || null,
    to: toRaw || null,
  });
  updates.raw = { ...existingRaw, status_events: events };

  if (Object.keys(updates).length > 0) {
    await sb.from("call_logs").update(updates).eq("id", logId);
  }

  return new Response(null, { status: 204 });
}
