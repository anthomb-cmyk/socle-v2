// GET    /api/investors/[id] — fetch one investor with calls, deals, notes
// PATCH  /api/investors/[id] — update fields
// DELETE /api/investors/[id] — hard delete (cascade removes calls/deals/notes)

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const UPDATABLE_FIELDS = [
  "full_name",
  "firm_name",
  "email",
  "phone_e164",
  "city",
  "province",
  "status",
  "source",
  "capital_available_cad",
  "ticket_size_min_cad",
  "ticket_size_max_cad",
  "preferred_geography",
  "asset_class_focus",
  "notes",
] as const;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const sb = createSupabaseAdminClient();

  const [{ data: investor, error: invErr }, calls, deals, notes] = await Promise.all([
    sb.from("investors").select("*").eq("id", id).maybeSingle(),
    sb.from("investor_calls").select("*").eq("investor_id", id).order("created_at", { ascending: false }),
    sb.from("investor_deals").select("*, properties(id, address, city, num_units)")
      .eq("investor_id", id).order("updated_at", { ascending: false }),
    sb.from("investor_notes").select("*").eq("investor_id", id).order("created_at", { ascending: false }),
  ]);

  if (invErr) return NextResponse.json({ ok: false, error: invErr.message }, { status: 500 });
  if (!investor) return NextResponse.json({ ok: false, error: "Investisseur introuvable" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    data: {
      investor,
      calls: calls.data ?? [],
      deals: deals.data ?? [],
      notes: notes.data ?? [],
    },
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const updates: Record<string, unknown> = {};
  for (const key of UPDATABLE_FIELDS) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  const { error } = await sb.from("investors").update(updates).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const sb = createSupabaseAdminClient();
  const { error } = await sb.from("investors").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
