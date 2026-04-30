// GET /api/proposed-actions — list (admin only).
// Query: ?status=pending|accepted|rejected

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";

  const sb = createSupabaseAdminClient();
  const { data, error } = await sb.from("proposed_actions")
    .select("id, action_type, target_table, target_id, proposed_change, rationale, confidence, source, status, created_at")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Hydrate target if it's a lead
  const rows = (data ?? []) as Array<{ id: string; target_table: string; target_id: string | null }>;
  const leadIds = rows.filter(r => r.target_table === "leads" && r.target_id).map(r => r.target_id!);
  let leadInfo: Record<string, { full_name: string | null; company_name: string | null; address: string; city: string | null }> = {};
  if (leadIds.length > 0) {
    const { data: leads } = await sb.from("leads_view").select("lead_id, full_name, company_name, address, city").in("lead_id", leadIds);
    leadInfo = Object.fromEntries(((leads ?? []) as Array<{ lead_id: string; full_name: string | null; company_name: string | null; address: string; city: string | null }>).map(l => [l.lead_id, l]));
  }

  return NextResponse.json({
    ok: true,
    data: rows.map(r => ({
      ...r,
      target_lead: r.target_table === "leads" && r.target_id ? leadInfo[r.target_id] ?? null : null,
    })),
  });
}
