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
//   • any lead sharing the same contact_id as the current lead (same owner, different property)
//
// Deduplication:
//   • Within the batch, only the first (best-ranked) lead per contact_id is returned.
//     This ensures a contact who owns N properties is called only once per round.

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

  // ── 2. Resolve the current lead's contact_id (to skip same-owner leads) ──
  let afterContactId: string | null = null;
  if (after) {
    const { data: cur } = await sb
      .from("leads_view")
      .select("contact_id")
      .eq("lead_id", after)
      .maybeSingle();
    afterContactId = (cur as { contact_id: string | null } | null)?.contact_id ?? null;
  }

  // ── 3. Fetch a larger batch (include contact_id for deduplication) ───────
  // We fetch enough rows to survive locks + contact duplicates in JS,
  // avoiding TypeScript issues with deeply chained Supabase builders.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = sb
    .from("leads_view")
    .select("lead_id, contact_id")
    .in("status", CALLABLE_STATUSES)
    .not("best_phone", "is", null)
    .or(`next_action_at.is.null,next_action_at.lte.${now}`)
    .order("priority", { ascending: false })
    .order("next_action_at", { ascending: true, nullsFirst: false })
    .order("last_contacted_at", { ascending: true, nullsFirst: true });

  if (role === "caller") q = q.eq("assigned_to", user.id);
  if (after) q = q.neq("lead_id", after);

  // Fetch a bigger batch to absorb locked + contact-duplicate removals
  const batchSize = Math.max(50, lockedByOthers.length * 2 + 10);
  const { data: candidates, error } = await q.limit(batchSize);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const lockedSet   = new Set(lockedByOthers);
  const seenContact = new Set<string>();

  // Pre-seed with the current lead's contact so we skip their other properties
  if (afterContactId) seenContact.add(afterContactId);

  type Row = { lead_id: string; contact_id: string | null };
  const rows = (candidates ?? []) as Row[];

  let nextLeadId: string | null = null;
  for (const r of rows) {
    if (lockedSet.has(r.lead_id)) continue;            // locked by another caller
    if (r.contact_id && seenContact.has(r.contact_id)) continue; // same owner already queued
    // ✓ valid candidate
    nextLeadId = r.lead_id;
    break;
  }

  return NextResponse.json({ ok: true, data: { nextLeadId } });
}
