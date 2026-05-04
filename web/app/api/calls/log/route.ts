// POST /api/calls/log — log a call outcome.
// Body: { leadId, phoneId?, outcome, notes?, durationSec?, twilioCallSid?, nextCallAt? }
//
// Side-effects by outcome:
//   no_answer / voicemail_left  → next_action_at +2h / +4h (auto-retry window)
//   call_back_later             → next_action_at = nextCallAt; creates follow_up row
//   maybe_later                 → next_action_at +14d
//   bad_number                  → phone.status = bad_number
//   wrong_number                → phone.status = wrong_person; if no other valid phones → needs_phone_review
//   do_not_contact              → lead.status = do_not_contact; phone.status = do_not_contact
//   not_interested / already_sold → lead.status = rejected
//   hot outcomes                → lead.status = in_outreach
//
// Always:  updates last_contacted_at; releases call_lock for this lead/user.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const CALL_OUTCOMES = [
  "no_answer", "voicemail_left", "wrong_number", "bad_number",
  "not_interested", "maybe_later", "already_sold",
  "wants_more_info", "open_to_selling", "wants_offer",
  "hot_seller", "follow_up_booked", "do_not_contact",
  "call_back_later",
] as const;

const Body = z.object({
  leadId:        z.string().uuid(),
  phoneId:       z.string().uuid().nullable().optional(),
  outcome:       z.enum(CALL_OUTCOMES),
  notes:         z.string().nullable().optional(),
  durationSec:   z.number().int().nonnegative().optional(),
  twilioCallSid: z.string().optional(),
  // For call_back_later: ISO timestamp when the caller should call back
  nextCallAt:    z.string().datetime().optional(),
});

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Bad input", errors: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const sb = createSupabaseAdminClient();

  // Auth: admin or the assigned caller
  const { data: lead } = await sb
    .from("leads")
    .select("id, assigned_to, contact_id, status")
    .eq("id", body.leadId)
    .single();
  if (!lead) return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });
  if (auth.role !== "admin" && lead.assigned_to !== user.id) {
    return NextResponse.json({ ok: false, error: "Not your lead" }, { status: 403 });
  }

  // ── 1. Insert call_log ──────────────────────────────────────────────────
  const { data: log, error: logErr } = await sb.from("call_logs").insert({
    lead_id:         body.leadId,
    contact_id:      lead.contact_id,
    phone_id:        body.phoneId ?? null,
    user_id:         user.id,
    twilio_call_sid: body.twilioCallSid ?? null,
    direction:       "outbound",
    duration_sec:    body.durationSec ?? null,
    outcome:         body.outcome,
    notes:           body.notes ?? null,
    recorded_at:     new Date().toISOString(),
  }).select("id").single();
  if (logErr) return NextResponse.json({ ok: false, error: logErr.message }, { status: 500 });

  // ── 2. Lead status + next_action_at ────────────────────────────────────
  const now = new Date();
  const updates: Record<string, unknown> = { last_contacted_at: now.toISOString() };

  switch (body.outcome) {
    case "do_not_contact":
      updates.status = "do_not_contact";
      updates.next_action_at = null;
      break;
    case "not_interested":
    case "already_sold":
      updates.status = "rejected";
      updates.next_action_at = null;
      break;
    case "no_answer":
      updates.status = "no_answer";
      // Auto-retry in 2 hours
      updates.next_action_at = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
      break;
    case "voicemail_left":
      updates.status = "no_answer";
      // Give a bit more breathing room after a voicemail
      updates.next_action_at = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
      break;
    case "call_back_later":
      updates.status = "in_outreach";
      // Default to tomorrow if no specific time given
      updates.next_action_at =
        body.nextCallAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      break;
    case "maybe_later":
      // Keep existing status; schedule a gentle follow-up in 2 weeks
      updates.next_action_at = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
      break;
    case "hot_seller":
    case "wants_offer":
    case "open_to_selling":
    case "wants_more_info":
    case "follow_up_booked":
      updates.status = "in_outreach";
      updates.next_action_at = null;
      break;
    // wrong_number / bad_number: lead status handled via phone logic below
  }

  await sb.from("leads").update(updates).eq("id", body.leadId);

  // ── 3. Phone status propagation ─────────────────────────────────────────
  if (body.phoneId) {
    if (body.outcome === "bad_number") {
      await sb.from("phones").update({ status: "bad_number" }).eq("id", body.phoneId);

    } else if (body.outcome === "wrong_number") {
      await sb.from("phones").update({ status: "wrong_person" }).eq("id", body.phoneId);

      // If no other usable phones exist for this contact, flag the lead for review
      const { data: otherPhones } = await sb
        .from("phones")
        .select("id")
        .eq("contact_id", lead.contact_id)
        .in("status", ["unverified", "valid"])
        .neq("id", body.phoneId)
        .limit(1);

      if (!otherPhones || otherPhones.length === 0) {
        await sb.from("leads")
          .update({ status: "needs_phone_review" })
          .eq("id", body.leadId);
      }

    } else if (body.outcome === "do_not_contact") {
      await sb.from("phones").update({ status: "do_not_contact" }).eq("id", body.phoneId);
    }
  }

  // ── 4. Create follow_up for call_back_later ─────────────────────────────
  if (body.outcome === "call_back_later") {
    const dueAt =
      body.nextCallAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    await sb.from("follow_ups").insert({
      lead_id:     body.leadId,
      assigned_to: user.id,
      due_at:      dueAt,
      status:      "open",
      notes:       body.notes ?? null,
    });
  }

  // ── 5. Release call lock (best-effort) ──────────────────────────────────
  await sb.from("call_locks")
    .delete()
    .eq("lead_id", body.leadId)
    .eq("locked_by", user.id);

  // ── 6. Audit event ──────────────────────────────────────────────────────
  await sb.from("automation_events").insert({
    source:              "web_app",
    event_type:          "call_logged",
    status:              "success",
    related_lead_id:     body.leadId,
    related_contact_id:  lead.contact_id,
    triggered_by:        user.id,
    payload:             { outcome: body.outcome, callLogId: log!.id, nextCallAt: body.nextCallAt ?? null },
  });

  return NextResponse.json({ ok: true, data: { callLogId: log!.id, outcome: body.outcome } });
}
