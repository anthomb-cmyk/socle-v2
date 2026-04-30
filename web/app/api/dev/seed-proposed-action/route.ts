// POST /api/dev/seed-proposed-action — admin-only.
// Creates a synthetic proposed_action against the most recently-created lead
// (or a specific leadId if provided in the body). Useful to test the
// review-inbox Approve/Reject flow without needing a Telegram message.
//
// Body (optional): { leadId?: uuid, text?: string }

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const Body = z.object({
  leadId: z.string().uuid().optional(),
  text: z.string().optional(),
}).optional();

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof Body> | undefined;
  try { body = Body.parse(await request.json().catch(() => ({}))); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const sb = createSupabaseAdminClient();

  // Pick a target lead: explicit, else newest
  let leadId = body?.leadId;
  if (!leadId) {
    const { data } = await sb.from("leads").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
    leadId = (data as { id: string } | null)?.id;
  }
  if (!leadId) {
    return NextResponse.json({
      ok: false,
      error: "No leads in database. Run /api/dev/seed-leads first.",
    }, { status: 400 });
  }

  const text = body?.text ??
    "Owner sounded ready. Wants to compare against another offer they got. Best time after 18h. Bonjour from Telegram seed.";

  const { data, error } = await sb.from("proposed_actions").insert({
    action_type: "append_note",
    target_table: "leads",
    target_id: leadId,
    proposed_change: { append: text },
    rationale: "Seeded by /api/dev/seed-proposed-action — simulates a Telegram-originated note awaiting Anthony's confirmation.",
    confidence: 65,
    status: "pending",
    source: "telegram",
  }).select("id").single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await sb.from("automation_events").insert({
    source: "system", event_type: "seed_proposed_action", status: "success",
    related_lead_id: leadId, triggered_by: auth.user.id,
    payload: { proposedActionId: (data as { id: string }).id },
  });

  return NextResponse.json({ ok: true, data: { proposedActionId: (data as { id: string }).id, leadId, text } });
}
