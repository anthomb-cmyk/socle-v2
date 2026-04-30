// POST /api/follow-ups/sync-batch — n8n efficient batch update.
//
// Body: { items: Array<{
//   id: uuid,
//   sync_status: "syncing" | "synced" | "error" | "disabled",
//   sync_target?: "none" | "gcal" | "gtask" | "both",
//   gcal_event_id?: string | null,
//   gcal_calendar_id?: string | null,
//   gtask_id?: string | null,
//   gtask_list_id?: string | null,
//   sync_error?: string | null
// }>, n8n_execution_id?: string }
//
// Per-item updates are independent; failures don't abort the batch.
// Returns per-item status array.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const Item = z.object({
  id: z.string().uuid(),
  sync_status: z.enum(["unsynced", "syncing", "synced", "error", "disabled"]),
  sync_target: z.enum(["none", "gcal", "gtask", "both"]).optional(),
  gcal_event_id: z.string().nullable().optional(),
  gcal_calendar_id: z.string().nullable().optional(),
  gtask_id: z.string().nullable().optional(),
  gtask_list_id: z.string().nullable().optional(),
  sync_error: z.string().nullable().optional(),
});
const Body = z.object({
  items: z.array(Item).min(1).max(500),
  n8n_execution_id: z.string().optional(),
});

export async function POST(request: Request) {
  // n8n bearer auth
  const expected = process.env.N8N_SHARED_KEY;
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (expected) {
    if (provided !== expected) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "N8N_SHARED_KEY not configured" }, { status: 500 });
  }

  let body;
  try { body = Body.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const sb = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const item of body.items) {
    const update: Record<string, unknown> = {
      sync_status: item.sync_status,
      last_synced_at: now,
    };
    if (item.sync_target !== undefined) update.sync_target = item.sync_target;
    if (item.gcal_event_id !== undefined) update.gcal_event_id = item.gcal_event_id;
    if (item.gcal_calendar_id !== undefined) update.gcal_calendar_id = item.gcal_calendar_id;
    if (item.gtask_id !== undefined) update.gtask_id = item.gtask_id;
    if (item.gtask_list_id !== undefined) update.gtask_list_id = item.gtask_list_id;
    if (item.sync_status === "synced") update.sync_error = null;
    else if (item.sync_error !== undefined) update.sync_error = item.sync_error;

    const { error } = await sb.from("follow_ups").update(update).eq("id", item.id);
    if (error) results.push({ id: item.id, ok: false, error: error.message });
    else results.push({ id: item.id, ok: true });
  }

  const failures = results.filter(r => !r.ok).length;
  await sb.from("automation_events").insert({
    source: "n8n",
    event_type: "follow_up_sync_batch",
    status: failures === 0 ? "success" : "partial",
    payload: { count: body.items.length, failures, n8n_execution_id: body.n8n_execution_id ?? null },
    result: { results },
    n8n_execution_id: body.n8n_execution_id ?? null,
  });

  return NextResponse.json({ ok: true, data: { count: body.items.length, failures, results } });
}
