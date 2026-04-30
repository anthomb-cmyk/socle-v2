// POST /api/follow-ups/[id]/complete — mark done.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, role } = auth;
  const { id } = await ctx.params;

  const sb = createSupabaseAdminClient();
  const { data: existing } = await sb.from("follow_ups").select("assigned_to, created_by, lead_id").eq("id", id).single();
  const fu = existing as { assigned_to: string | null; created_by: string | null; lead_id: string | null } | null;
  if (!fu) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  if (role !== "admin" && fu.assigned_to !== user.id && fu.created_by !== user.id) {
    return NextResponse.json({ ok: false, error: "Not allowed" }, { status: 403 });
  }

  const { error } = await sb.from("follow_ups").update({ status: "done" }).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await sb.from("automation_events").insert({
    source: "web_app", event_type: "follow_up_completed", status: "success",
    related_lead_id: fu.lead_id, triggered_by: user.id,
    payload: { followUpId: id },
  });

  return NextResponse.json({ ok: true });
}
