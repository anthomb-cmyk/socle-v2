// GET /api/follow-ups   — list follow-ups (RLS: caller sees own; admin sees all)
//   ?status=pending|done|cancelled
//   ?bucket=overdue|today|upcoming|done
//   ?leadId=
//   ?limit=&offset=
//
// POST /api/follow-ups   — create
//   { leadId?: uuid, contactId?: uuid, dueAt: ISO, note: string,
//     priority?: 0..100, source?: string, assignedToUserId?: uuid }

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { notifyDueFollowUps } from "@/lib/notifications/phone";

const Create = z.object({
  leadId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  dueAt: z.string(),                                // ISO 8601
  note: z.string().min(1),
  priority: z.number().int().min(0).max(100).optional(),
  source: z.string().optional(),
  assignedToUserId: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, role } = auth;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const bucket = url.searchParams.get("bucket");
  const leadId = url.searchParams.get("leadId");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200", 10), 500);

  const sb = createSupabaseAdminClient();
  let q = sb.from("follow_ups")
    .select("id, lead_id, contact_id, due_at, note, priority, status, assigned_to, created_by, source, gcal_event_id, gtask_id, created_at, updated_at")
    .order("due_at", { ascending: true })
    .limit(limit);

  if (role !== "admin") q = q.eq("assigned_to", user.id);
  if (status) q = q.eq("status", status);
  if (leadId) q = q.eq("lead_id", leadId);

  // Time-bucket filtering (server-side)
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);

  if (bucket === "overdue") q = q.eq("status", "pending").lt("due_at", todayStart.toISOString());
  else if (bucket === "today") q = q.eq("status", "pending").gte("due_at", todayStart.toISOString()).lt("due_at", todayEnd.toISOString());
  else if (bucket === "upcoming") q = q.eq("status", "pending").gte("due_at", todayEnd.toISOString());
  else if (bucket === "done") q = q.eq("status", "done");

  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Hydrate with lead info for the UI
  const rows = (data ?? []) as Array<{ id: string; lead_id: string | null }>;
  const leadIds = [...new Set(rows.map(r => r.lead_id).filter(Boolean) as string[])];
  let leadInfo: Record<string, { full_name: string | null; company_name: string | null; address: string; city: string | null; best_phone: string | null }> = {};
  if (leadIds.length > 0) {
    const { data: leads } = await sb.from("leads_view")
      .select("lead_id, full_name, company_name, address, city, best_phone")
      .in("lead_id", leadIds);
    leadInfo = Object.fromEntries(((leads ?? []) as Array<{ lead_id: string; full_name: string | null; company_name: string | null; address: string; city: string | null; best_phone: string | null }>)
      .map(l => [l.lead_id, l]));
  }

  return NextResponse.json({
    ok: true,
    data: rows.map(r => ({ ...r, lead: r.lead_id ? leadInfo[r.lead_id] ?? null : null })),
  });
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, role } = auth;

  let body;
  try { body = Create.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  // Caller can only create on their own leads (when leadId given)
  const sb = createSupabaseAdminClient();
  if (body.leadId && role !== "admin") {
    const { data: lead } = await sb.from("leads").select("assigned_to").eq("id", body.leadId).single();
    if (!lead || (lead as { assigned_to: string | null }).assigned_to !== user.id) {
      return NextResponse.json({ ok: false, error: "Not your lead" }, { status: 403 });
    }
  }

  const assignedTo = body.assignedToUserId ?? user.id;

  const { data, error } = await sb.from("follow_ups").insert({
    lead_id: body.leadId ?? null,
    contact_id: body.contactId ?? null,
    due_at: body.dueAt,
    note: body.note,
    priority: body.priority ?? 50,
    status: "pending",
    assigned_to: assignedTo,
    created_by: user.id,
    source: body.source ?? "web_app",
  }).select("id").single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const followUpId = (data as { id: string }).id;
  let dueNotification = null;
  if (new Date(body.dueAt).getTime() <= Date.now()) {
    dueNotification = await notifyDueFollowUps({
      count: 1,
      firstLabel: body.note,
      firstDueAt: body.dueAt,
    });
  }

  await sb.from("automation_events").insert({
    source: "web_app",
    event_type: "follow_up_created",
    status: "success",
    related_lead_id: body.leadId ?? null,
    triggered_by: user.id,
    payload: { followUpId, source: body.source ?? "web_app", dueAt: body.dueAt },
    result: { dueNotification },
  });

  if (dueNotification) {
    await sb.from("automation_events").insert({
      source: "system",
      event_type: "follow_up_due_push_sent",
      status: dueNotification.ok ? "success" : "failed",
      related_lead_id: body.leadId ?? null,
      triggered_by: user.id,
      payload: { followUpId, dueAt: body.dueAt, immediate: true },
      result: dueNotification,
    });
  }

  return NextResponse.json({ ok: true, data: { id: followUpId } });
}
