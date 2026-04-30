// PATCH /api/follow-ups/[id] — update fields (note, dueAt, priority, status, assignedTo)
// DELETE /api/follow-ups/[id] — soft cancel (status='cancelled')

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const Patch = z.object({
  note: z.string().min(1).optional(),
  dueAt: z.string().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  status: z.enum(["pending", "done", "cancelled"]).optional(),
  assignedToUserId: z.string().uuid().optional(),
});

import type { Role } from "@/lib/auth";

async function loadAndAuthorize(id: string, userId: string, role: Role) {
  const sb = createSupabaseAdminClient();
  const { data, error } = await sb.from("follow_ups").select("*").eq("id", id).single();
  if (error || !data) return { sb, error: NextResponse.json({ ok: false, error: "Not found" }, { status: 404 }) };
  const fu = data as { id: string; assigned_to: string | null; created_by: string | null; lead_id: string | null };
  if (role !== "admin" && fu.assigned_to !== userId && fu.created_by !== userId) {
    return { sb, error: NextResponse.json({ ok: false, error: "Not allowed" }, { status: 403 }) };
  }
  return { sb, fu };
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, role } = auth;
  const { id } = await ctx.params;

  let body;
  try { body = Patch.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const { sb, error: authErr, fu } = await loadAndAuthorize(id, user.id, role);
  if (authErr) return authErr;

  const update: Record<string, unknown> = {};
  if (body.note !== undefined) update.note = body.note;
  if (body.dueAt !== undefined) update.due_at = body.dueAt;
  if (body.priority !== undefined) update.priority = body.priority;
  if (body.status !== undefined) update.status = body.status;
  if (body.assignedToUserId !== undefined) update.assigned_to = body.assignedToUserId;

  const { error } = await sb.from("follow_ups").update(update).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await sb.from("automation_events").insert({
    source: "web_app", event_type: "follow_up_updated", status: "success",
    related_lead_id: fu?.lead_id ?? null, triggered_by: user.id,
    payload: { followUpId: id, changes: body },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, role } = auth;
  const { id } = await ctx.params;

  const { sb, error: authErr, fu } = await loadAndAuthorize(id, user.id, role);
  if (authErr) return authErr;

  const { error } = await sb.from("follow_ups").update({ status: "cancelled" }).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await sb.from("automation_events").insert({
    source: "web_app", event_type: "follow_up_cancelled", status: "success",
    related_lead_id: fu?.lead_id ?? null, triggered_by: user.id,
    payload: { followUpId: id },
  });

  return NextResponse.json({ ok: true });
}
