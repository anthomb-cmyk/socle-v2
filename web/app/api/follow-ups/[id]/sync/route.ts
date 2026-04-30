// POST /api/follow-ups/[id]/sync — n8n calls this to write back sync state
// after attempting Google Calendar / Google Tasks sync.
//
// Auth: Bearer ${N8N_SHARED_KEY}.
//
// Body: {
//   sync_status: "syncing" | "synced" | "error" | "disabled",
//   sync_target?: "gcal" | "gtask" | "both" | "none",
//   gcal_event_id?: string,
//   gcal_calendar_id?: string,
//   gtask_id?: string,
//   gtask_list_id?: string,
//   sync_error?: string | null,
//   n8n_execution_id?: string
// }
//
// Always logs an automation_event with source='n8n', event_type='follow_up_synced'.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const Body = z.object({
  sync_status: z.enum(["unsynced", "syncing", "synced", "error", "disabled"]),
  sync_target: z.enum(["none", "gcal", "gtask", "both"]).optional(),
  gcal_event_id: z.string().nullable().optional(),
  gcal_calendar_id: z.string().nullable().optional(),
  gtask_id: z.string().nullable().optional(),
  gtask_list_id: z.string().nullable().optional(),
  sync_error: z.string().nullable().optional(),
  n8n_execution_id: z.string().optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  // Auth (n8n bearer)
  const expected = process.env.N8N_SHARED_KEY;
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (expected) {
    if (provided !== expected) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "N8N_SHARED_KEY not configured" }, { status: 500 });
  }

  const { id } = await ctx.params;
  let body;
  try { body = Body.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const sb = createSupabaseAdminClient();

  // Fetch first so we can include lead_id in the audit row
  const { data: existing } = await sb.from("follow_ups").select("lead_id").eq("id", id).single();
  if (!existing) return NextResponse.json({ ok: false, error: "Follow-up not found" }, { status: 404 });

  const update: Record<string, unknown> = {
    sync_status: body.sync_status,
    last_synced_at: new Date().toISOString(),
  };
  if (body.sync_target !== undefined) update.sync_target = body.sync_target;
  if (body.gcal_event_id !== undefined) update.gcal_event_id = body.gcal_event_id;
  if (body.gcal_calendar_id !== undefined) update.gcal_calendar_id = body.gcal_calendar_id;
  if (body.gtask_id !== undefined) update.gtask_id = body.gtask_id;
  if (body.gtask_list_id !== undefined) update.gtask_list_id = body.gtask_list_id;
  // Clear error on success; preserve when not provided
  if (body.sync_status === "synced") update.sync_error = null;
  else if (body.sync_error !== undefined) update.sync_error = body.sync_error;

  const { error } = await sb.from("follow_ups").update(update).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await sb.from("automation_events").insert({
    source: "n8n",
    event_type: "follow_up_synced",
    status: body.sync_status === "error" ? "failed" : "success",
    related_lead_id: (existing as { lead_id: string | null }).lead_id,
    payload: { followUpId: id, ...body },
    error_message: body.sync_error ?? null,
    n8n_execution_id: body.n8n_execution_id ?? null,
  });

  return NextResponse.json({ ok: true });
}
