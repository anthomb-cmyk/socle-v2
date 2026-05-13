// PATCH  /api/investors/[id]/deals/[dealId] — update a deal
// DELETE /api/investors/[id]/deals/[dealId] — delete a deal

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const UPDATABLE = [
  "deal_name", "stage", "property_id", "ticket_size_cad",
  "expected_close_at", "probability_pct", "notes",
] as const;

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; dealId: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id: investorId, dealId } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const updates: Record<string, unknown> = {};
  for (const key of UPDATABLE) {
    if (key in body) updates[key] = body[key];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  const { error } = await sb
    .from("investor_deals")
    .update(updates)
    .eq("id", dealId)
    .eq("investor_id", investorId);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; dealId: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id: investorId, dealId } = await ctx.params;

  const sb = createSupabaseAdminClient();
  const { error } = await sb
    .from("investor_deals")
    .delete()
    .eq("id", dealId)
    .eq("investor_id", investorId);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
