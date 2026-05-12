// GET /api/phone-review
//
// Returns phone candidates that need Anthony's review.
// Joins through to the lead, property, and contact for full context.
// Query params: ?status=needs_anthony_review (default) | all | &leadId=uuid

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") ?? "needs_anthony_review";
  const leadId = url.searchParams.get("leadId");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100", 10), 500);

  const sb = createSupabaseAdminClient();

  let q = sb
    .from("phone_candidates")
    .select(`
      id,
      lead_id,
      contact_id,
      phone_raw,
      phone_e164,
      stage,
      source_label,
      source_url,
      snippet,
      initial_confidence,
      openclaw_verdict,
      openclaw_confidence,
      openclaw_evidence,
      openclaw_reasoning,
      candidate_status,
      review_reason,
      created_at,
      leads (
        id,
        status,
        campaign_id,
        campaigns ( name ),
        properties ( id, address, city, num_units ),
        contacts (
          id,
          full_name,
          company_name,
          mailing_address,
          mailing_city,
          mailing_postal
        )
      )
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (statusFilter !== "all") q = q.eq("candidate_status", statusFilter);
  if (leadId) q = q.eq("lead_id", leadId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = (data ?? []) as Array<{
    snippet?: string | null;
    leads?: { properties?: { id?: string | null } | null } | null;
  }>;
  const propertyIds = [
    ...new Set(rows.map((row) => row.leads?.properties?.id).filter((id): id is string => Boolean(id))),
  ];
  const neqs = [
    ...new Set(rows.map((row) => row.snippet?.match(/\((\d{10})\)/)?.[1] ?? null).filter((neq): neq is string => Boolean(neq))),
  ];

  const [ownerLinksRes, directorsRes] = await Promise.all([
    propertyIds.length > 0
      ? sb
          .from("property_contacts")
          .select("property_id, contacts ( id, full_name, company_name )")
          .in("property_id", propertyIds)
          .eq("relationship", "owner")
      : Promise.resolve({ data: [], error: null }),
    neqs.length > 0
      ? sb
          .from("req_directors")
          .select("neq, full_name")
          .in("neq", neqs)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const ownerNamesByProperty = new Map<string, string[]>();
  for (const row of ownerLinksRes.data ?? []) {
    const link = row as {
      property_id?: string | null;
      contacts?: { full_name?: string | null; company_name?: string | null } | null;
    };
    if (!link.property_id) continue;
    const name = link.contacts?.full_name?.trim() || link.contacts?.company_name?.trim() || "";
    if (!name) continue;
    ownerNamesByProperty.set(link.property_id, [
      ...(ownerNamesByProperty.get(link.property_id) ?? []),
      name,
    ]);
  }

  const directorNamesByNeq = new Map<string, string[]>();
  for (const row of directorsRes.data ?? []) {
    const director = row as { neq?: string | null; full_name?: string | null };
    if (!director.neq || !director.full_name?.trim()) continue;
    directorNamesByNeq.set(director.neq, [
      ...(directorNamesByNeq.get(director.neq) ?? []),
      director.full_name.trim(),
    ]);
  }

  const enrichedRows = rows.map((row) => {
    const propertyId = row.leads?.properties?.id;
    const neq = row.snippet?.match(/\((\d{10})\)/)?.[1] ?? null;
    return {
      ...row,
      co_owner_names: propertyId ? [...new Set(ownerNamesByProperty.get(propertyId) ?? [])] : [],
      req_director_names: neq ? [...new Set(directorNamesByNeq.get(neq) ?? [])] : [],
    };
  });

  return NextResponse.json({ ok: true, data: enrichedRows });
}
