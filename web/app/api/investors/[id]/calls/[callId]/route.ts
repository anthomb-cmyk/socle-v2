// PATCH  /api/investors/[id]/calls/[callId] — update summary / outcome / transcript
// DELETE /api/investors/[id]/calls/[callId] — delete a call entry

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const UPDATABLE = ["summary", "outcome", "transcript", "transcript_status", "direction", "duration_sec"] as const;

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; callId: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id: investorId, callId } = await ctx.params;
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
    .from("investor_calls")
    .update(updates)
    .eq("id", callId)
    .eq("investor_id", investorId);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; callId: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id: investorId, callId } = await ctx.params;

  const sb = createSupabaseAdminClient();
  const { error } = await sb
    .from("investor_calls")
    .delete()
    .eq("id", callId)
    .eq("investor_id", investorId);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
