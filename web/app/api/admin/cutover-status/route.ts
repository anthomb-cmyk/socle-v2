// /api/admin/cutover-status — server-side data fetch for the cutover monitoring page.
//
// Returns:
//   - today's Twilio + Brave usage and caps
//   - last-24h pipeline activity (canonical_owner refreshes / evidence rows)
//   - last-24h tier distribution (owner_record by primary_phone_tier)
//   - last 5 enrichment_events errors
//   - the current ENRICHMENT_USE_LEGACY env value
//
// Admin-only: same auth pattern as /admin/backtest-review.

import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import {
  getDailyUsage,
  getTwilioDailyCap,
  getBraveDailyCap,
} from "@/lib/research/rate-limits";

export interface CutoverStatus {
  twilio: { used: number; cap: number };
  brave: { used: number; cap: number };
  last24h: {
    leadsEnriched: number;
    tierDistribution: Record<string, number>;
    recentErrors: Array<{
      lead_id: string | null;
      event_type: string;
      payload: unknown;
      created_at: string;
    }>;
  };
  envFlag: { name: "ENRICHMENT_USE_LEGACY"; value: string };
}

export async function GET() {
  const sb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.app_metadata?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [twilioUsed, braveUsed] = await Promise.all([
    getDailyUsage(admin, "twilio_lookups"),
    getDailyUsage(admin, "brave_queries"),
  ]);

  // Leads enriched in last 24h: count owner_record rows whose research_completed_at is recent.
  const { count: leadsEnriched } = await admin
    .from("owner_record")
    .select("record_id", { count: "exact", head: true })
    .gt("research_completed_at", since);

  // Tier distribution from owner_record.primary_phone_tier.
  const { data: tierRows } = await admin
    .from("owner_record")
    .select("primary_phone_tier")
    .gt("research_completed_at", since);

  const tierDistribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0, none: 0 };
  for (const r of (tierRows ?? []) as Array<{ primary_phone_tier: string | null }>) {
    const tier = r.primary_phone_tier ?? "none";
    tierDistribution[tier] = (tierDistribution[tier] ?? 0) + 1;
  }

  // Recent errors: pull last 5 enrichment_events whose payload mentions error.
  const { data: errorEvents } = await admin
    .from("enrichment_events")
    .select("lead_id, event_type, payload, created_at")
    .gt("created_at", since)
    .or("event_type.ilike.%error%,event_type.ilike.%failed%,event_type.ilike.%rejected%")
    .order("created_at", { ascending: false })
    .limit(5);

  const status: CutoverStatus = {
    twilio: { used: twilioUsed, cap: getTwilioDailyCap() },
    brave: { used: braveUsed, cap: getBraveDailyCap() },
    last24h: {
      leadsEnriched: leadsEnriched ?? 0,
      tierDistribution,
      recentErrors: (errorEvents ?? []) as CutoverStatus["last24h"]["recentErrors"],
    },
    envFlag: {
      name: "ENRICHMENT_USE_LEGACY",
      value: process.env.ENRICHMENT_USE_LEGACY ?? "(unset)",
    },
  };

  return NextResponse.json(status);
}
