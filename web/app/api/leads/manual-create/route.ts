// POST /api/leads/manual-create — admin-only manual lead creation.
//
// Same shape as /api/n8n/lead but session-authed.
// Supports: property (address, city, postal, matricule, units, year_built, evals),
//           contact  (kind, full_name, company_name, email, mailing, notes),
//           phones   [],
//           secondary_contact (creates a second contact + property_contacts link),
//           lead     (notes, priority, source, campaign_id, assigned_to).
//
// BUG NOTE: contacts table has no primary_phone column — phones are stored in
//           the `phones` table only.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { extractPhonesFromValue, formatDisplay } from "@/lib/role-parser/phone-utils";
import { normalizeCity } from "@/lib/cities";

const ContactInput = z.object({
  kind: z.enum(["person", "company", "numbered_co", "trust", "unknown"]).optional(),
  full_name: z.string().optional(),
  company_name: z.string().optional(),
  primary_email: z.string().email().optional(),
  mailing_address: z.string().optional(),
  mailing_city: z.string().optional(),
  mailing_postal: z.string().optional(),
  notes: z.string().optional(),
});

const Body = z.object({
  property: z.object({
    address: z.string().min(1),
    city: z.string().optional(),
    postal_code: z.string().optional(),
    matricule: z.string().optional(),
    num_units: z.number().int().positive().optional(),
    year_built: z.number().int().min(1800).max(2100).optional(),
    evaluation_total: z.number().nonnegative().optional(),
    evaluation_land: z.number().nonnegative().optional(),
    evaluation_bldg: z.number().nonnegative().optional(),
  }),
  contact: ContactInput,
  secondary_contact: ContactInput.optional(),
  phones: z.array(z.string()).optional(),
  lead: z.object({
    notes: z.string().optional(),
    source: z.string().optional(),
    priority: z.number().int().min(0).max(100).optional(),
    campaign_id: z.string().uuid().optional(),
    assigned_to: z.string().uuid().optional(),
  }).optional(),
});

type ContactShape = z.infer<typeof ContactInput>;

async function upsertContact(
  sb: ReturnType<typeof createSupabaseAdminClient>,
  c: ContactShape,
  source: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // Determine lookup strategy: companies/numbered by company_name, persons by full_name.
  const isCompanyKind = c.kind && c.kind !== "person";
  const lookupField = isCompanyKind && c.company_name ? "company_name"
    : c.full_name ? "full_name"
    : c.company_name ? "company_name"
    : null;
  const lookupVal = lookupField === "company_name" ? c.company_name : c.full_name;
  if (!lookupVal) return { ok: false, error: "contact must have full_name or company_name" };

  const { data: existing } = await sb.from("contacts")
    .select("id")
    .eq(lookupField!, lookupVal)
    .maybeSingle();

  // Build payload — NOTE: no primary_phone column in contacts table
  const payload: Record<string, unknown> = {
    kind: c.kind ?? (c.company_name && !c.full_name ? "company" : "person"),
    full_name: c.full_name ?? null,
    company_name: c.company_name ?? null,
    primary_email: c.primary_email ?? null,
    mailing_address: c.mailing_address ?? null,
    mailing_city: c.mailing_city ? normalizeCity(c.mailing_city) : null,
    mailing_postal: c.mailing_postal ?? null,
    notes: c.notes ?? null,
    source,
  };

  if (existing) {
    // Only overwrite non-null fields to avoid clobbering richer existing data
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v !== null && k !== "source") update[k] = v;
    }
    await sb.from("contacts").update(update).eq("id", (existing as { id: string }).id);
    return { ok: true, id: (existing as { id: string }).id };
  }

  const { data, error } = await sb.from("contacts").insert(payload).select("id").single();
  if (error) return { ok: false, error: `contact: ${error.message}` };
  return { ok: true, id: (data as { id: string }).id };
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body;
  try { body = Body.parse(await request.json()); }
  catch (err) {
    return NextResponse.json(
      { ok: false, error: "Bad input", errors: (err as z.ZodError).issues },
      { status: 400 }
    );
  }

  const sb = createSupabaseAdminClient();
  const cityNorm = normalizeCity(body.property.city);

  // ── 1. Property ──────────────────────────────────────────────────────────
  let propertyId: string | null = null;
  if (body.property.matricule) {
    const { data } = await sb.from("properties")
      .select("id").eq("matricule", body.property.matricule).maybeSingle();
    if (data) propertyId = (data as { id: string }).id;
  }
  if (!propertyId) {
    const q = sb.from("properties").select("id").eq("address", body.property.address);
    if (cityNorm) q.eq("city", cityNorm);
    const { data } = await q.maybeSingle();
    if (data) propertyId = (data as { id: string }).id;
  }

  const propPayload: Record<string, unknown> = {
    address: body.property.address,
    city: cityNorm,
    postal_code: body.property.postal_code ?? null,
    matricule: body.property.matricule ?? null,
    num_units: body.property.num_units ?? null,
    year_built: body.property.year_built ?? null,
    evaluation_total: body.property.evaluation_total ?? null,
    evaluation_land: body.property.evaluation_land ?? null,
    evaluation_bldg: body.property.evaluation_bldg ?? null,
    source: "manual",
  };

  if (propertyId) {
    await sb.from("properties").update(propPayload).eq("id", propertyId);
  } else {
    const { data, error } = await sb.from("properties").insert(propPayload).select("id").single();
    if (error) return NextResponse.json({ ok: false, error: `property: ${error.message}` }, { status: 500 });
    propertyId = (data as { id: string }).id;
  }

  // ── 2. Primary contact ──────────────────────────────────────────────────
  const contactResult = await upsertContact(sb, body.contact, "manual");
  if (!contactResult.ok) return NextResponse.json({ ok: false, error: contactResult.error }, { status: 400 });
  const contactId = contactResult.id;

  await sb.from("property_contacts").upsert(
    { property_id: propertyId, contact_id: contactId, relationship: "owner" },
    { onConflict: "property_id,contact_id,relationship", ignoreDuplicates: true }
  );

  // ── 3. Secondary contact (optional) ────────────────────────────────────
  let secondaryContactId: string | null = null;
  if (body.secondary_contact && (body.secondary_contact.full_name || body.secondary_contact.company_name)) {
    const sec = await upsertContact(sb, body.secondary_contact, "manual");
    if (sec.ok) {
      secondaryContactId = sec.id;
      await sb.from("property_contacts").upsert(
        { property_id: propertyId, contact_id: sec.id, relationship: "co_owner" },
        { onConflict: "property_id,contact_id,relationship", ignoreDuplicates: true }
      );
    }
  }

  // ── 4. Phones ───────────────────────────────────────────────────────────
  const phones = new Set<string>();
  for (const p of body.phones ?? []) extractPhonesFromValue(p).forEach(e => phones.add(e));

  for (const e164 of phones) {
    await sb.from("phones").upsert({
      contact_id: contactId,
      e164,
      display: formatDisplay(e164),
      status: "unverified",
      source: "manual",
      confidence: 80,
      evidence: "manual entry via /leads/new",
    }, { onConflict: "contact_id,e164", ignoreDuplicates: true });
  }

  // ── 5. Lead ─────────────────────────────────────────────────────────────
  // Unique constraint is (campaign_id, property_id, contact_id) — null campaign_id is fine.
  const { data: existingLead } = await sb.from("leads")
    .select("id")
    .eq("property_id", propertyId)
    .eq("contact_id", contactId)
    .maybeSingle();

  let leadId: string;
  const leadInsert: Record<string, unknown> = {
    property_id: propertyId,
    contact_id: contactId,
    campaign_id: body.lead?.campaign_id ?? null,
    assigned_to: body.lead?.assigned_to ?? null,
    status: "new",
    priority: body.lead?.priority ?? 50,
    notes: body.lead?.notes ?? null,
    source: body.lead?.source ?? "manual",
  };

  if (existingLead) {
    leadId = (existingLead as { id: string }).id;
    // Update mutable fields but don't regress status/priority
    await sb.from("leads").update({
      notes: leadInsert.notes,
      campaign_id: leadInsert.campaign_id,
      assigned_to: leadInsert.assigned_to,
    }).eq("id", leadId);
  } else {
    const { data, error } = await sb.from("leads").insert(leadInsert).select("id").single();
    if (error) return NextResponse.json({ ok: false, error: `lead: ${error.message}` }, { status: 500 });
    leadId = (data as { id: string }).id;
  }

  // ── 6. Audit event ──────────────────────────────────────────────────────
  await sb.from("automation_events").insert({
    source: "web_app",
    event_type: "manual_lead_created",
    status: "success",
    related_lead_id: leadId,
    related_contact_id: contactId,
    related_property_id: propertyId,
    triggered_by: user.id,
    payload: {
      input: body,
      secondary_contact_id: secondaryContactId,
      phones_added: phones.size,
    },
  });

  return NextResponse.json({
    ok: true,
    data: { leadId, contactId, propertyId, secondaryContactId, phonesAdded: phones.size },
  });
}
