import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const sb = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await sb.from("review_items")
    .update({
      status: "accepted",
      resolved_by: auth.user.id,
      resolved_at: now,
      resolution_note: "approved",
    })
    .eq("id", id)
    .eq("status", "open")
    .select("id, lead_id, title")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "Not found or already resolved" }, { status: 404 });

  await sb.from("automation_events").insert({
    source: "web_app",
    event_type: "review_item_approved",
    status: "success",
    triggered_by: auth.user.id,
    related_lead_id: (data as { lead_id: string | null }).lead_id,
    payload: { reviewItemId: id, title: (data as { title: string }).title },
  });

  return NextResponse.json({ ok: true, action: "approved" });
}
