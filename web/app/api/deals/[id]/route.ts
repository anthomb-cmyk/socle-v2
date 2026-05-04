// GET    /api/deals/[id]  — full deal + documents
// PATCH  /api/deals/[id]  — update fields, stage, checklist items
// DELETE /api/deals/[id]  — admin only

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const VALID_STAGES = ["prospection","analyse","offre","due_diligence","financement","cloture","abandonne"] as const;

const Patch = z.object({
  title:         z.string().min(1).max(300).optional(),
  stage:         z.enum(VALID_STAGES).optional(),
  address:       z.string().nullable().optional(),
  units:         z.number().int().positive().nullable().optional(),
  asking_price:  z.number().int().positive().nullable().optional(),
  offer_price:   z.number().int().positive().nullable().optional(),
  temperature:   z.enum(["froid","tiede","chaud"]).optional(),
  priority:      z.enum(["low","medium","high"]).optional(),
  contact_name:  z.string().nullable().optional(),
  contact_phone: z.string().nullable().optional(),
  contact_email: z.string().nullable().optional(),
  notes_deal:    z.string().nullable().optional(),
  notes_vendeur: z.string().nullable().optional(),
  ai_analysis:   z.string().nullable().optional(),
  next_action:   z.string().nullable().optional(),
  // Checklist update: { stage: [{id, label, done}] }
  checklists:    z.record(z.array(z.object({ id: z.string(), label: z.string(), done: z.boolean() }))).optional(),
  // Single activity to prepend: { text: "..." }
  addActivity:   z.object({ text: z.string().min(1).max(500) }).optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const sb = createSupabaseAdminClient();

  const [{ data: deal }, { data: docs }] = await Promise.all([
    sb.from("deals").select("*").eq("id", id).single(),
    sb.from("deal_documents").select("*").eq("deal_id", id).order("created_at", { ascending: false }),
  ]);

  if (!deal) return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });

  return NextResponse.json({ ok: true, data: { deal, documents: docs ?? [] } });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await ctx.params;

  let body;
  try { body = Patch.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const { addActivity, checklists, ...rest } = body;
  const update: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() };

  // If checklists provided, merge with existing
  const sb = createSupabaseAdminClient();

  if (checklists !== undefined) {
    const { data: existing } = await sb.from("deals").select("checklists").eq("id", id).single();
    const merged = { ...(existing?.checklists ?? {}), ...checklists };
    update.checklists = merged;
  }

  // If addActivity provided, prepend to activities array
  if (addActivity) {
    const { data: existing } = await sb.from("deals").select("activities").eq("id", id).single();
    const prev = Array.isArray(existing?.activities) ? existing.activities : [];
    const newEntry = { id: crypto.randomUUID(), text: addActivity.text, time: new Date().toISOString(), by: user.id };
    update.activities = [newEntry, ...prev];
  }

  const { error } = await sb.from("deals").update(update).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const sb = createSupabaseAdminClient();

  const { error } = await sb.from("deals").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
