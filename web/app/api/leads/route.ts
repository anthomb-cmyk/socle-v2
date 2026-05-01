// GET /api/leads
// Query: ?city=&status=&assigned_to=&campaign_id=&has_phone=&q=&limit=&offset=
// Admin sees everything. Caller sees only their assigned leads.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, role } = auth;

  const url = new URL(request.url);
  const city = url.searchParams.get("city")?.trim();
  const status = url.searchParams.get("status")?.trim();
  const assignedTo = url.searchParams.get("assigned_to")?.trim();
  const campaignId = url.searchParams.get("campaign_id")?.trim();
  const hasPhone = url.searchParams.get("has_phone")?.trim(); // "1" = only with phone
  const q = url.searchParams.get("q")?.trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), 500);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const sb = createSupabaseAdminClient();
  let query = sb.from("leads_view").select("*", { count: "exact" })
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (role === "caller") {
    query = query.eq("assigned_to", user.id);
  } else if (assignedTo) {
    if (assignedTo === "unassigned") query = query.is("assigned_to", null);
    else if (assignedTo === "assigned") query = query.not("assigned_to", "is", null);
    else query = query.eq("assigned_to", assignedTo);
  }

  if (city) query = query.ilike("city", `%${city}%`);
  if (status) query = query.eq("status", status);
  if (campaignId) query = query.eq("campaign_id", campaignId);
  if (hasPhone === "1") query = query.not("best_phone", "is", null);
  if (q) query = query.or(`address.ilike.%${q}%,full_name.ilike.%${q}%,company_name.ilike.%${q}%`);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Filters sidebar data: distinct cities + campaigns
  const [cityRows, campaignRows] = await Promise.all([
    sb.from("properties").select("city").not("city", "is", null),
    sb.from("campaigns").select("id, name").order("name", { ascending: true }),
  ]);
  const cities = [...new Set((cityRows.data ?? []).map((r: { city: string }) => r.city).filter(Boolean))].sort();
  const campaigns = (campaignRows.data ?? []) as { id: string; name: string }[];

  return NextResponse.json({ ok: true, data: { leads: data ?? [], total: count ?? 0, cities, campaigns } });
}
