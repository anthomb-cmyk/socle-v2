import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const Body = z.object({
  recipientId: z.string().uuid(),
  outcome: z.string().min(1).max(80),
  notes: z.string().max(5000).optional().nullable(),
  nextAction: z.string().max(500).optional().nullable(),
  followUpAt: z.string().datetime().optional().nullable(),
});

const STATUS_BY_OUTCOME: Record<string, string> = {
  called_back: "called_back",
  interested: "interested",
  wants_offer: "interested",
  meeting_booked: "interested",
  maybe_later: "maybe_later",
  not_interested: "not_interested",
  wrong_person: "wrong_person",
  bad_address: "bad_address",
  do_not_contact: "do_not_contact",
  deal_created: "deal_created",
};

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();
  const body = parsed.data;
  const { data: interaction, error } = await sb
    .from("letter_interactions")
    .insert({
      recipient_id: body.recipientId,
      outcome: body.outcome,
      notes: body.notes ?? null,
      next_action: body.nextAction ?? null,
      follow_up_at: body.followUpAt ?? null,
      created_by: auth.user.id,
    })
    .select("id,recipient_id,outcome,notes,next_action,follow_up_at,created_at")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const status = STATUS_BY_OUTCOME[body.outcome] ?? "called_back";
  const update = await sb
    .from("letter_recipients")
    .update({
      status,
      last_outcome: body.outcome,
      last_interaction_at: new Date().toISOString(),
    })
    .eq("id", body.recipientId);

  if (update.error) {
    return NextResponse.json({ ok: false, error: update.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: { interaction, status } });
}
