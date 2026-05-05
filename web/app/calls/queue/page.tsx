import React from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import CallerAppShell from "@/components/caller/CallerAppShell";
import CallerQueueStats from "@/components/caller/CallerQueueStats";
import NextStepBanner from "@/components/next-step-banner";
import QueueLeadList, {
  type QueueLead,
  type QueueEmptyDiagnostics,
} from "./QueueLeadList";

const CALLABLE_STATUSES = [
  "new", "ready_to_call", "in_outreach", "no_answer", "phone_verified",
] as const;

export default async function CallQueuePage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role ?? "caller") as string;
  const isAdmin = role === "admin";

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

  const allMyLeads = ((queueRes.data ?? []) as QueueLead[]);
  const leads = allMyLeads.filter((l) => !lockedByOthers.has(l.lead_id));
  const hotSellers = hotSellersRes.count ?? 0;
  const myLockedByOthersCount = allMyLeads.length - leads.length;

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

  // ── Empty-state diagnostics ─────────────────────────────────────────────
  // When the queue is empty, fetch a small breakdown so the user understands
  // *why* the queue is empty. These are read-only COUNT queries — they do
  // NOT modify the queue's primary filter logic (assigned_to, CALLABLE_STATUSES,
  // best_phone, next_action_at, call_locks all stay enforced above).
  let emptyDiagnostics: QueueEmptyDiagnostics | null = null;
  if (leads.length === 0) {
    const [unassignedRes, futureRes, missingPhoneRes] = await Promise.all([
      // Globally unassigned callable leads (admin can assign these)
      sb.from("leads")
        .select("id", { count: "exact", head: true })
        .in("status", CALLABLE_STATUSES as unknown as string[])
        .is("assigned_to", null),
      // My callable leads with a future-dated callback (excluded until due)
      sb.from("leads_view")
        .select("lead_id", { count: "exact", head: true })
        .eq("assigned_to", user.id)
        .in("status", CALLABLE_STATUSES as unknown as string[])
        .gt("next_action_at", now),
      // My callable leads missing best_phone (need phone-review approval)
      sb.from("leads_view")
        .select("lead_id", { count: "exact", head: true })
        .eq("assigned_to", user.id)
        .in("status", CALLABLE_STATUSES as unknown as string[])
        .is("best_phone", null),
    ]);

    emptyDiagnostics = {
      unassignedGlobal:    unassignedRes.count ?? 0,
      myFutureCallbacks:   futureRes.count ?? 0,
      myMissingPhone:      missingPhoneRes.count ?? 0,
      myLockedByOthers:    myLockedByOthersCount,
      isAdmin,
    };
  }

  return (
    <CallerAppShell
      width="wide"
      // Render stats even when the queue is empty so the redesigned shell
      // is visible. Tiles will show 0/0/0/— in that case.
      stats={<CallerQueueStats leads={leads} />}
    >
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
        emptyDiagnostics={emptyDiagnostics}
      />
    </CallerAppShell>
  );
}
