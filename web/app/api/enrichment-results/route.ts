// GET /api/enrichment-results — list (admin/caller scoped).
// Query: ?leadId=&status=

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, role } = auth;

  const url = new URL(request.url);
  const leadId = url.searchParams.get("leadId");
  const status = url.searchParams.get("status");

  const sb = createSupabaseAdminClient();
  let q = sb.from("enrichment_results")
    .select("id, contact_id, lead_id, kind, value, source, source_url, confidence, evidence, status, found_in_job_id, reviewed_by, reviewed_at, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (leadId) q = q.eq("lead_id", leadId);
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // RLS-style filter for callers: only show results on leads they own
  if (role !== "admin") {
    const rows = (data ?? []) as Array<{ lead_id: string | null }>;
    const leadIds = [...new Set(rows.map(r => r.lead_id).filter(Boolean) as string[])];
    if (leadIds.length === 0) return NextResponse.json({ ok: true, data: [] });
    const { data: myLeads } = await sb.from("leads").select("id").in("id", leadIds).eq("assigned_to", user.id);
    const allowed = new Set(((myLeads ?? []) as Array<{ id: string }>).map(l => l.id));
    return NextResponse.json({ ok: true, data: rows.filter(r => r.lead_id && allowed.has(r.lead_id)) });
  }

  return NextResponse.json({ ok: true, data });
}
