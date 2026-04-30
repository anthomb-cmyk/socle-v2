// GET /api/leads/[id] — full lead dossier (admin only).
// PATCH /api/leads/[id] — update notes, status, priority, assigned_to.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const Patch = z.object({
  notes: z.string().optional(),
  status: z.enum(["new", "enriching", "ready_to_call", "in_outreach", "meeting_set", "qualified", "no_answer", "rejected", "do_not_contact"]).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, role } = auth;
  const { id } = await ctx.params;

  const sb = createSupabaseAdminClient();
  const { data: lead } = await sb.from("leads_view").select("*").eq("lead_id", id).single();
  if (!lead) return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });

  // Caller can read only assigned-to-them
  const leadRow = lead as { assigned_to: string | null; contact_id: string; property_id: string };
  if (role !== "admin" && leadRow.assigned_to !== user.id) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const [phones, calls, fups, subs, evts, propRow, contactRow] = await Promise.all([
    sb.from("phones")
      .select("id, e164, display, status, source, confidence, evidence, source_column, notes, created_at")
      .eq("contact_id", leadRow.contact_id)
      .order("confidence", { ascending: false }),
    sb.from("call_logs")
      .select("id, outcome, notes, recorded_at, duration_sec, user_id")
      .eq("lead_id", id)
      .order("recorded_at", { ascending: false }),
    sb.from("follow_ups")
      .select("id, due_at, note, priority, status, source, assigned_to, created_at")
      .eq("lead_id", id)
      .order("due_at", { ascending: true }),
    sb.from("lead_submissions")
      .select("id, outcome, seller_interest_level, timeline, motivation, asking_price, caller_summary, status, submitted_by, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
    sb.from("automation_events")
      .select("id, source, event_type, status, error_message, payload, occurred_at")
      .eq("related_lead_id", id)
      .order("occurred_at", { ascending: false })
      .limit(20),
    sb.from("properties").select("*").eq("id", leadRow.property_id).single(),
    sb.from("contacts").select("*").eq("id", leadRow.contact_id).single(),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      lead,
      property: propRow.data,
      contact: contactRow.data,
      phones: phones.data ?? [],
      calls: calls.data ?? [],
      followUps: fups.data ?? [],
      submissions: subs.data ?? [],
      events: evts.data ?? [],
    },
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const { id } = await ctx.params;

  let body;
  try { body = Patch.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const update: Record<string, unknown> = {};
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.status !== undefined) update.status = body.status;
  if (body.priority !== undefined) update.priority = body.priority;
  if (body.assignedToUserId !== undefined) update.assigned_to = body.assignedToUserId;
  if (Object.keys(update).length === 0) return NextResponse.json({ ok: false, error: "No fields to update" }, { status: 400 });

  const sb = createSupabaseAdminClient();
  const { error } = await sb.from("leads").update(update).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // History row when reassigning
  if (body.assignedToUserId !== undefined) {
    if (body.assignedToUserId) {
      await sb.from("lead_assignments").insert({ lead_id: id, assigned_to: body.assignedToUserId, assigned_by: user.id });
    } else {
      await sb.from("lead_assignments").update({ unassigned_at: new Date().toISOString() })
        .eq("lead_id", id).is("unassigned_at", null);
    }
  }

  await sb.from("automation_events").insert({
    source: "web_app", event_type: "lead_updated", status: "success",
    related_lead_id: id, triggered_by: user.id, payload: { changes: body },
  });

  return NextResponse.json({ ok: true });
}
