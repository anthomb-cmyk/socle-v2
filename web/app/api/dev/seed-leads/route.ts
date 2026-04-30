// POST /api/dev/seed-leads — admin-only.
// Creates N fake (property, contact, phone, lead) tuples. Optionally assigns
// them to a caller user. Optionally creates a follow-up.
//
// Body: { count?: number, city?: string, assignToUserId?: string,
//         createFollowUps?: boolean, createReviewItem?: boolean }

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const Body = z.object({
  count: z.number().int().min(1).max(50).optional(),
  city: z.string().optional(),
  assignToUserId: z.string().uuid().optional(),
  createFollowUps: z.boolean().optional(),
  createReviewItem: z.boolean().optional(),
}).optional();

const FAKE_OWNERS: Array<{ kind: "person" | "company"; name: string; first?: string; last?: string }> = [
  { kind: "person", name: "TREMBLAY, JEAN", first: "Jean", last: "Tremblay" },
  { kind: "person", name: "GAGNON, MARIE", first: "Marie", last: "Gagnon" },
  { kind: "company", name: "Gestion CML inc." },
  { kind: "person", name: "ROY, PIERRE", first: "Pierre", last: "Roy" },
  { kind: "company", name: "Immeubles Boivin SENC" },
  { kind: "person", name: "CHOINIÈRE, SOPHIE", first: "Sophie", last: "Choinière" },
  { kind: "company", name: "9999-9999 Québec inc." },
  { kind: "person", name: "BOUCHARD, LUC", first: "Luc", last: "Bouchard" },
];

const STREETS = ["rue Notre-Dame", "boul. Industriel", "avenue du Parc", "rue Sherbrooke", "rue Principale", "rue de l'Église"];

function pick<T>(arr: T[], i: number): T { return arr[i % arr.length]; }
function randomPhone(): string {
  const area = String(Math.floor(Math.random() * 800) + 200).padStart(3, "0");
  const exch = String(Math.floor(Math.random() * 800) + 200).padStart(3, "0");
  const sub = String(Math.floor(Math.random() * 9000) + 1000);
  return `+1${area}${exch}${sub}`;
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof Body> | undefined;
  try { body = Body.parse(await request.json().catch(() => ({}))); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const count = body?.count ?? 10;
  const city = body?.city ?? "Granby";
  const assignTo = body?.assignToUserId ?? null;

  const sb = createSupabaseAdminClient();
  const stamp = Date.now();

  // Campaign
  const { data: camp, error: campErr } = await sb.from("campaigns")
    .insert({ name: `Seed ${city} ${stamp}`, city, source: "dev_seed", created_by: auth.user.id })
    .select("id").single();
  if (campErr) return NextResponse.json({ ok: false, error: `campaign: ${campErr.message}` }, { status: 500 });
  const campaignId = (camp as { id: string }).id;

  const created = { properties: 0, contacts: 0, phones: 0, leads: 0, followUps: 0, reviewItems: 0 };
  const leadIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const ownerSpec = pick(FAKE_OWNERS, i);
    const street = pick(STREETS, i);
    const num = 100 + i * 13;

    const { data: prop } = await sb.from("properties").insert({
      address: `${num} ${street}`, city, province: "QC",
      matricule: `seed-${stamp}-${i.toString().padStart(3, "0")}`,
      num_units: 4 + (i % 8),
      year_built: 1960 + (i * 3) % 60,
      evaluation_total: 600_000 + i * 75_000,
      source: "dev_seed",
    }).select("id").single();
    if (!prop) continue;
    created.properties++;

    const { data: contact } = await sb.from("contacts").insert({
      kind: ownerSpec.kind,
      first_name: ownerSpec.first ?? null,
      last_name: ownerSpec.last ?? null,
      full_name: ownerSpec.name,
      company_name: ownerSpec.kind === "company" ? ownerSpec.name : null,
      mailing_city: city,
      source: "dev_seed",
    }).select("id").single();
    if (!contact) continue;
    created.contacts++;

    const propId = (prop as { id: string }).id;
    const contactId = (contact as { id: string }).id;

    await sb.from("property_contacts").insert({
      property_id: propId, contact_id: contactId, relationship: "owner", share_pct: 100,
    });

    const e164 = randomPhone();
    await sb.from("phones").insert({
      contact_id: contactId,
      e164,
      display: `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`,
      status: "unverified",
      source: "manual",
      confidence: 70,
      evidence: "seed",
    });
    created.phones++;

    const { data: lead } = await sb.from("leads").insert({
      campaign_id: campaignId,
      property_id: propId,
      contact_id: contactId,
      status: "new",
      priority: 50 + (i % 50),
      assigned_to: assignTo,
      source: "dev_seed",
    }).select("id").single();
    if (lead) {
      created.leads++;
      leadIds.push((lead as { id: string }).id);
    }
  }

  // Optional follow-ups
  if (body?.createFollowUps && leadIds.length > 0) {
    const now = Date.now();
    const fuRows = leadIds.slice(0, 3).map((leadId, idx) => ({
      lead_id: leadId,
      due_at: new Date(now + (idx - 1) * 86400_000).toISOString(),  // -1d, today, +1d
      note: `Seeded follow-up #${idx + 1}`,
      priority: 70,
      status: "pending" as const,
      assigned_to: assignTo ?? auth.user.id,
      created_by: auth.user.id,
      source: "dev_seed",
    }));
    await sb.from("follow_ups").insert(fuRows);
    created.followUps = fuRows.length;
  }

  // Optional review item
  if (body?.createReviewItem && leadIds.length > 0) {
    await sb.from("review_items").insert({
      source_kind: "manual",
      lead_id: leadIds[0],
      title: `Seed review: ${city}`,
      summary: "Seeded review item — useful for testing the inbox UI.",
      urgency: "high",
      status: "open",
    });
    created.reviewItems = 1;
  }

  await sb.from("automation_events").insert({
    source: "system", event_type: "seed_leads", status: "success",
    triggered_by: auth.user.id,
    payload: { campaignId, count, city, assignTo },
    result: created,
  });

  return NextResponse.json({ ok: true, data: { campaignId, leadIds, created } });
}
