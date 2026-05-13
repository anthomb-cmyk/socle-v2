// GET  /api/investors/[id]/deals — list deals
// POST /api/investors/[id]/deals — create a deal

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const VALID_STAGES = [
  "prospect", "discussing", "loi", "due_diligence", "financing", "closed_won", "closed_lost",
];

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("investor_deals")
    .select("*, properties(id, address, city, num_units)")
    .eq("investor_id", id)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: data ?? [] });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const deal_name = String(body.deal_name ?? "").trim();
  if (!deal_name) {
    return NextResponse.json({ ok: false, error: "deal_name est requis" }, { status: 400 });
  }
  const stage = String(body.stage ?? "prospect");
  if (!VALID_STAGES.includes(stage)) {
    return NextResponse.json({ ok: false, error: `stage invalide: ${stage}` }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("investor_deals")
    .insert({
      investor_id: id,
      deal_name,
      stage,
      property_id: body.property_id ?? null,
      ticket_size_cad: body.ticket_size_cad != null ? Number(body.ticket_size_cad) : null,
      expected_close_at: body.expected_close_at ?? null,
      probability_pct: body.probability_pct != null ? Number(body.probability_pct) : null,
      notes: body.notes ?? null,
      created_by: auth.user.id,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: { id: data!.id } }, { status: 201 });
}
