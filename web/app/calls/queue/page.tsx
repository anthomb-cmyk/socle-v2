import React from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import NextStepBanner from "@/components/next-step-banner";
import QueueLeadList, { type QueueLead } from "./QueueLeadList";

const CALLABLE_STATUSES = [
  "new", "ready_to_call", "in_outreach", "no_answer", "phone_verified",
] as const;

export default async function CallQueuePage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sb = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const [queueRes, hotSellersRes, locksRes] = await Promise.all([
    sb
      .from("leads_view")
      .select("lead_id,full_name,company_name,address,city,num_units,best_phone,status,campaign_name,last_contacted_at,next_action_at,priority")
      .eq("assigned_to", user.id)
      .in("status", CALLABLE_STATUSES as unknown as string[])
      .not("best_phone", "is", null)
      // Exclude leads scheduled for a future callback — they'll reappear when it's time
      .or(`next_action_at.is.null,next_action_at.lte.${now}`)
      // Overdue callbacks first, then by priority, then oldest-contacted first
      .order("priority", { ascending: false })
      .order("next_action_at", { ascending: true, nullsFirst: false })
      .order("last_contacted_at", { ascending: true, nullsFirst: true }),
    sb.from("review_items")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    // Fetch active locks held by OTHER callers so we can hide those leads
    sb.from("call_locks")
      .select("lead_id")
      .neq("locked_by", user.id)
      .gt("expires_at", now),
  ]);

  // Build a set of lead IDs currently locked by someone else
  const lockedByOthers = new Set(
    (locksRes.data ?? []).map((r: { lead_id: string }) => r.lead_id),
  );

  const leads = ((queueRes.data ?? []) as QueueLead[]).filter(
    (l) => !lockedByOthers.has(l.lead_id),
  );
  const hotSellers = hotSellersRes.count ?? 0;

  // Per-lead call counts (fetched separately to avoid a heavy view join)
  const leadIds = leads.map((l) => l.lead_id);
  const callCounts: Record<string, number> = {};
  if (leadIds.length > 0) {
    const { data: counts } = await sb
      .from("call_logs")
      .select("lead_id")
      .in("lead_id", leadIds);
    (counts ?? []).forEach((row: { lead_id: string | null }) => {
      if (row.lead_id) callCounts[row.lead_id] = (callCounts[row.lead_id] ?? 0) + 1;
    });
  }

  return (
    <>
      {leads.length === 0 && (
        <NextStepBanner
          kind="queue_empty"
          counts={{ ready: 0, review: 0, hotSellers }}
        />
      )}
      <QueueLeadList
        leads={leads}
        callCounts={callCounts}
        hotSellers={hotSellers}
      />
    </>
  );
}
