import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { normalizePhone } from "@/lib/twilio";

export const dynamic = "force-dynamic";

type TextoRecipient = {
  id: string;
  label: string;
  sublabel: string | null;
  number: string;
  contactId: string | null;
  leadId: string | null;
  dealId: string | null;
  dealTitle: string | null;
};

type ContactRow = { id: string; full_name: string | null; company_name: string | null };
type PhoneRow = { id: string; e164: string | null; contact_id: string | null };
type LeadViewRow = {
  lead_id: string;
  contact_id: string | null;
  full_name: string | null;
  company_name: string | null;
  address: string | null;
  city: string | null;
  best_phone: string | null;
  updated_at: string | null;
};
type DealRow = {
  id: string;
  title: string;
  contact_name: string | null;
  contact_phone: string | null;
  address: string | null;
  updated_at: string | null;
};

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const sb = createSupabaseAdminClient();
  const url = new URL(request.url);
  const query = sanitizeSearch(url.searchParams.get("q") ?? "");
  const digits = query.replace(/\D/g, "");

  const [leadsRes, dealsRes] = await Promise.all([
    queryLeads(sb, query),
    queryDeals(sb, query, digits),
  ]);

  const leads = (leadsRes.data ?? []) as LeadViewRow[];
  const deals = (dealsRes.data ?? []) as DealRow[];
  const extraPhones = query ? await queryContactPhones(sb, query, digits) : [];

  const contactIds = unique(extraPhones.map((phone) => phone.contact_id).filter(Boolean) as string[]);
  const [contactsRes, contactLeadsRes] = await Promise.all([
    contactIds.length
      ? sb.from("contacts").select("id,full_name,company_name").in("id", contactIds)
      : Promise.resolve({ data: [] }),
    contactIds.length
      ? sb.from("leads_view").select("lead_id,contact_id,address,city,best_phone,full_name,company_name,updated_at").in("contact_id", contactIds)
      : Promise.resolve({ data: [] }),
  ]);

  const contactsById = new Map(
    ((contactsRes.data ?? []) as ContactRow[]).map((contact) => [contact.id, contact]),
  );
  const leadByContactId = new Map(
    ([...leads, ...((contactLeadsRes.data ?? []) as LeadViewRow[])])
      .filter((lead) => lead.contact_id)
      .map((lead) => [lead.contact_id as string, lead]),
  );

  const byNumber = new Map<string, TextoRecipient>();

  for (const lead of leads) {
    addRecipient(byNumber, leadRecipient(lead));
  }

  for (const deal of deals) {
    addRecipient(byNumber, dealRecipient(deal));
  }

  for (const phone of extraPhones) {
    const number = normalizePhone(phone.e164 ?? "");
    if (!number || byNumber.has(number)) continue;
    const contact = phone.contact_id ? contactsById.get(phone.contact_id) ?? null : null;
    const lead = phone.contact_id ? leadByContactId.get(phone.contact_id) ?? null : null;
    addRecipient(byNumber, {
      id: `contact:${phone.contact_id ?? phone.id}:${number}`,
      label: contactName(contact) ?? number,
      sublabel: leadPlaceLabel(lead ?? null),
      number,
      contactId: phone.contact_id,
      leadId: lead?.lead_id ?? null,
      dealId: null,
      dealTitle: null,
    });
  }

  const recipients = [...byNumber.values()]
    .sort((a, b) => a.label.localeCompare(b.label, "fr-CA"))
    .slice(0, 80);

  return NextResponse.json({ ok: true, data: recipients });
}

function queryLeads(sb: ReturnType<typeof createSupabaseAdminClient>, query: string) {
  let q = sb
    .from("leads_view")
    .select("lead_id,contact_id,full_name,company_name,address,city,best_phone,updated_at")
    .not("best_phone", "is", null)
    .limit(70);

  if (query) {
    const pattern = `%${query}%`;
    q = q.or([
      `full_name.ilike.${pattern}`,
      `company_name.ilike.${pattern}`,
      `address.ilike.${pattern}`,
      `city.ilike.${pattern}`,
      `best_phone.ilike.${pattern}`,
    ].join(","));
  } else {
    q = q.order("updated_at", { ascending: false });
  }

  return q;
}

function queryDeals(sb: ReturnType<typeof createSupabaseAdminClient>, query: string, digits: string) {
  let q = sb
    .from("deals")
    .select("id,title,contact_name,contact_phone,address,updated_at")
    .not("stage", "eq", "abandonne")
    .not("contact_phone", "is", null)
    .limit(50);

  if (query) {
    const pattern = `%${query}%`;
    const clauses = [
      `title.ilike.${pattern}`,
      `contact_name.ilike.${pattern}`,
      `address.ilike.${pattern}`,
    ];
    if (digits.length >= 3) clauses.push(`contact_phone.ilike.%${digits}%`);
    q = q.or(clauses.join(","));
  } else {
    q = q.order("updated_at", { ascending: false });
  }

  return q;
}

async function queryContactPhones(
  sb: ReturnType<typeof createSupabaseAdminClient>,
  query: string,
  digits: string,
): Promise<PhoneRow[]> {
  const contactsQuery = sb
    .from("contacts")
    .select("id")
    .or(`full_name.ilike.%${query}%,company_name.ilike.%${query}%`)
    .limit(40);

  const phoneQuery = digits.length >= 3
    ? sb.from("phones").select("id,e164,contact_id").ilike("e164", `%${digits}%`).limit(60)
    : Promise.resolve({ data: [] });

  const [contactsRes, phonesRes] = await Promise.all([contactsQuery, phoneQuery]);
  const contactIds = unique(((contactsRes.data ?? []) as Array<{ id: string }>).map((contact) => contact.id));
  const contactPhonesRes = contactIds.length
    ? await sb.from("phones").select("id,e164,contact_id").in("contact_id", contactIds).limit(80)
    : { data: [] };

  return uniqueByNumber([
    ...((phonesRes.data ?? []) as PhoneRow[]),
    ...((contactPhonesRes.data ?? []) as PhoneRow[]),
  ]);
}

function leadRecipient(lead: LeadViewRow): TextoRecipient | null {
  const number = normalizePhone(lead.best_phone ?? "");
  if (!number) return null;
  return {
    id: `lead:${lead.lead_id}:${number}`,
    label: [lead.full_name, lead.company_name].filter(Boolean).join(" - ") || number,
    sublabel: [lead.address, lead.city].filter(Boolean).join(", ") || null,
    number,
    contactId: lead.contact_id,
    leadId: lead.lead_id,
    dealId: null,
    dealTitle: null,
  };
}

function dealRecipient(deal: DealRow): TextoRecipient | null {
  const number = normalizePhone(deal.contact_phone ?? "");
  if (!number) return null;
  return {
    id: `deal:${deal.id}:${number}`,
    label: deal.contact_name || deal.title,
    sublabel: deal.contact_name ? deal.title : "Pipeline deal",
    number,
    contactId: null,
    leadId: null,
    dealId: deal.id,
    dealTitle: deal.title,
  };
}

function addRecipient(byNumber: Map<string, TextoRecipient>, recipient: TextoRecipient | null) {
  if (!recipient) return;
  byNumber.set(recipient.number, recipient);
}

function sanitizeSearch(value: string) {
  return value
    .trim()
    .replace(/[%_,()]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function contactName(contact: ContactRow | null) {
  if (!contact) return null;
  return [contact.full_name, contact.company_name].filter(Boolean).join(" - ") || null;
}

function leadPlaceLabel(lead: { address: string | null; city: string | null } | null) {
  if (!lead) return null;
  return [lead.address, lead.city].filter(Boolean).join(", ") || null;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function uniqueByNumber(phones: PhoneRow[]) {
  const seen = new Set<string>();
  return phones.filter((phone) => {
    const number = normalizePhone(phone.e164 ?? "");
    if (!number || seen.has(number)) return false;
    seen.add(number);
    return true;
  });
}
