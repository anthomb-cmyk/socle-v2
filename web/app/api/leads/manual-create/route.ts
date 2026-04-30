// POST /api/leads/manual-create — admin-only manual lead creation.
//
// Same body shape as /api/n8n/lead, but session-authed instead of bearer.
// Implementation reuses the same upsert logic via inline write.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { extractPhonesFromValue, formatDisplay } from "@/lib/role-parser/phone-utils";
import { normalizeCity } from "@/lib/cities";

const Body = z.object({
  property: z.object({
    address: z.string().min(1),
    city: z.string().optional(),
    matricule: z.string().optional(),
    num_units: z.number().int().optional(),
  }),
  contact: z.object({
    kind: z.enum(["person", "company", "numbered_co", "trust", "unknown"]).optional(),
    full_name: z.string().optional(),
    company_name: z.string().optional(),
    primary_email: z.string().email().optional(),
    primary_phone: z.string().optional(),
  }),
  phones: z.array(z.string()).optional(),
  lead: z.object({
    notes: z.string().optional(),
    source: z.string().optional(),
    priority: z.number().int().min(0).max(100).optional(),
  }).optional(),
});

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body;
  try { body = Body.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const sb = createSupabaseAdminClient();
  const cityNorm = normalizeCity(body.property.city);

  // Property upsert (matricule, then address+city)
  let propertyId: string | null = null;
  if (body.property.matricule) {
    const { data } = await sb.from("properties").select("id").eq("matricule", body.property.matricule).maybeSingle();
    if (data) propertyId = (data as { id: string }).id;
  }
  if (!propertyId) {
    const q = sb.from("properties").select("id").eq("address", body.property.address);
    if (cityNorm) q.eq("city", cityNorm);
    const { data } = await q.maybeSingle();
    if (data) propertyId = (data as { id: string }).id;
  }
  const propPayload = {
    address: body.property.address,
    city: cityNorm,
    matricule: body.property.matricule ?? null,
    num_units: body.property.num_units ?? null,
    source: "manual",
  };
  if (propertyId) {
    await sb.from("properties").update(propPayload).eq("id", propertyId);
  } else {
    const { data, error } = await sb.from("properties").insert(propPayload).select("id").single();
    if (error) return NextResponse.json({ ok: false, error: `property: ${error.message}` }, { status: 500 });
    propertyId = (data as { id: string }).id;
  }

  // Contact upsert
  const lookupField = body.contact.kind === "person" || body.contact.full_name ? "full_name" : "company_name";
  const lookupVal = lookupField === "full_name" ? body.contact.full_name : body.contact.company_name;
  if (!lookupVal) return NextResponse.json({ ok: false, error: "contact must have full_name or company_name" }, { status: 400 });

  const { data: existingContact } = await sb.from("contacts").select("id").eq(lookupField, lookupVal).maybeSingle();
  const contactPayload = {
    kind: body.contact.kind ?? (body.contact.company_name ? "company" : "person"),
    full_name: body.contact.full_name ?? null,
    company_name: body.contact.company_name ?? null,
    primary_email: body.contact.primary_email ?? null,
    primary_phone: body.contact.primary_phone ?? null,
    source: "manual",
  };
  let contactId: string;
  if (existingContact) {
    contactId = (existingContact as { id: string }).id;
    await sb.from("contacts").update(contactPayload).eq("id", contactId);
  } else {
    const { data, error } = await sb.from("contacts").insert(contactPayload).select("id").single();
    if (error) return NextResponse.json({ ok: false, error: `contact: ${error.message}` }, { status: 500 });
    contactId = (data as { id: string }).id;
  }

  await sb.from("property_contacts").upsert(
    { property_id: propertyId, contact_id: contactId, relationship: "owner" },
    { onConflict: "property_id,contact_id,relationship", ignoreDuplicates: true }
  );

  // Phones
  const phones = new Set<string>();
  for (const p of body.phones ?? []) extractPhonesFromValue(p).forEach(e => phones.add(e));
  if (body.contact.primary_phone) extractPhonesFromValue(body.contact.primary_phone).forEach(e => phones.add(e));
  for (const e164 of phones) {
    await sb.from("phones").upsert({
      contact_id: contactId, e164, display: formatDisplay(e164),
      status: "unverified", source: "manual", confidence: 80,
      evidence: "manual entry via /leads/new",
    }, { onConflict: "contact_id,e164", ignoreDuplicates: true });
  }

  // Lead
  const { data: existingLead } = await sb.from("leads")
    .select("id").eq("property_id", propertyId).eq("contact_id", contactId).maybeSingle();
  let leadId: string;
  if (existingLead) {
    leadId = (existingLead as { id: string }).id;
    if (body.lead?.notes !== undefined) {
      await sb.from("leads").update({ notes: body.lead.notes }).eq("id", leadId);
    }
  } else {
    const { data, error } = await sb.from("leads").insert({
      property_id: propertyId,
      contact_id: contactId,
      status: "new",
      priority: body.lead?.priority ?? 50,
      notes: body.lead?.notes ?? null,
      source: body.lead?.source ?? "manual",
    }).select("id").single();
    if (error) return NextResponse.json({ ok: false, error: `lead: ${error.message}` }, { status: 500 });
    leadId = (data as { id: string }).id;
  }

  await sb.from("automation_events").insert({
    source: "web_app", event_type: "lead_manually_created", status: "success",
    related_lead_id: leadId, related_contact_id: contactId, related_property_id: propertyId,
    triggered_by: user.id, payload: { input: body },
  });

  return NextResponse.json({ ok: true, data: { leadId, contactId, propertyId } });
}
