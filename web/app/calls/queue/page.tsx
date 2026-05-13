import React from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import CallerAppShell from "@/components/caller/CallerAppShell";
import type { AdminScope } from "@/components/caller/CallerQueueScopeBar";
import NextStepBanner from "@/components/next-step-banner";
import QueueLeadList, {
  type QueueLead,
  type QueueEmptyDiagnostics,
} from "./QueueLeadList";

const CALLABLE_STATUSES = [
  "new", "ready_to_call", "in_outreach", "no_answer", "phone_verified",
] as const;

const VALID_ADMIN_SCOPES: ReadonlyArray<AdminScope> = ["all", "mine", "unassigned"];

/**
 * Resolve the queue scope with a server-side security gate:
 *   - admin: honor `?scope=…` if it's a valid value, otherwise default to "all"
 *   - any other role (caller-tier): hardcoded to "mine" — the URL param is
 *     ignored. This is the only place that decides what assigned_to filter
 *     gets applied to the leads_view query, so caller-tier users cannot
 *     see other people's leads or unassigned leads regardless of input.
 */
function resolveScope(isAdmin: boolean, requested: string | null): AdminScope {
  if (!isAdmin) return "mine";
  if (requested && (VALID_ADMIN_SCOPES as readonly string[]).includes(requested)) {
    return requested as AdminScope;
  }
  return "all";
}

export default async function CallQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role ?? "caller") as string;
  const isAdmin = role === "admin";

  const params = await searchParams;
  const requestedScope = typeof params.scope === "string" ? params.scope : null;
  const scope = resolveScope(isAdmin, requestedScope);

  const sb = createSupabaseAdminClient();
  const now = new Date().toISOString();

  // Build the leads_view query. Predicates that always apply:
  //   - status IN CALLABLE_STATUSES
  //   - best_phone IS NOT NULL
  //   - next_action_at IS NULL OR <= now (future callbacks deferred)
  //   - sort: priority DESC → next_action_at ASC → last_contacted_at ASC
  // The assigned_to predicate is the only thing that branches on scope.
  // NOTE: fit_score lives on leads.* but is NOT exposed by leads_view.
  // Selecting/ordering on it makes Postgrest throw `column does not exist`,
  // which silently returns zero rows to the queue page → "I see no leads" bug.
  // The earlier hotfix 1765ecc removed fit_score from /api/leads but missed
  // this file. Re-add fit_score to the view (migration) if we want to surface
  // it again — for now keep the queue working by leaving it out.
  let queueQuery = sb
    .from("leads_view")
    .select("lead_id,full_name,company_name,address,city,num_units,best_phone,status,campaign_name,last_contacted_at,next_action_at,priority,assigned_to")
    .in("status", CALLABLE_STATUSES as unknown as string[])
    .not("best_phone", "is", null)
    .or(`next_action_at.is.null,next_action_at.lte.${now}`)
    .order("priority", { ascending: false })
    .order("next_action_at", { ascending: true, nullsFirst: false })
    .order("last_contacted_at", { ascending: true, nullsFirst: true });

  if (scope === "mine") {
    // Caller-tier always lands here. Admin scope=mine also lands here.
    queueQuery = queueQuery.eq("assigned_to", user.id);
  } else if (scope === "unassigned") {
    // Admin only — gated by resolveScope above.
    queueQuery = queueQuery.is("assigned_to", null);
  }
  // scope === "all" → no assigned_to filter (admin only, gated above)

  const [queueRes, hotSellersRes, locksRes] = await Promise.all([
    queueQuery,
    sb.from("review_items")
      .select("id", { count: "planned", head: true })
      .eq("status", "open"),
    sb.from("call_locks")
      .select("lead_id")
      .neq("locked_by", user.id)
      .gt("expires_at", now),
  ]);

  // Build a set of lead IDs currently locked by someone else (preserve existing
  // exclusion semantics — applies to every scope, every role).
  const lockedByOthers = new Set(
    (locksRes.data ?? []).map((r: { lead_id: string }) => r.lead_id),
  );

  const allMyLeads = ((queueRes.data ?? []) as QueueLead[]);
  const leads = allMyLeads.filter((l) => !lockedByOthers.has(l.lead_id));
  const hotSellers = hotSellersRes.count ?? 0;
  const myLockedByOthersCount = allMyLeads.length - leads.length;

  // Per-lead call counts — use a DB aggregate to avoid fetching every call_log row.
  // Falls back to empty object on any error (non-critical UI counter).
  const leadIds = leads.map((l) => l.lead_id);
  const callCounts: Record<string, number> = {};
  if (leadIds.length > 0) {
    const { data: countRows } = await sb.rpc(
      "get_call_counts_for_leads",
      { lead_ids: leadIds },
    ) as { data: Array<{ lead_id: string; call_count: number }> | null };
    (countRows ?? []).forEach((row) => {
      callCounts[row.lead_id] = Number(row.call_count);
    });
  }

  // Empty-state diagnostics — read-only COUNT queries, only when empty.
  // Skip the global-unassigned line when scope="all" (already in the list)
  // or scope="unassigned" (the list IS those leads).
  let emptyDiagnostics: QueueEmptyDiagnostics | null = null;
  if (leads.length === 0) {
    const wantsUnassignedDiag = scope === "mine"; // only useful when filtered to me

    const [unassignedRes, futureRes, missingPhoneRes] = await Promise.all([
      wantsUnassignedDiag
        ? sb.from("leads")
            .select("id", { count: "planned", head: true })
            .in("status", CALLABLE_STATUSES as unknown as string[])
            .is("assigned_to", null)
        : Promise.resolve({ count: 0 } as { count: number | null }),
      // Personal future-callback count is "mine"-shaped — only meaningful
      // when scope filters to me.
      scope === "mine"
        ? sb.from("leads_view")
            .select("lead_id", { count: "planned", head: true })
            .eq("assigned_to", user.id)
            .in("status", CALLABLE_STATUSES as unknown as string[])
            .gt("next_action_at", now)
        : Promise.resolve({ count: 0 } as { count: number | null }),
      scope === "mine"
        ? sb.from("leads_view")
            .select("lead_id", { count: "planned", head: true })
            .eq("assigned_to", user.id)
            .in("status", CALLABLE_STATUSES as unknown as string[])
            .is("best_phone", null)
        : Promise.resolve({ count: 0 } as { count: number | null }),
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
        isAdmin={isAdmin}
        scope={scope}
      />
    </CallerAppShell>
  );
}
