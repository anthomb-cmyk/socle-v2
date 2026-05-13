// GET /api/dashboard — admin dashboard summary

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const sb = createSupabaseAdminClient();
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  const dayAgo = new Date(now); dayAgo.setDate(dayAgo.getDate() - 1);

  const [
    openReviews,
    urgentReviews,
    newLeads,
    leadsToCall,
    overdueFollowUps,
    todayFollowUps,
    recentImports,
    recentFailures,
  ] = await Promise.all([
    sb.from("review_items").select("id", { count: "planned", head: true }).eq("status", "open"),
    sb.from("review_items").select("id", { count: "planned", head: true }).eq("status", "open").eq("urgency", "urgent"),
    sb.from("leads").select("id", { count: "planned", head: true }).eq("status", "new"),
    sb.from("leads").select("id", { count: "planned", head: true }).in("status", ["new", "ready_to_call", "in_outreach", "no_answer"]).not("assigned_to", "is", null),
    sb.from("follow_ups").select("id", { count: "planned", head: true }).eq("status", "pending").lt("due_at", todayStart.toISOString()),
    sb.from("follow_ups").select("id", { count: "planned", head: true }).eq("status", "pending").gte("due_at", todayStart.toISOString()).lt("due_at", todayEnd.toISOString()),
    sb.from("import_jobs").select("id, file_name, status, properties_created, leads_created, errors_count, created_at").order("created_at", { ascending: false }).limit(5),
    sb.from("automation_events").select("id, source, event_type, error_message, occurred_at").eq("status", "failed").gte("occurred_at", dayAgo.toISOString()).order("occurred_at", { ascending: false }).limit(5),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      counts: {
        openReviews: openReviews.count ?? 0,
        urgentReviews: urgentReviews.count ?? 0,
        newLeads: newLeads.count ?? 0,
        leadsToCall: leadsToCall.count ?? 0,
        overdueFollowUps: overdueFollowUps.count ?? 0,
        todayFollowUps: todayFollowUps.count ?? 0,
      },
      recentImports: recentImports.data ?? [],
      recentFailures: recentFailures.data ?? [],
    },
  });
}
