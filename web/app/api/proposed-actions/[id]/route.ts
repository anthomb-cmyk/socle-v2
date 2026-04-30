// POST /api/proposed-actions/[id]
// Body: { action: "approve" | "reject" }
//
// On approve: applies the proposed_change based on action_type, updates the
// row to status='accepted'. On reject: status='rejected' (no application).

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const Body = z.object({ action: z.enum(["approve", "reject"]) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const { id } = await ctx.params;

  let body;
  try { body = Body.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const sb = createSupabaseAdminClient();
  const { data: pa } = await sb.from("proposed_actions").select("*").eq("id", id).single();
  const proposed = pa as {
    id: string; action_type: string; target_table: string; target_id: string | null;
    proposed_change: Record<string, unknown>; status: string;
  } | null;
  if (!proposed) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  if (proposed.status !== "pending") return NextResponse.json({ ok: false, error: `Already ${proposed.status}` }, { status: 409 });

  if (body.action === "reject") {
    await sb.from("proposed_actions").update({
      status: "rejected", reviewed_by: user.id, reviewed_at: new Date().toISOString(),
    }).eq("id", id);
    await sb.from("automation_events").insert({
      source: "web_app", event_type: "proposed_action_rejected", status: "success",
      triggered_by: user.id, payload: { proposedActionId: id, action_type: proposed.action_type },
    });
    return NextResponse.json({ ok: true, action: "rejected" });
  }

  // Approve = apply
  let appliedResult: unknown = null;
  let applyError: string | null = null;

  if (proposed.action_type === "append_note" && proposed.target_table === "leads" && proposed.target_id) {
    const append = String((proposed.proposed_change as { append?: string }).append ?? "");
    const { data: lead } = await sb.from("leads").select("notes").eq("id", proposed.target_id).single();
    const existing = (lead as { notes: string | null } | null)?.notes ?? "";
    const next = existing
      ? `${existing}\n\n[via Telegram, ${new Date().toLocaleDateString()}]\n${append}`
      : `[via Telegram, ${new Date().toLocaleDateString()}]\n${append}`;
    const { error } = await sb.from("leads").update({ notes: next }).eq("id", proposed.target_id);
    if (error) applyError = error.message;
    else appliedResult = { appended: true, length: next.length };
  } else {
    applyError = `Unknown action_type "${proposed.action_type}" or target — cannot apply automatically`;
  }

  await sb.from("proposed_actions").update({
    status: applyError ? "pending" : "accepted",
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
    applied_at: applyError ? null : new Date().toISOString(),
    applied_result: applyError ? { error: applyError } : appliedResult,
  }).eq("id", id);

  await sb.from("automation_events").insert({
    source: "web_app",
    event_type: applyError ? "proposed_action_apply_failed" : "proposed_action_accepted",
    status: applyError ? "failed" : "success",
    triggered_by: user.id,
    related_lead_id: proposed.target_table === "leads" ? proposed.target_id : null,
    error_message: applyError,
    payload: { proposedActionId: id, action_type: proposed.action_type },
    result: appliedResult,
  });

  if (applyError) return NextResponse.json({ ok: false, error: applyError }, { status: 500 });
  return NextResponse.json({ ok: true, action: "accepted", applied: appliedResult });
}
