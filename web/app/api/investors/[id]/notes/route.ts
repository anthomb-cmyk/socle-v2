// GET  /api/investors/[id]/notes — list notes
// POST /api/investors/[id]/notes — create a note

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("investor_notes")
    .select("*")
    .eq("investor_id", id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: data ?? [] });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const text = String(body.body ?? "").trim();
  if (!text) {
    return NextResponse.json({ ok: false, error: "body est requis" }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("investor_notes")
    .insert({
      investor_id: id,
      body: text,
      author_id: auth.user.id,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: { id: data!.id } }, { status: 201 });
}
