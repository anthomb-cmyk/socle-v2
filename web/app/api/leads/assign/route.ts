// POST /api/leads/assign
// Body: { leadIds: string[], userId: string | null }   (null = unassign)

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const Body = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(500),
  userId: z.string().uuid().nullable(),
});

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let parsed;
  try {
    parsed = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 });
  }
  const { leadIds, userId } = parsed;

  const sb = createSupabaseAdminClient();

  // Update leads.assigned_to
  const { error: updErr, count } = await sb.from("leads")
    .update({ assigned_to: userId }, { count: "exact" })
    .in("id", leadIds);
  if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

  // History rows
  if (userId) {
    const rows = leadIds.map(lead_id => ({
      lead_id, assigned_to: userId, assigned_by: user.id,
    }));
    await sb.from("lead_assignments").insert(rows);
  } else {
    // Mark previous assignments as unassigned
    await sb.from("lead_assignments").update({ unassigned_at: new Date().toISOString() })
      .in("lead_id", leadIds).is("unassigned_at", null);
  }

  // Audit
  await sb.from("automation_events").insert({
    source: "web_app",
    event_type: userId ? "leads_assigned" : "leads_unassigned",
    status: "success",
    triggered_by: user.id,
    payload: { leadIds, userId, count },
  });

  return NextResponse.json({ ok: true, data: { updated: count ?? 0 } });
}
