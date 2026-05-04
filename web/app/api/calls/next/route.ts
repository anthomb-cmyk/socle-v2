// GET /api/calls/next?afterLeadId=
// Returns the next lead to call from the user's queue (or null if empty).
//
// Ordering (most urgent first within same priority):
//   1. priority DESC
//   2. next_action_at ASC NULLS LAST  (overdue callbacks before fresh leads)
//   3. last_contacted_at ASC NULLS FIRST  (least-recently-contacted first)
//
// Exclusions:
//   • leads where next_action_at > now()  (not ready yet — caller scheduled them for later)
//   • leads with an active call_lock held by a different caller
//   • the current lead (afterLeadId)

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const CALLABLE_STATUSES = [
  "new", "ready_to_call", "in_outreach", "no_answer", "phone_verified",
];

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, role } = auth;

  const url = new URL(request.url);
  const after = url.searchParams.get("afterLeadId");
  const now = new Date().toISOString();

  const sb = createSupabaseAdminClient();

  // ── 1. Fetch lead IDs that are actively locked by someone else ──────────
  const { data: locks } = await sb
    .from("call_locks")
    .select("lead_id, locked_by")
    .gt("expires_at", now);

  const lockedByOthers = (locks ?? [])
    .filter((l) => l.locked_by !== user.id)
    .map((l) => l.lead_id as string);

  // ── 2. Fetch candidates (small batch, filter locks in JS) ──────────────
  // Fetching a small batch and filtering in JS avoids TypeScript generic-depth
  // issues with deeply chained Supabase query builders.
  // In practice the lock set is tiny (< 10 callers), so this is fine.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = sb
    .from("leads_view")
    .select("lead_id")
    .in("status", CALLABLE_STATUSES)
    .not("best_phone", "is", null)
    .or(`next_action_at.is.null,next_action_at.lte.${now}`)
    .order("priority", { ascending: false })
    .order("next_action_at", { ascending: true, nullsFirst: false })
    .order("last_contacted_at", { ascending: true, nullsFirst: true });

  if (role === "caller") q = q.eq("assigned_to", user.id);
  if (after) q = q.neq("lead_id", after);

  // Fetch a small batch so we can filter locked leads in JS
  const batchSize = Math.max(10, lockedByOthers.length + 3);
  const { data: candidates, error } = await q.limit(batchSize);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const lockedSet = new Set(lockedByOthers);
  const rows = (candidates ?? []) as { lead_id: string }[];
  const next = rows.find((r) => !lockedSet.has(r.lead_id))?.lead_id ?? null;

  return NextResponse.json({ ok: true, data: { nextLeadId: next } });
}
