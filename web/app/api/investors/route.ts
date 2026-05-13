// GET  /api/investors      — list investors (with optional ?q= search, ?status= filter)
// POST /api/investors      — create a new investor
//
// Admin-only. Mirrors the contacts list pattern.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

type InvestorRow = {
  id: string;
  full_name: string;
  firm_name: string | null;
  email: string | null;
  phone_e164: string | null;
  city: string | null;
  province: string | null;
  status: string;
  source: string | null;
  capital_available_cad: number | null;
  ticket_size_min_cad: number | null;
  ticket_size_max_cad: number | null;
  preferred_geography: string | null;
  asset_class_focus: string | null;
  created_at?: string;
  updated_at: string;
};

type InvestorSummaryRow = {
  id: string;
  full_name: string;
  status: string;
  capital_available_cad: number | null;
  ticket_size_min_cad: number | null;
  ticket_size_max_cad: number | null;
};

type InvestorDealRow = {
  investor_id: string;
  stage: string;
};

type InvestorCallRow = {
  investor_id: string;
  created_at: string;
  started_at: string | null;
  recorded_at: string | null;
};

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const status = (url.searchParams.get("status") ?? "").trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "200", 10), 500);

  const sb = createSupabaseAdminClient();

  let query = sb
    .from("investors")
    .select(
      "id, full_name, firm_name, email, phone_e164, city, province, status, source, " +
      "capital_available_cad, ticket_size_min_cad, ticket_size_max_cad, " +
      "preferred_geography, asset_class_focus, created_at, updated_at",
      { count: "exact" },
    )
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (q) {
    // Match against full_name or firm_name, case-insensitive.
    const pattern = `%${q.replace(/[%_]/g, "")}%`;
    query = query.or(`full_name.ilike.${pattern},firm_name.ilike.${pattern}`);
  }

  const [
    { data, error, count },
    dealsRes,
    callsRes,
    allInvestorsRes,
  ] = await Promise.all([
    query,
    sb.from("investor_deals").select("investor_id, stage"),
    sb.from("investor_calls").select("investor_id, created_at, started_at, recorded_at").order("created_at", { ascending: false }).limit(500),
    sb
      .from("investors")
      .select("id, full_name, status, capital_available_cad, ticket_size_min_cad, ticket_size_max_cad"),
  ]);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (dealsRes.error) {
    return NextResponse.json({ ok: false, error: dealsRes.error.message }, { status: 500 });
  }
  if (callsRes.error) {
    return NextResponse.json({ ok: false, error: callsRes.error.message }, { status: 500 });
  }
  if (allInvestorsRes.error) {
    return NextResponse.json({ ok: false, error: allInvestorsRes.error.message }, { status: 500 });
  }

  const investorRows = (data ?? []) as unknown as InvestorRow[];
  const dealRows = (dealsRes.data ?? []) as unknown as InvestorDealRow[];
  const callRows = (callsRes.data ?? []) as unknown as InvestorCallRow[];
  const allInvestors = (allInvestorsRes.data ?? []) as unknown as InvestorSummaryRow[];
  const activeDealStages = new Set(["prospect", "discussing", "loi", "due_diligence", "financing"]);
  const negotiationStages = new Set(["discussing", "loi", "due_diligence", "financing"]);

  const dealStatsByInvestor = new Map<string, { total: number; active: number; negotiating: number }>();
  for (const deal of dealRows) {
    const current = dealStatsByInvestor.get(deal.investor_id) ?? { total: 0, active: 0, negotiating: 0 };
    current.total += 1;
    if (activeDealStages.has(deal.stage)) current.active += 1;
    if (negotiationStages.has(deal.stage)) current.negotiating += 1;
    dealStatsByInvestor.set(deal.investor_id, current);
  }

  const lastCallByInvestor = new Map<string, string>();
  for (const call of callRows) {
    const at = call.recorded_at ?? call.started_at ?? call.created_at;
    if (!at || lastCallByInvestor.has(call.investor_id)) continue;
    lastCallByInvestor.set(call.investor_id, at);
  }

  const enriched = investorRows.map((investor) => {
    const dealStats = dealStatsByInvestor.get(investor.id) ?? { total: 0, active: 0, negotiating: 0 };
    return {
      ...investor,
      deals_count: dealStats.total,
      active_deals_count: dealStats.active,
      negotiating_deals_count: dealStats.negotiating,
      last_call_at: lastCallByInvestor.get(investor.id) ?? null,
    };
  });

  const capitalTotal = allInvestors.reduce(
    (sum, investor) => sum + (Number(investor.capital_available_cad) || 0),
    0,
  );
  const ticketValues = allInvestors
    .map((investor) => {
      const min = Number(investor.ticket_size_min_cad) || 0;
      const max = Number(investor.ticket_size_max_cad) || 0;
      if (min > 0 && max > 0) return (min + max) / 2;
      return max || min || 0;
    })
    .filter((value) => value > 0);
  const ticketAverage = ticketValues.length > 0
    ? Math.round(ticketValues.reduce((sum, value) => sum + value, 0) / ticketValues.length)
    : null;
  const statusCounts = allInvestors.reduce<Record<string, number>>((acc, investor) => {
    acc[investor.status] = (acc[investor.status] ?? 0) + 1;
    return acc;
  }, {});
  const lastCall = callRows[0]
    ? {
        investor_id: callRows[0].investor_id,
        at: callRows[0].recorded_at ?? callRows[0].started_at ?? callRows[0].created_at,
        investor_name: allInvestors.find((investor) => investor.id === callRows[0].investor_id)?.full_name ?? null,
      }
    : null;

  return NextResponse.json({
    ok: true,
    data: {
      investors: enriched,
      total: count ?? 0,
      summary: {
        capital_total_cad: capitalTotal,
        ticket_average_cad: ticketAverage,
        active_count: statusCounts.active ?? 0,
        prospect_count: statusCounts.prospect ?? 0,
        inactive_count: statusCounts.inactive ?? 0,
        lost_count: statusCounts.lost ?? 0,
        total_count: allInvestors.length,
        deals_linked_count: dealRows.length,
        negotiating_deals_count: dealRows.filter((deal) => negotiationStages.has(deal.stage)).length,
        last_call: lastCall,
      },
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));

  const full_name = String(body.full_name ?? "").trim();
  if (!full_name) {
    return NextResponse.json({ ok: false, error: "full_name est requis" }, { status: 400 });
  }

  const insert = {
    full_name,
    firm_name: body.firm_name ? String(body.firm_name).trim() : null,
    email: body.email ? String(body.email).trim().toLowerCase() : null,
    phone_e164: body.phone_e164 ? String(body.phone_e164).trim() : null,
    city: body.city ? String(body.city).trim() : null,
    province: body.province ? String(body.province).trim() : "QC",
    status: body.status ? String(body.status) : "active",
    source: body.source ? String(body.source).trim() : null,
    capital_available_cad: body.capital_available_cad != null ? Number(body.capital_available_cad) : null,
    ticket_size_min_cad: body.ticket_size_min_cad != null ? Number(body.ticket_size_min_cad) : null,
    ticket_size_max_cad: body.ticket_size_max_cad != null ? Number(body.ticket_size_max_cad) : null,
    preferred_geography: body.preferred_geography ? String(body.preferred_geography).trim() : null,
    asset_class_focus: body.asset_class_focus ? String(body.asset_class_focus).trim() : null,
    notes: body.notes ? String(body.notes) : null,
    created_by: auth.user.id,
  };

  const sb = createSupabaseAdminClient();
  const { data, error } = await sb
    .from("investors")
    .insert(insert)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, data: { id: data!.id } }, { status: 201 });
}
