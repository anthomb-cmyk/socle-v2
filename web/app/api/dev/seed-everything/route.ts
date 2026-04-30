// POST /api/dev/seed-everything — admin-only.
// Runs the full seed chain: caller → leads → follow-ups+review → submission
// → proposed_action. Returns an array of step results.
//
// Body (optional): { city?: string, leadCount?: number, callerEmail?: string }

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { sendTelegramAlert } from "@/lib/telegram";

const Body = z.object({
  city: z.string().optional(),
  leadCount: z.number().int().min(1).max(50).optional(),
  callerEmail: z.string().email().optional(),
}).optional();

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof Body> | undefined;
  try { body = Body.parse(await request.json().catch(() => ({}))); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const city = body?.city ?? "Granby";
  const leadCount = body?.leadCount ?? 10;
  const callerEmail = body?.callerEmail ?? "gaylord+seed@socleacquisitions.com";
  const sb = createSupabaseAdminClient();
  const stamp = Date.now();

  type StepResult = { step: string; ok: boolean; data?: unknown; error?: string };
  const results: StepResult[] = [];

  // ─── 1. Caller user ────────────────────────────────────────────────────
  let callerId: string | null = null;
  try {
    const create = await sb.auth.admin.createUser({
      email: callerEmail, email_confirm: true,
      user_metadata: { display_name: "Gaylord (seed)" },
      app_metadata: { role: "cold_caller" },
    });
    if (create.data?.user) callerId = create.data.user.id;
    else {
      const list = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = list.data?.users?.find((u: { email?: string }) => u.email === callerEmail);
      callerId = existing?.id ?? null;
    }
    if (callerId) {
      await sb.from("users_meta").upsert({
        user_id: callerId, display_name: "Gaylord (seed)", role: "cold_caller",
        email: callerEmail, is_active: true,
      });
      await sb.auth.admin.updateUserById(callerId, { app_metadata: { role: "cold_caller" } });
    }
    results.push({ step: "caller", ok: !!callerId, data: { userId: callerId, email: callerEmail } });
  } catch (err) {
    results.push({ step: "caller", ok: false, error: (err as Error).message });
  }

  // ─── 2. Campaign + N leads (assigned to caller) ────────────────────────
  const camp = await sb.from("campaigns")
    .insert({ name: `Seed ${city} ${stamp}`, city, source: "dev_seed", created_by: auth.user.id })
    .select("id").single();
  const campaignId = (camp.data as { id: string } | null)?.id ?? null;
  results.push({ step: "campaign", ok: !!campaignId, data: { campaignId } });

  const leadIds: string[] = [];
  if (campaignId) {
    const FAKE = [
      { kind: "person", name: "TREMBLAY, JEAN", first: "Jean", last: "Tremblay" },
      { kind: "company", name: "Gestion CML inc." },
      { kind: "person", name: "GAGNON, MARIE", first: "Marie", last: "Gagnon" },
      { kind: "company", name: "Immeubles Boivin SENC" },
      { kind: "person", name: "ROY, PIERRE", first: "Pierre", last: "Roy" },
      { kind: "company", name: "9999-9999 Québec inc." },
    ];
    for (let i = 0; i < leadCount; i++) {
      const owner = FAKE[i % FAKE.length];
      const propRes = await sb.from("properties").insert({
        address: `${100 + i * 13} rue Notre-Dame`, city, province: "QC",
        matricule: `seed-${stamp}-${i.toString().padStart(3, "0")}`,
        num_units: 4 + (i % 8), source: "dev_seed",
      }).select("id").single();
      const propId = (propRes.data as { id: string } | null)?.id;
      if (!propId) continue;
      const ctRes = await sb.from("contacts").insert({
        kind: owner.kind, full_name: owner.name,
        first_name: owner.first ?? null, last_name: owner.last ?? null,
        company_name: owner.kind === "company" ? owner.name : null,
        mailing_city: city, source: "dev_seed",
      }).select("id").single();
      const contactId = (ctRes.data as { id: string } | null)?.id;
      if (!contactId) continue;
      await sb.from("property_contacts").insert({ property_id: propId, contact_id: contactId, relationship: "owner", share_pct: 100 });
      const area = String(Math.floor(Math.random() * 800) + 200).padStart(3, "0");
      const ex = String(Math.floor(Math.random() * 800) + 200).padStart(3, "0");
      const sub = String(Math.floor(Math.random() * 9000) + 1000);
      const e164 = `+1${area}${ex}${sub}`;
      await sb.from("phones").insert({
        contact_id: contactId, e164, display: `(${area}) ${ex}-${sub}`,
        status: "unverified", source: "manual", confidence: 70, evidence: "seed",
      });
      const leadRes = await sb.from("leads").insert({
        campaign_id: campaignId, property_id: propId, contact_id: contactId,
        status: "new", priority: 50 + (i % 50), assigned_to: callerId, source: "dev_seed",
      }).select("id").single();
      const leadId = (leadRes.data as { id: string } | null)?.id;
      if (leadId) leadIds.push(leadId);
    }
  }
  results.push({ step: "leads", ok: leadIds.length > 0, data: { count: leadIds.length, leadIds: leadIds.slice(0, 3) } });

  // ─── 3. Three follow-ups (overdue / today / +1d) ───────────────────────
  if (leadIds.length >= 3 && callerId) {
    const now = Date.now();
    await sb.from("follow_ups").insert([
      { lead_id: leadIds[0], due_at: new Date(now - 86400_000).toISOString(), note: "Seed: overdue follow-up", priority: 80, status: "pending", assigned_to: callerId, created_by: auth.user.id, source: "dev_seed" },
      { lead_id: leadIds[1], due_at: new Date(now + 3_600_000).toISOString(), note: "Seed: today follow-up", priority: 70, status: "pending", assigned_to: callerId, created_by: auth.user.id, source: "dev_seed" },
      { lead_id: leadIds[2], due_at: new Date(now + 86400_000).toISOString(), note: "Seed: tomorrow follow-up", priority: 60, status: "pending", assigned_to: callerId, created_by: auth.user.id, source: "dev_seed" },
    ]);
    results.push({ step: "follow_ups", ok: true, data: { count: 3 } });
  } else {
    results.push({ step: "follow_ups", ok: false, error: "not enough leads or no caller" });
  }

  // ─── 4. Hot-seller submission on lead 0 ────────────────────────────────
  if (leadIds.length > 0 && callerId) {
    const callRes = await sb.from("call_logs").insert({
      lead_id: leadIds[0], user_id: callerId,
      direction: "outbound", duration_sec: 240, outcome: "hot_seller",
      notes: "Seed: hot seller, wants offer in 30 days.",
      recorded_at: new Date().toISOString(),
    }).select("id").single();
    const callId = (callRes.data as { id: string } | null)?.id;

    const subRes = await sb.from("lead_submissions").insert({
      lead_id: leadIds[0], call_log_id: callId ?? null, submitted_by: callerId,
      outcome: "hot_seller", seller_interest_level: "hot", timeline: "3_months",
      motivation: "Mortgage maturity in 3 months", asking_price: 1_600_000,
      caller_summary: "Owner is open to selling. Wants offer this month. Mortgage maturity is the trigger.",
      status: "pending",
    }).select("id").single();
    const subId = (subRes.data as { id: string } | null)?.id;

    if (subId) {
      await sb.from("review_items").insert({
        source_kind: "lead_submission", source_id: subId, lead_id: leadIds[0],
        title: "Seed → hot seller submission", summary: "Open to selling — wants offer in 30 days.",
        urgency: "urgent", status: "open",
      });
      await sendTelegramAlert(
`🔥 *Seed hot seller* — review queue
*Property:* lead ${leadIds[0]}
*Asking:* $1,600,000 · timeline: 3 months
Open to selling — wants offer in 30 days.`,
      );
    }
    results.push({ step: "submission", ok: !!subId, data: { submissionId: subId } });
  } else {
    results.push({ step: "submission", ok: false, error: "no leads or no caller" });
  }

  // ─── 5. Proposed action on the most recent lead ────────────────────────
  if (leadIds.length > 0) {
    const paRes = await sb.from("proposed_actions").insert({
      action_type: "append_note", target_table: "leads", target_id: leadIds[leadIds.length - 1],
      proposed_change: { append: "Owner mentioned a sister property in Granby — possible second deal." },
      rationale: "Seeded: simulates a Telegram note awaiting confirmation.",
      confidence: 65, status: "pending", source: "telegram",
    }).select("id").single();
    results.push({ step: "proposed_action", ok: !!paRes.data, data: paRes.data });
  } else {
    results.push({ step: "proposed_action", ok: false, error: "no leads" });
  }

  // ─── 6. Audit ──────────────────────────────────────────────────────────
  await sb.from("automation_events").insert({
    source: "system", event_type: "seed_everything", status: "success",
    triggered_by: auth.user.id,
    payload: { city, leadCount, callerEmail, campaignId },
    result: { steps: results.map(r => ({ step: r.step, ok: r.ok })) },
  });

  return NextResponse.json({ ok: true, data: { results, callerId, campaignId, leadIds } });
}
