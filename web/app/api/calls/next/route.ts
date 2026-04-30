// GET /api/calls/next?afterLeadId=
// Returns the next lead to call from the user's queue (or null if empty).

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, role } = auth;

  const url = new URL(request.url);
  const after = url.searchParams.get("afterLeadId");

  const sb = createSupabaseAdminClient();
  let q = sb.from("leads_view")
    .select("lead_id")
    .in("status", ["new", "ready_to_call", "in_outreach", "no_answer"])
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  if (role === "caller") q = q.eq("assigned_to", user.id);
  if (after) q = q.neq("lead_id", after);

  const { data, error } = await q.limit(1).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const next = (data as { lead_id: string } | null)?.lead_id ?? null;
  return NextResponse.json({ ok: true, data: { nextLeadId: next } });
}
