import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { createHotSellerDealFromReview, type HotSellerDealAutomation } from "@/lib/deals/hot-seller";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const sb = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const { data: openItem, error: itemErr } = await sb
    .from("review_items")
    .select("id,source_kind,source_id,lead_id,contact_id,property_id,title,summary,urgency")
    .eq("id", id)
    .eq("status", "open")
    .maybeSingle();

  if (itemErr) return NextResponse.json({ ok: false, error: itemErr.message }, { status: 500 });
  if (!openItem) return NextResponse.json({ ok: false, error: "Not found or already resolved" }, { status: 404 });

  let automation: HotSellerDealAutomation = { dealId: null, followUpId: null };
  try {
    automation = await createHotSellerDealFromReview(sb, openItem, auth.user.id);
  } catch (err) {
    await sb.from("automation_events").insert({
      source: "web_app",
      event_type: "review_item_approved_deal_failed",
      status: "failed",
      triggered_by: auth.user.id,
      related_lead_id: (openItem as { lead_id: string | null }).lead_id,
      related_contact_id: (openItem as { contact_id: string | null }).contact_id,
      related_property_id: (openItem as { property_id: string | null }).property_id,
      payload: { reviewItemId: id, sourceKind: (openItem as { source_kind: string }).source_kind },
      error_message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Deal automation failed" }, { status: 500 });
  }

  const { data, error } = await sb.from("review_items")
    .update({
      status: "accepted",
      resolved_by: auth.user.id,
      resolved_at: now,
      resolution_note: "approved",
    })
    .eq("id", id)
    .eq("status", "open")
    .select("id, lead_id, contact_id, property_id, title")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "Not found or already resolved" }, { status: 404 });

  await sb.from("automation_events").insert({
    source: "web_app",
    event_type: "review_item_approved",
    status: "success",
    triggered_by: auth.user.id,
    related_lead_id: (data as { lead_id: string | null }).lead_id,
    related_contact_id: (data as { contact_id: string | null }).contact_id,
    related_property_id: (data as { property_id: string | null }).property_id,
    payload: { reviewItemId: id, title: (data as { title: string }).title },
    result: automation,
  });

  return NextResponse.json({ ok: true, action: "approved", data: automation });
}
