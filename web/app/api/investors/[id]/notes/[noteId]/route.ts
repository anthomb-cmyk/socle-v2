// PATCH  /api/investors/[id]/notes/[noteId]
// DELETE /api/investors/[id]/notes/[noteId]

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; noteId: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id: investorId, noteId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const text = String(body.body ?? "").trim();
  if (!text) return NextResponse.json({ ok: false, error: "body est requis" }, { status: 400 });

  const sb = createSupabaseAdminClient();
  const { error } = await sb
    .from("investor_notes")
    .update({ body: text })
    .eq("id", noteId)
    .eq("investor_id", investorId);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; noteId: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id: investorId, noteId } = await ctx.params;

  const sb = createSupabaseAdminClient();
  const { error } = await sb
    .from("investor_notes")
    .delete()
    .eq("id", noteId)
    .eq("investor_id", investorId);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
