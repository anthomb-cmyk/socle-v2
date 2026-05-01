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
        properties ( address, city, num_units ),
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

  return NextResponse.json({ ok: true, data: data ?? [] });
}
