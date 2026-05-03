// GET /api/enrichment-jobs/[id] — fetch a single job (admin).
// PATCH /api/enrichment-jobs/[id] — update status/error/result (admin OR n8n bearer).

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const Patch = z.object({
  // Must match the DB enum job_status: pending|preview|confirmed|processing|completed|failed|cancelled
  status: z.enum(["pending", "preview", "confirmed", "processing", "completed", "failed", "cancelled"]).optional(),
  error_message: z.string().nullable().optional(),
  raw_output: z.unknown().optional(),
  cost_usd: z.number().nonnegative().optional(),
  workflow_run_id: z.string().optional(),
});

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const sb = createSupabaseAdminClient();
  const { data, error } = await sb.from("enrichment_jobs").select("*").eq("id", id).single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
  return NextResponse.json({ ok: true, data });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  // Two auth modes: admin session OR n8n bearer
  const expected = process.env.N8N_SHARED_KEY;
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  let isN8N = false;
  if (expected && provided === expected) {
    isN8N = true;
  } else {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
  }

  const { id } = await ctx.params;
  let body;
  try { body = Patch.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const update: Record<string, unknown> = {};
  if (body.status !== undefined) {
    update.status = body.status;
    if (body.status === "processing" && !update.started_at) update.started_at = new Date().toISOString();
    if (["completed", "failed", "cancelled"].includes(body.status)) update.completed_at = new Date().toISOString();
  }
  if (body.error_message !== undefined) update.error_message = body.error_message;
  if (body.raw_output !== undefined) update.raw_output = body.raw_output;
  if (body.cost_usd !== undefined) update.cost_usd = body.cost_usd;
  if (body.workflow_run_id !== undefined) update.workflow_run_id = body.workflow_run_id;

  const sb = createSupabaseAdminClient();
  const { error } = await sb.from("enrichment_jobs").update(update).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await sb.from("automation_events").insert({
    source: isN8N ? "n8n" : "web_app",
    event_type: "enrichment_job_updated",
    status: body.status === "failed" ? "failed" : "success",
    payload: { jobId: id, changes: body },
    error_message: body.error_message ?? null,
  });

  return NextResponse.json({ ok: true });
}
