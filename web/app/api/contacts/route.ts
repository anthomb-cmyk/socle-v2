// GET /api/contacts — search/filter contacts.
// Query: ?kind=&q=&limit=&offset=

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind")?.trim();
  const q = url.searchParams.get("q")?.trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), 500);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const sb = createSupabaseAdminClient();
  let query = sb.from("contacts")
    .select("id, kind, full_name, company_name, primary_email, primary_phone, mailing_city, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (kind) query = query.eq("kind", kind);
  if (q) query = query.or(`full_name.ilike.%${q}%,company_name.ilike.%${q}%`);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Hydrate each contact with phone count and lead count
  const ids = (data ?? []).map((c: { id: string }) => c.id);
  let phoneCounts: Record<string, number> = {};
  let leadCounts: Record<string, number> = {};
  if (ids.length > 0) {
    const [phonesRes, leadsRes] = await Promise.all([
      sb.from("phones").select("contact_id").in("contact_id", ids),
      sb.from("leads").select("contact_id").in("contact_id", ids),
    ]);
    phoneCounts = (phonesRes.data ?? []).reduce((acc: Record<string, number>, r: { contact_id: string | null }) => {
      if (r.contact_id) acc[r.contact_id] = (acc[r.contact_id] ?? 0) + 1;
      return acc;
    }, {});
    leadCounts = (leadsRes.data ?? []).reduce((acc: Record<string, number>, r: { contact_id: string }) => {
      acc[r.contact_id] = (acc[r.contact_id] ?? 0) + 1;
      return acc;
    }, {});
  }

  return NextResponse.json({
    ok: true,
    data: {
      contacts: (data ?? []).map((c: { id: string }) => ({
        ...c,
        phone_count: phoneCounts[c.id] ?? 0,
        lead_count: leadCounts[c.id] ?? 0,
      })),
      total: count ?? 0,
    },
  });
}
