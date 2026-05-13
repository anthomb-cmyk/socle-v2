import type { SupabaseClient } from "@supabase/supabase-js";

const CALLER_ROLES = ["caller", "cold_caller"] as const;
const CALLABLE_STATUSES = ["new", "ready_to_call", "phone_verified", "in_outreach", "no_answer"] as const;

type CallerRow = {
  user_id: string;
  display_name: string | null;
  role: string;
  is_active: boolean | null;
};

type CandidateLead = {
  lead_id: string;
  priority: number | null;
  next_action_at: string | null;
  created_at: string | null;
};

export type AutoAssignResult = {
  assigned: number;
  candidates: number;
  callers: Array<{
    userId: string;
    name: string;
    startingLoad: number;
    assigned: number;
    endingLoad: number;
  }>;
  skippedReason?: string;
};

function isDue(nextActionAt: string | null) {
  if (!nextActionAt) return true;
  return Date.parse(nextActionAt) <= Date.now();
}

function sortCandidates(a: CandidateLead, b: CandidateLead) {
  const byPriority = (b.priority ?? 0) - (a.priority ?? 0);
  if (byPriority !== 0) return byPriority;
  return Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? "");
}

export async function autoAssignCallableLeads(
  sb: SupabaseClient,
  opts: { importJobId?: string | null; assignedBy: string; limit?: number },
): Promise<AutoAssignResult> {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 1000);

  const { data: callerRows, error: callerErr } = await sb
    .from("users_meta")
    .select("user_id,display_name,role,is_active")
    .in("role", [...CALLER_ROLES])
    .order("display_name");
  if (callerErr) throw new Error(callerErr.message);

  const callers = ((callerRows ?? []) as CallerRow[]).filter((row) => row.is_active !== false);
  if (callers.length === 0) {
    return { assigned: 0, candidates: 0, callers: [], skippedReason: "no_active_callers" };
  }

  let importLeadIds: string[] | null = null;
  if (opts.importJobId) {
    const { data: importLeads, error: importErr } = await sb
      .from("leads")
      .select("id")
      .eq("source_import_job_id", opts.importJobId)
      .is("assigned_to", null)
      .in("status", [...CALLABLE_STATUSES])
      .limit(limit * 3);
    if (importErr) throw new Error(importErr.message);
    importLeadIds = ((importLeads ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (importLeadIds.length === 0) {
      return {
        assigned: 0,
        candidates: 0,
        callers: callers.map((caller) => ({
          userId: caller.user_id,
          name: caller.display_name ?? "Caller",
          startingLoad: 0,
          assigned: 0,
          endingLoad: 0,
        })),
        skippedReason: "no_import_leads",
      };
    }
  }

  let candidateQuery = sb
    .from("leads_view")
    .select("lead_id,priority,next_action_at,created_at")
    .is("assigned_to", null)
    .in("status", [...CALLABLE_STATUSES])
    .not("best_phone", "is", null)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit * 3);

  if (importLeadIds) candidateQuery = candidateQuery.in("lead_id", importLeadIds);

  const { data: candidateRows, error: candidateErr } = await candidateQuery;
  if (candidateErr) throw new Error(candidateErr.message);

  const candidates = ((candidateRows ?? []) as CandidateLead[])
    .filter((lead) => isDue(lead.next_action_at))
    .sort(sortCandidates)
    .slice(0, limit);

  const callerIds = callers.map((caller) => caller.user_id);
  const { data: workloadRows, error: workloadErr } = await sb
    .from("leads_view")
    .select("lead_id,assigned_to")
    .in("assigned_to", callerIds)
    .in("status", [...CALLABLE_STATUSES])
    .not("best_phone", "is", null)
    .limit(10000);
  if (workloadErr) throw new Error(workloadErr.message);

  const loads = new Map(callers.map((caller) => [caller.user_id, 0]));
  for (const row of (workloadRows ?? []) as Array<{ assigned_to: string | null }>) {
    if (!row.assigned_to) continue;
    loads.set(row.assigned_to, (loads.get(row.assigned_to) ?? 0) + 1);
  }
  const startingLoads = new Map(loads);
  const assignedByCaller = new Map(callers.map((caller) => [caller.user_id, [] as string[]]));

  for (const lead of candidates) {
    const caller = callers.reduce((best, current) => {
      const bestLoad = loads.get(best.user_id) ?? 0;
      const currentLoad = loads.get(current.user_id) ?? 0;
      return currentLoad < bestLoad ? current : best;
    }, callers[0]);
    assignedByCaller.get(caller.user_id)?.push(lead.lead_id);
    loads.set(caller.user_id, (loads.get(caller.user_id) ?? 0) + 1);
  }

  for (const [callerId, leadIds] of assignedByCaller) {
    if (leadIds.length === 0) continue;
    const { error: updateErr } = await sb
      .from("leads")
      .update({ assigned_to: callerId })
      .in("id", leadIds);
    if (updateErr) throw new Error(updateErr.message);

    await sb.from("lead_assignments").insert(
      leadIds.map((lead_id) => ({
        lead_id,
        assigned_to: callerId,
        assigned_by: opts.assignedBy,
      })),
    );
  }

  const result: AutoAssignResult = {
    assigned: candidates.length,
    candidates: ((candidateRows ?? []) as CandidateLead[]).filter((lead) => isDue(lead.next_action_at)).length,
    callers: callers.map((caller) => {
      const assigned = assignedByCaller.get(caller.user_id)?.length ?? 0;
      const startingLoad = startingLoads.get(caller.user_id) ?? 0;
      return {
        userId: caller.user_id,
        name: caller.display_name ?? "Caller",
        startingLoad,
        assigned,
        endingLoad: startingLoad + assigned,
      };
    }),
  };

  await sb.from("automation_events").insert({
    source: "web_app",
    event_type: "leads_auto_assigned",
    status: "success",
    related_import_id: opts.importJobId ?? null,
    triggered_by: opts.assignedBy,
    payload: { importJobId: opts.importJobId ?? null, limit },
    result,
  });

  return result;
}
