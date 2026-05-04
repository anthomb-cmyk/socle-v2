// POST /api/calls/lock   — acquire a 30-min call lock on a lead
// DELETE /api/calls/lock?leadId= — release the lock

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const LOCK_MINUTES = 30;

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body: { leadId: string };
  try {
    body = z.object({ leadId: z.string().uuid() }).parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: "leadId (uuid) required" }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  const now = new Date();

  // Clean up any expired lock for this lead first
  await sb.from("call_locks")
    .delete()
    .eq("lead_id", body.leadId)
    .lt("expires_at", now.toISOString());

  // Check if a non-expired lock exists from a *different* caller
  const { data: existing } = await sb
    .from("call_locks")
    .select("locked_by, expires_at")
    .eq("lead_id", body.leadId)
    .gt("expires_at", now.toISOString())
    .maybeSingle();

  if (existing && existing.locked_by !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Lead is currently being called by another agent" },
      { status: 409 },
    );
  }

  // Upsert our lock (own lock refresh is fine — extends TTL)
  const expiresAt = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000).toISOString();
  const { error } = await sb.from("call_locks").upsert(
    {
      lead_id: body.leadId,
      locked_by: user.id,
      locked_at: now.toISOString(),
      expires_at: expiresAt,
    },
    { onConflict: "lead_id" },
  );
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, data: { expiresAt } });
}

export async function DELETE(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const leadId = new URL(request.url).searchParams.get("leadId");
  if (!leadId) return NextResponse.json({ ok: false, error: "leadId required" }, { status: 400 });

  const sb = createSupabaseAdminClient();
  // Only release our own lock — never someone else's
  await sb.from("call_locks")
    .delete()
    .eq("lead_id", leadId)
    .eq("locked_by", user.id);

  return NextResponse.json({ ok: true });
}
