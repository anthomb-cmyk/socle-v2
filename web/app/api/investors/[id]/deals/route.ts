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
    .select("*, properties(id, address, city, num_units), pipeline_deal:deals(id, title, stage, address, units, asking_price, offer_price)")
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
  const pipelineDealId = body.pipeline_deal_id ? String(body.pipeline_deal_id) : null;
  if (!deal_name && !pipelineDealId) {
    return NextResponse.json({ ok: false, error: "deal_name ou pipeline_deal_id est requis" }, { status: 400 });
  }
  const stage = String(body.stage ?? "prospect");
  if (!VALID_STAGES.includes(stage)) {
    return NextResponse.json({ ok: false, error: `stage invalide: ${stage}` }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  let pipelineDeal: { id: string; title: string; stage: string } | null = null;

  if (pipelineDealId) {
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, title, stage")
      .eq("id", pipelineDealId)
      .maybeSingle();

    if (dealErr) return NextResponse.json({ ok: false, error: dealErr.message }, { status: 500 });
    if (!deal) return NextResponse.json({ ok: false, error: "Deal pipeline introuvable" }, { status: 404 });
    if (["cloture", "abandonne"].includes(deal.stage)) {
      return NextResponse.json({ ok: false, error: "Le deal pipeline doit être actif" }, { status: 400 });
    }
    pipelineDeal = deal;
  }

  const { data, error } = await sb
    .from("investor_deals")
    .insert({
      investor_id: id,
      deal_name: pipelineDeal?.title ?? deal_name,
      stage,
      pipeline_deal_id: pipelineDealId,
      property_id: body.property_id ?? null,
      ticket_size_cad: body.ticket_size_cad != null ? Number(body.ticket_size_cad) : null,
      expected_close_at: body.expected_close_at ?? null,
      probability_pct: body.probability_pct != null ? Number(body.probability_pct) : null,
      notes: body.notes ?? null,
      created_by: auth.user.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ ok: false, error: "Ce deal pipeline est déjà lié à cet investisseur." }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, data: { id: data!.id } }, { status: 201 });
}
