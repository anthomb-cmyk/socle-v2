// GET /api/properties — search/filter properties (admin sees all).
// Query: ?city=&q=&limit=&offset=

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const city = url.searchParams.get("city")?.trim();
  const q = url.searchParams.get("q")?.trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), 500);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const sb = createSupabaseAdminClient();
  let query = sb.from("properties")
    .select("id, address, city, matricule, num_units, year_built, evaluation_total, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (city) query = query.ilike("city", `%${city}%`);
  if (q) query = query.or(`address.ilike.%${q}%,matricule.ilike.%${q}%`);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Lead count per property (for the duplicate-risk hint)
  const ids = (data ?? []).map((p: { id: string }) => p.id);
  let leadCounts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: leadRows } = await sb.from("leads").select("property_id").in("property_id", ids);
    leadCounts = (leadRows ?? []).reduce((acc: Record<string, number>, r: { property_id: string }) => {
      acc[r.property_id] = (acc[r.property_id] ?? 0) + 1;
      return acc;
    }, {});
  }

  return NextResponse.json({
    ok: true,
    data: {
      properties: (data ?? []).map((p: { id: string }) => ({ ...p, lead_count: leadCounts[p.id] ?? 0 })),
      total: count ?? 0,
    },
  });
}
