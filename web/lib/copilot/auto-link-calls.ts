import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/twilio";

type DealPhoneRow = {
  id: string;
  title: string | null;
  contact_name: string | null;
  contact_phone: string | null;
};

type CallLogRow = {
  id: string;
  raw: Record<string, unknown> | null;
  direction: string | null;
  recorded_at: string | null;
};

export type AutoLinkedCall = {
  callLogId: string;
  dealId: string;
  dealTitle: string | null;
  phone: string;
  recordedAt: string | null;
};

type AutoLinkOptions = {
  limit?: number;
  source?: string;
  triggeredBy?: string | null;
};

export async function autoLinkRecentInboundCallsToDeals(
  sb: SupabaseClient,
  options: AutoLinkOptions = {},
): Promise<AutoLinkedCall[]> {
  const limit = options.limit ?? 100;
  const source = options.source ?? "socle_copilot";

  const [dealsRes, callsRes] = await Promise.all([
    sb
      .from("deals")
      .select("id,title,contact_name,contact_phone")
      .not("contact_phone", "is", null)
      .not("stage", "in", '("cloture","abandonne")')
      .order("updated_at", { ascending: false })
      .limit(1000),
    sb
      .from("call_logs")
      .select("id,raw,direction,recorded_at")
      .eq("direction", "inbound")
      .order("recorded_at", { ascending: false })
      .limit(limit),
  ]);

  const dealsByPhone = new Map<string, DealPhoneRow>();
  for (const deal of (dealsRes.data ?? []) as DealPhoneRow[]) {
    const phone = normalizePhone(String(deal.contact_phone ?? ""));
    if (phone && !dealsByPhone.has(phone)) dealsByPhone.set(phone, deal);
  }

  const linked: AutoLinkedCall[] = [];
  for (const call of (callsRes.data ?? []) as CallLogRow[]) {
    const raw = call.raw ?? {};
    if (raw.deal_id || raw.dealId || raw.investor_id) continue;

    const from = normalizePhone(String(raw.from ?? ""));
    if (!from) continue;

    const deal = dealsByPhone.get(from);
    if (!deal) continue;

    const nextRaw = {
      ...raw,
      match_type: raw.match_type === "unmatched" || !raw.match_type ? "deal" : raw.match_type,
      deal_id: deal.id,
      deal_title: deal.title,
      deal_contact_name: deal.contact_name,
      auto_linked_by: source,
      auto_linked_at: new Date().toISOString(),
    };

    const { error } = await sb
      .from("call_logs")
      .update({ raw: nextRaw })
      .eq("id", call.id);

    if (error) continue;

    await sb.from("automation_events").insert({
      source,
      event_type: "call_auto_linked_to_deal",
      status: "success",
      triggered_by: options.triggeredBy ?? null,
      payload: {
        callLogId: call.id,
        dealId: deal.id,
        dealTitle: deal.title,
        phone: from,
      },
    });

    linked.push({
      callLogId: call.id,
      dealId: deal.id,
      dealTitle: deal.title,
      phone: from,
      recordedAt: call.recorded_at,
    });
  }

  return linked;
}
