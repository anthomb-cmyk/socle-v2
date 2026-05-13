// GET  /api/investors/[id]/calls — list calls for an investor
// POST /api/investors/[id]/calls — log a manual call entry (no Twilio link)
//
// To attach a Twilio recording by Call SID, use:
//   POST /api/investors/[id]/calls/attach-twilio  { call_sid }

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;

  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("investor_calls")
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

  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("investor_calls")
    .insert({
      investor_id: id,
      direction: body.direction ?? "manual",
      duration_sec: body.duration_sec != null ? Number(body.duration_sec) : null,
      summary: body.summary ?? null,
      outcome: body.outcome ?? null,
      transcript: body.transcript ?? null,
      transcript_status: body.transcript ? "completed" : "skipped",
      started_at: body.started_at ?? new Date().toISOString(),
      recorded_at: body.recorded_at ?? null,
      logged_by: auth.user.id,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: { id: data!.id } }, { status: 201 });
}
