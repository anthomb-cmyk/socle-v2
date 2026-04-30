// POST /api/calls/log — log a call outcome.
// Body: { leadId, phoneId?, outcome, notes?, durationSec?, twilioCallSid? }

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const Body = z.object({
  leadId: z.string().uuid(),
  phoneId: z.string().uuid().nullable().optional(),
  outcome: z.enum([
    "no_answer", "voicemail_left", "wrong_number", "bad_number",
    "not_interested", "maybe_later", "already_sold",
    "wants_more_info", "open_to_selling", "wants_offer",
    "hot_seller", "follow_up_booked", "do_not_contact",
  ]),
  notes: z.string().nullable().optional(),
  durationSec: z.number().int().nonnegative().optional(),
  twilioCallSid: z.string().optional(),
});

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();

  // Verify the user is allowed to log against this lead (admin OR assigned).
  const { data: lead } = await sb.from("leads").select("id, assigned_to, contact_id").eq("id", body.leadId).single();
  if (!lead) return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });
  if (auth.role !== "admin" && lead.assigned_to !== user.id) {
    return NextResponse.json({ ok: false, error: "Not your lead" }, { status: 403 });
  }

  // Insert call_log
  const { data: log, error: logErr } = await sb.from("call_logs").insert({
    lead_id: body.leadId,
    contact_id: lead.contact_id,
    phone_id: body.phoneId ?? null,
    user_id: user.id,
    twilio_call_sid: body.twilioCallSid ?? null,
    direction: "outbound",
    duration_sec: body.durationSec ?? null,
    outcome: body.outcome,
    notes: body.notes ?? null,
    recorded_at: new Date().toISOString(),
  }).select("id").single();
  if (logErr) return NextResponse.json({ ok: false, error: logErr.message }, { status: 500 });

  // Side effects based on outcome
  const updates: Record<string, unknown> = { last_contacted_at: new Date().toISOString() };
  if (body.outcome === "do_not_contact") updates.status = "do_not_contact";
  else if (body.outcome === "not_interested" || body.outcome === "already_sold") updates.status = "rejected";
  else if (body.outcome === "no_answer" || body.outcome === "voicemail_left") updates.status = "no_answer";
  else if (body.outcome === "hot_seller" || body.outcome === "wants_offer" || body.outcome === "open_to_selling") updates.status = "in_outreach";
  await sb.from("leads").update(updates).eq("id", body.leadId);

  // If phone was bad/DNC/wrong, propagate to phone status
  if (body.phoneId && (body.outcome === "bad_number" || body.outcome === "wrong_number" || body.outcome === "do_not_contact")) {
    const phoneStatus = body.outcome === "do_not_contact" ? "do_not_contact" :
                        body.outcome === "wrong_number" ? "wrong_person" : "bad_number";
    await sb.from("phones").update({ status: phoneStatus }).eq("id", body.phoneId);
  }

  // Audit
  await sb.from("automation_events").insert({
    source: "web_app",
    event_type: "call_logged",
    status: "success",
    related_lead_id: body.leadId,
    related_contact_id: lead.contact_id,
    triggered_by: user.id,
    payload: { outcome: body.outcome, callLogId: log!.id },
  });

  return NextResponse.json({ ok: true, data: { callLogId: log!.id, outcome: body.outcome } });
}
