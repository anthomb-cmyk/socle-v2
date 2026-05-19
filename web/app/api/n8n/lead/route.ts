// POST /api/n8n/lead — create or update a lead from email triage / external source.
//
// Auth: Bearer ${N8N_SHARED_KEY}.
//
// The body is a hybrid: enough to upsert a contact + property + lead.
// Idempotency: matricule on property; (full_name OR company_name) on contact;
// (campaign_id, property_id, contact_id) unique on lead.
//
// Body: {
//   campaign?: { id?: uuid, name?: string, city?: string }   // creates if needed
//   property: {
//     address: string, city?: string, matricule?: string,
//     num_units?: number, evaluation_total?: number
//   },
//   contact: {
//     kind?: contact_kind,
//     full_name?: string, company_name?: string,
//     primary_email?: string, primary_phone?: string,
//     mailing_address?: string, mailing_city?: string
//   },
//   phones?: string[],   // optional E.164 list (we'll normalize)
//   lead?: {
//     status?: lead_status, priority?: number, notes?: string,
//     source?: string
//   },
//   alert?: { telegram?: boolean }  // ping Anthony if seller-intent strong
// }

import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { notifyNewLead } from "@/lib/notifications/phone";
import { extractPhonesFromValue, formatDisplay } from "@/lib/role-parser/phone-utils";
import { sendTelegramAlert } from "@/lib/telegram";
import { normalizeCity } from "@/lib/cities";

const Body = z.object({
  campaign: z.object({
    id: z.string().uuid().optional(),
    name: z.string().optional(),
    city: z.string().optional(),
  }).optional(),
  property: z.object({
    address: z.string().min(1),
    city: z.string().optional(),
    matricule: z.string().optional(),
    num_units: z.number().int().optional(),
    evaluation_total: z.number().optional(),
  }),
  contact: z.object({
    kind: z.enum(["person", "company", "numbered_co", "trust", "unknown"]).optional(),
    full_name: z.string().optional(),
    company_name: z.string().optional(),
    primary_email: z.string().email().optional(),
    primary_phone: z.string().optional(),
    mailing_address: z.string().optional(),
    mailing_city: z.string().optional(),
  }),
  phones: z.array(z.string()).optional(),
  lead: z.object({
    status: z.enum(["new", "enriching", "ready_to_call", "in_outreach", "meeting_set", "qualified", "no_answer", "rejected", "do_not_contact"]).optional(),
    priority: z.number().int().min(0).max(100).optional(),
    notes: z.string().optional(),
    source: z.string().optional(),
  }).optional(),
  alert: z.object({ telegram: z.boolean().optional() }).optional(),
});

export async function POST(request: Request) {
  // Auth
  const expected = process.env.N8N_SHARED_KEY;
  const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (expected) {
    if (provided !== expected) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "N8N_SHARED_KEY not configured" }, { status: 500 });
  }

  let body;
  try { body = Body.parse(await request.json()); }
  catch (err) { return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 }); }

  const sb = createSupabaseAdminClient();

  // 1. Campaign
  let campaignId: string | null = null;
  if (body.campaign?.id) campaignId = body.campaign.id;
  else if (body.campaign?.name) {
    const { data: existing } = await sb.from("campaigns").select("id").eq("name", body.campaign.name).maybeSingle();
    if (existing) campaignId = (existing as { id: string }).id;
    else {
      const { data, error } = await sb.from("campaigns")
        .insert({ name: body.campaign.name, city: body.campaign.city ?? null, source: "n8n" })
        .select("id").single();
      if (error) return NextResponse.json({ ok: false, error: `campaign: ${error.message}` }, { status: 500 });
      campaignId = (data as { id: string }).id;
    }
  }

  const counts = { properties_created: 0, properties_updated: 0, contacts_created: 0, contacts_updated: 0, phones_created: 0, leads_created: 0, leads_updated: 0 };

  // 2. Property: match by matricule first, then address+city
  const cityNorm = normalizeCity(body.property.city);
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
    evaluation_total: body.property.evaluation_total ?? null,
    source: "n8n",
  };
  if (propertyId) {
    await sb.from("properties").update(propPayload).eq("id", propertyId);
    counts.properties_updated++;
  } else {
    const { data, error } = await sb.from("properties").insert(propPayload).select("id").single();
    if (error) return NextResponse.json({ ok: false, error: `property: ${error.message}` }, { status: 500 });
    propertyId = (data as { id: string }).id;
    counts.properties_created++;
  }

  // 3. Contact: match by full_name OR company_name
  const lookupField = body.contact.kind === "person" || body.contact.full_name ? "full_name" : "company_name";
  const lookupVal = lookupField === "full_name" ? body.contact.full_name : body.contact.company_name;
  if (!lookupVal) return NextResponse.json({ ok: false, error: "contact must have full_name or company_name" }, { status: 400 });

  const { data: existingContact } = await sb.from("contacts").select("id").eq(lookupField, lookupVal).maybeSingle();
  let contactId: string;
  const contactPayload = {
    kind: body.contact.kind ?? (body.contact.company_name ? "company" : body.contact.full_name ? "person" : "unknown"),
    full_name: body.contact.full_name ?? null,
    company_name: body.contact.company_name ?? null,
    primary_email: body.contact.primary_email ?? null,
    mailing_address: body.contact.mailing_address ?? null,
    mailing_city: body.contact.mailing_city ? normalizeCity(body.contact.mailing_city) : null,
    source: "n8n",
  };
  if (existingContact) {
    contactId = (existingContact as { id: string }).id;
    await sb.from("contacts").update(contactPayload).eq("id", contactId);
    counts.contacts_updated++;
  } else {
    const { data, error } = await sb.from("contacts").insert(contactPayload).select("id").single();
    if (error) return NextResponse.json({ ok: false, error: `contact: ${error.message}` }, { status: 500 });
    contactId = (data as { id: string }).id;
    counts.contacts_created++;
  }

  // Property ↔ contact link
  await sb.from("property_contacts").upsert({
    property_id: propertyId,
    contact_id: contactId,
    relationship: "owner",
  }, { onConflict: "property_id,contact_id,relationship", ignoreDuplicates: true });

  // 4. Phones
  const allPhones = new Set<string>();
  for (const p of body.phones ?? []) extractPhonesFromValue(p).forEach(e => allPhones.add(e));
  if (body.contact.primary_phone) extractPhonesFromValue(body.contact.primary_phone).forEach(e => allPhones.add(e));

  for (const e164 of allPhones) {
    const { error } = await sb.from("phones").upsert({
      contact_id: contactId,
      e164,
      display: formatDisplay(e164),
      status: "unverified",
      source: "manual",
      confidence: 75,
      evidence: "n8n /api/n8n/lead",
    }, { onConflict: "contact_id,e164", ignoreDuplicates: true });
    if (!error) counts.phones_created++;
  }

  // 5. Lead
  const leadPayload = {
    campaign_id: campaignId,
    property_id: propertyId,
    contact_id: contactId,
    status: body.lead?.status ?? "new",
    priority: body.lead?.priority ?? 50,
    notes: body.lead?.notes ?? null,
    source: body.lead?.source ?? "n8n",
  };
  let leadId: string | null = null;
  let createdLead = false;
  const { data: existingLead } = await sb.from("leads")
    .select("id").eq("property_id", propertyId).eq("contact_id", contactId)
    .maybeSingle();
  if (existingLead) {
    leadId = (existingLead as { id: string }).id;
    await sb.from("leads").update(leadPayload).eq("id", leadId);
    counts.leads_updated++;
  } else {
    const { data, error } = await sb.from("leads").insert(leadPayload).select("id").single();
    if (error) return NextResponse.json({ ok: false, error: `lead: ${error.message}` }, { status: 500 });
    leadId = (data as { id: string }).id;
    createdLead = true;
    counts.leads_created++;
  }

  // 6. Optional Telegram alert
  let telegramMessageId: string | null = null;
  let telegramError: string | null = null;
  if (body.alert?.telegram) {
    const tg = await sendTelegramAlert(
`📩 Lead created from email

*Owner:* ${body.contact.full_name ?? body.contact.company_name}
*Property:* ${body.property.address}${body.property.num_units ? ` · ${body.property.num_units} units` : ""}
*City:* ${cityNorm ?? "—"}
*Status:* ${leadPayload.status}

${body.lead?.notes ? body.lead.notes.slice(0, 200) : ""}`,
    );
    if (tg.ok) {
      telegramMessageId = tg.message_id;
    } else {
      telegramError = tg.error;
      console.error("[n8n/lead] Telegram alert failed:", tg.error);
    }
  }

  const leadNotification = createdLead && leadId
    ? await notifyNewLead({
        leadId,
        ownerLabel: [body.contact.full_name, body.contact.company_name].filter(Boolean).join(" - ") || null,
        propertyLabel: [body.property.address, cityNorm].filter(Boolean).join(", ") || null,
        source: leadPayload.source,
      })
    : null;

  // 7. Audit
  await sb.from("automation_events").insert({
    source: "n8n",
    event_type: "lead_upserted_from_email",
    status: "success",
    related_lead_id: leadId,
    related_contact_id: contactId,
    related_property_id: propertyId,
    payload: { input: body, counts },
    result: { leadId, contactId, propertyId, telegramSent: !!telegramMessageId, telegramError, leadNotification },
    telegram_message_id: telegramMessageId,
    error_message: telegramError,
  });

  return NextResponse.json({ ok: true, data: { leadId, contactId, propertyId, counts, telegramMessageId } });
}
