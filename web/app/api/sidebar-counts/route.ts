// GET /api/sidebar-counts
// Returns aggregate counts for the sidebar badges.
// Admin-only via requireAdmin (cookie-based auth).

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const sb = createSupabaseAdminClient();

  const [
    leadsTotalRes,
    leadsReadyRes,
    phoneCandRes,
    smsRes,
    reviewItemsRes,
    proposedActionsRes,
    hotSellersRes,
  ] = await Promise.all([
    sb.from("leads").select("id", { count: "planned", head: true }),
    sb.from("leads").select("id", { count: "planned", head: true }).eq("status", "ready_to_call"),
    sb.from("phone_candidates")
      .select("id", { count: "planned", head: true })
      .eq("candidate_status", "needs_anthony_review"),
    sb.from("automation_events")
      .select("id", { count: "planned", head: true })
      .eq("event_type", "sms_received"),
    sb.from("review_items")
      .select("id", { count: "planned", head: true })
      .eq("status", "open"),
    sb.from("proposed_actions")
      .select("id", { count: "planned", head: true })
      .eq("status", "pending"),
    // lead_submissions may not exist; catch gracefully
    sb.from("lead_submissions")
      .select("id", { count: "planned", head: true })
      .eq("status", "pending"),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      leads_total:                   leadsTotalRes.count        ?? 0,
      leads_ready_to_call:           leadsReadyRes.count        ?? 0,
      sms_threads_total:             smsRes.count               ?? 0,
      phone_candidates_needs_review: phoneCandRes.count         ?? 0,
      review_items_pending:          reviewItemsRes.count       ?? 0,
      proposed_actions_pending:      proposedActionsRes.count   ?? 0,
      hot_sellers_pending:           hotSellersRes.count        ?? 0,
    },
  });
}
