import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/twilio";

export type RecentCall = {
  id: string;
  direction: "inbound" | "outbound";
  number: string;
  name: string | null;
  leadId: string | null;
  contactId: string | null;
  investorId: string | null;
  dealId: string | null;
  dealTitle: string | null;
  address: string | null;
  durationSec: number | null;
  recordedAt: string | null;
  notes: string | null;
  transcript: string | null;
  transcriptStatus: string | null;
  summary: string | null;
  outcome: string | null;
  missed: boolean;
};

type CallRow = {
  id: string;
  lead_id: string | null;
  contact_id: string | null;
  twilio_call_sid: string | null;
  direction: string | null;
  duration_sec: number | null;
  recorded_at: string | null;
  transcript: string | null;
  transcript_status: string | null;
  summary: string | null;
  notes: string | null;
  outcome: string | null;
  raw: {
    from?: string | null;
    to?: string | null;
    investor_id?: string | null;
    deal_id?: string | null;
    dealId?: string | null;
    deal_title?: string | null;
    dealTitle?: string | null;
    lead_phone?: string | null;
    phone_e164?: string | null;
  } | null;
};

type DealPhoneRow = {
  id: string;
  title: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  updated_at: string | null;
};

export async function getQuickCallRecents(
  sb: SupabaseClient,
  limit = 50,
): Promise<RecentCall[]> {
  const { data } = await sb
    .from("call_logs")
    .select("id, lead_id, contact_id, twilio_call_sid, direction, duration_sec, recorded_at, transcript, transcript_status, summary, notes, outcome, raw")
    .order("recorded_at", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as unknown as CallRow[];
  const contactIds = [...new Set(rows.map((r) => r.contact_id).filter((id): id is string => Boolean(id)))];
  const leadIds = [...new Set(rows.map((r) => r.lead_id).filter((id): id is string => Boolean(id)))];
  const rawDealIds = [...new Set(rows
    .map((row) => String(row.raw?.deal_id ?? row.raw?.dealId ?? "").trim())
    .filter(Boolean))];
  const recentNumbers = [...new Set(rows
    .flatMap((row) => [row.raw?.from, row.raw?.to, row.raw?.lead_phone, row.raw?.phone_e164])
    .map((value) => normalizePhone(String(value ?? "")))
    .filter(Boolean))];

  const [contactsRes, leadsRes, dealsRes] = await Promise.all([
    contactIds.length
      ? sb.from("contacts").select("id, full_name, company_name").in("id", contactIds)
      : Promise.resolve({ data: [] }),
    leadIds.length
      ? sb.from("leads").select("id, address, city").in("id", leadIds)
      : Promise.resolve({ data: [] }),
    recentNumbers.length || rawDealIds.length
      ? sb
          .from("deals")
          .select("id,title,contact_name,contact_phone,updated_at")
          .not("contact_phone", "is", null)
          .not("stage", "in", '("cloture","abandonne")')
          .order("updated_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] }),
  ]);

  const contactsById = new Map(
    ((contactsRes.data ?? []) as Array<{ id: string; full_name: string | null; company_name: string | null }>)
      .map((c) => [c.id, c]),
  );
  const leadsById = new Map(
    ((leadsRes.data ?? []) as Array<{ id: string; address: string | null; city: string | null }>)
      .map((l) => [l.id, l]),
  );
  const dealsById = new Map<string, DealPhoneRow>();
  const dealsByPhone = new Map<string, DealPhoneRow>();
  for (const deal of (dealsRes.data ?? []) as DealPhoneRow[]) {
    dealsById.set(deal.id, deal);
    const phone = normalizePhone(String(deal.contact_phone ?? ""));
    if (phone && !dealsByPhone.has(phone)) dealsByPhone.set(phone, deal);
  }

  return rows.map((r) => {
    const contact = r.contact_id ? contactsById.get(r.contact_id) ?? null : null;
    const lead = r.lead_id ? leadsById.get(r.lead_id) ?? null : null;
    const direction = (r.direction === "inbound" || r.direction === "outbound") ? r.direction : "outbound";
    const number = direction === "inbound"
      ? (r.raw?.from ?? r.raw?.lead_phone ?? r.raw?.phone_e164 ?? "")
      : (r.raw?.to ?? r.raw?.lead_phone ?? r.raw?.phone_e164 ?? "");
    const normalizedNumber = normalizePhone(String(number || ""));
    const rawDealId = String(r.raw?.deal_id ?? r.raw?.dealId ?? "").trim();
    const deal = (rawDealId ? dealsById.get(rawDealId) : null) ?? (normalizedNumber ? dealsByPhone.get(normalizedNumber) : null) ?? null;
    const name = [contact?.full_name, contact?.company_name].filter(Boolean).join(" - ")
      || deal?.contact_name
      || null;

    return {
      id: r.id,
      direction,
      number: String(number || ""),
      name,
      leadId: r.lead_id,
      contactId: r.contact_id,
      investorId: r.raw?.investor_id ?? null,
      dealId: deal?.id ?? (rawDealId || null),
      dealTitle: deal?.title ?? r.raw?.deal_title ?? r.raw?.dealTitle ?? null,
      address: lead ? [lead.address, lead.city].filter(Boolean).join(", ") || null : deal?.title ?? null,
      durationSec: r.duration_sec,
      recordedAt: r.recorded_at,
      notes: r.notes,
      transcript: r.transcript,
      transcriptStatus: r.transcript_status,
      summary: r.summary,
      outcome: r.outcome,
      missed: direction === "inbound" && (r.duration_sec ?? 0) === 0,
    };
  });
}
