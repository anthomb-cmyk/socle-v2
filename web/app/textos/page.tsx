import { redirect } from "next/navigation";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { normalizePhone } from "@/lib/twilio";
import TextosClient, { type TextoConversation, type TextoMessage } from "./TextosClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SmsEvent = {
  id: string;
  event_type: "sms_received" | "sms_sent";
  related_lead_id: string | null;
  related_contact_id: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  occurred_at: string;
};

type ContactRow = { id: string; full_name: string | null; company_name: string | null };
type LeadRow = { id: string; contact_id: string | null; address: string | null; city: string | null };
type PhoneRow = { id: string; e164: string | null; contact_id: string | null };
type DealRow = {
  id: string;
  title: string;
  stage: string;
  contact_phone: string | null;
  activities: unknown;
};

export default async function TextosPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as string;
  if (role !== "admin") redirect("/calls/queue");

  const sb = createSupabaseAdminClient();
  const { data: events } = await sb
    .from("automation_events")
    .select("id,event_type,related_lead_id,related_contact_id,payload,result,occurred_at")
    .in("event_type", ["sms_received", "sms_sent"])
    .order("occurred_at", { ascending: false })
    .limit(300);

  const rows = ((events ?? []) as SmsEvent[]).sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const phoneNumbers = unique(rows.map((event) => counterpartNumber(event)).filter(Boolean) as string[]);
  const eventContactIds = unique(rows.map((event) => event.related_contact_id).filter(Boolean) as string[]);
  const eventLeadIds = unique(rows.map((event) => event.related_lead_id).filter(Boolean) as string[]);

  const [phonesRes, eventContactsRes, eventLeadsRes, dealsRes] = await Promise.all([
    phoneNumbers.length
      ? sb.from("phones").select("id,e164,contact_id").in("e164", phoneNumbers)
      : Promise.resolve({ data: [] }),
    eventContactIds.length
      ? sb.from("contacts").select("id,full_name,company_name").in("id", eventContactIds)
      : Promise.resolve({ data: [] }),
    eventLeadIds.length
      ? sb.from("leads").select("id,contact_id,address,city").in("id", eventLeadIds)
      : Promise.resolve({ data: [] }),
    sb
      .from("deals")
      .select("id,title,stage,contact_phone,activities")
      .not("stage", "eq", "abandonne")
      .order("updated_at", { ascending: false })
      .limit(500),
  ]);

  const phones = (phonesRes.data ?? []) as PhoneRow[];
  const phoneContactIds = unique(phones.map((phone) => phone.contact_id).filter(Boolean) as string[]);
  const missingContactIds = phoneContactIds.filter((id) => !eventContactIds.includes(id));
  const phoneContactsRes = missingContactIds.length
    ? await sb.from("contacts").select("id,full_name,company_name").in("id", missingContactIds)
    : { data: [] };
  const phoneLeadsRes = phoneContactIds.length
    ? await sb.from("leads").select("id,contact_id,address,city").in("contact_id", phoneContactIds)
    : { data: [] };

  const contactsById = new Map<string, ContactRow>();
  for (const contact of [...(eventContactsRes.data ?? []), ...(phoneContactsRes.data ?? [])] as ContactRow[]) {
    contactsById.set(contact.id, contact);
  }

  const leadsById = new Map<string, LeadRow>();
  const leadsByContactId = new Map<string, LeadRow>();
  for (const lead of [...(eventLeadsRes.data ?? []), ...(phoneLeadsRes.data ?? [])] as LeadRow[]) {
    leadsById.set(lead.id, lead);
    if (lead.contact_id && !leadsByContactId.has(lead.contact_id)) leadsByContactId.set(lead.contact_id, lead);
  }

  const phoneContactByNumber = new Map<string, string>();
  for (const phone of phones) {
    const e164 = normalizePhone(phone.e164 ?? "");
    if (e164 && phone.contact_id) phoneContactByNumber.set(e164, phone.contact_id);
  }

  const deals = (dealsRes.data ?? []) as DealRow[];
  const conversations = buildConversations(rows, {
    contactsById,
    leadsById,
    leadsByContactId,
    phoneContactByNumber,
    deals,
  });

  return <TextosClient conversations={conversations} />;
}

function buildConversations(
  events: SmsEvent[],
  ctx: {
    contactsById: Map<string, ContactRow>;
    leadsById: Map<string, LeadRow>;
    leadsByContactId: Map<string, LeadRow>;
    phoneContactByNumber: Map<string, string>;
    deals: DealRow[];
  },
): TextoConversation[] {
  const byNumber = new Map<string, TextoConversation>();

  for (const event of events) {
    const number = counterpartNumber(event);
    if (!number) continue;
    const payload = event.payload ?? {};
    const direction = event.event_type === "sms_received" ? "inbound" : "outbound";
    const from = normalizePhone(String(payload.from ?? "")) || "";
    const to = normalizePhone(String(payload.to ?? "")) || "";
    const body = String(payload.body ?? "");
    const contactId = event.related_contact_id ?? ctx.phoneContactByNumber.get(number) ?? null;
    const lead = event.related_lead_id
      ? ctx.leadsById.get(event.related_lead_id) ?? null
      : contactId
      ? ctx.leadsByContactId.get(contactId) ?? null
      : null;
    const deal = findDeal(number, lead?.id ?? event.related_lead_id, payload, ctx.deals);
    const contact = contactId ? ctx.contactsById.get(contactId) ?? null : null;

    const existing = byNumber.get(number);
    const message: TextoMessage = {
      id: event.id,
      direction,
      body,
      at: event.occurred_at,
      from,
      to,
    };

    if (existing) {
      existing.messages.push(message);
      existing.contactId ||= contactId;
      existing.contactName ||= contactName(contact);
      existing.leadId ||= lead?.id ?? null;
      existing.leadLabel ||= leadLabel(lead);
      existing.dealId ||= deal?.id ?? null;
      existing.dealTitle ||= deal?.title ?? null;
      existing.dealStage ||= deal?.stage ?? null;
      existing.socleNumber ||= direction === "inbound" ? to : from;
      continue;
    }

    byNumber.set(number, {
      id: number,
      number,
      socleNumber: direction === "inbound" ? to : from,
      contactId,
      contactName: contactName(contact),
      leadId: lead?.id ?? null,
      leadLabel: leadLabel(lead),
      dealId: deal?.id ?? null,
      dealTitle: deal?.title ?? null,
      dealStage: deal?.stage ?? null,
      messages: [message],
    });
  }

  return Array.from(byNumber.values())
    .map((conv) => ({ ...conv, messages: conv.messages.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) }))
    .sort((a, b) => Date.parse(b.messages[b.messages.length - 1]?.at ?? "") - Date.parse(a.messages[a.messages.length - 1]?.at ?? ""));
}

function counterpartNumber(event: SmsEvent): string | null {
  const payload = event.payload ?? {};
  const raw = event.event_type === "sms_received" ? payload.from : payload.to;
  return normalizePhone(String(raw ?? "")) || null;
}

function findDeal(number: string, leadId: string | null | undefined, payload: Record<string, unknown>, deals: DealRow[]) {
  const payloadDealId = String(payload.dealId ?? payload.deal_id ?? "").trim();
  if (payloadDealId) {
    const byPayload = deals.find((deal) => deal.id === payloadDealId);
    if (byPayload) return byPayload;
  }
  const byPhone = deals.find((deal) => normalizePhone(deal.contact_phone ?? "") === number);
  if (byPhone) return byPhone;
  if (!leadId) return null;
  return deals.find((deal) => activityHasLead(deal.activities, leadId)) ?? null;
}

function activityHasLead(activities: unknown, leadId: string) {
  return Array.isArray(activities) && activities.some((activity) => {
    if (!activity || typeof activity !== "object") return false;
    const row = activity as Record<string, unknown>;
    return row.leadId === leadId || row.lead_id === leadId;
  });
}

function contactName(contact: ContactRow | null) {
  if (!contact) return null;
  return [contact.full_name, contact.company_name].filter(Boolean).join(" - ") || null;
}

function leadLabel(lead: LeadRow | null) {
  if (!lead) return null;
  return [lead.address, lead.city].filter(Boolean).join(", ") || null;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
