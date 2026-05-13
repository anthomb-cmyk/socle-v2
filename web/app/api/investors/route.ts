// GET  /api/investors      — list investors (with optional ?q= search, ?status= filter)
// POST /api/investors      — create a new investor
//
// Admin-only. Mirrors the contacts list pattern.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

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

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: { investors: data ?? [], total: count ?? 0 },
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
