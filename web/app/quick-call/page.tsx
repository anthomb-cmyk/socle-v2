import { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import PhoneClient, { type RecentCall } from "./PhoneClient";

export const metadata: Metadata = {
  title: "Téléphone — Socle CRM",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  raw: { from?: string | null; to?: string | null; investor_id?: string | null } | null;
};

export default async function QuickCallPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const initialTabRaw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const initialTab: "keypad" | "recents" = initialTabRaw === "recents" ? "recents" : "keypad";

  // Fetch the 50 most recent inbound + outbound calls so the Récents
  // tab shows real data immediately (like the iOS Phone Recents tab).
  const sb = createSupabaseAdminClient();
  const { data } = await sb
    .from("call_logs")
    .select("id, lead_id, contact_id, twilio_call_sid, direction, duration_sec, recorded_at, transcript, transcript_status, summary, notes, outcome, raw")
    .order("recorded_at", { ascending: false })
    .limit(50);

  const rows = (data ?? []) as unknown as CallRow[];
  const contactIds = [...new Set(rows.map((r) => r.contact_id).filter((id): id is string => Boolean(id)))];
  const leadIds = [...new Set(rows.map((r) => r.lead_id).filter((id): id is string => Boolean(id)))];

  const [contactsRes, leadsRes] = await Promise.all([
    contactIds.length
      ? sb.from("contacts").select("id, full_name, company_name").in("id", contactIds)
      : Promise.resolve({ data: [] }),
    leadIds.length
      ? sb.from("leads").select("id, address, city").in("id", leadIds)
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

  const recents: RecentCall[] = rows.map((r) => {
    const contact = r.contact_id ? contactsById.get(r.contact_id) ?? null : null;
    const lead = r.lead_id ? leadsById.get(r.lead_id) ?? null : null;
    const direction = (r.direction === "inbound" || r.direction === "outbound") ? r.direction : "outbound";
    const number = direction === "inbound"
      ? (r.raw?.from ?? "")
      : (r.raw?.to ?? "");
    const name = [contact?.full_name, contact?.company_name].filter(Boolean).join(" — ") || null;
    return {
      id: r.id,
      direction,
      number: String(number || ""),
      name,
      leadId: r.lead_id,
      contactId: r.contact_id,
      investorId: r.raw?.investor_id ?? null,
      address: lead ? [lead.address, lead.city].filter(Boolean).join(", ") || null : null,
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

  return <PhoneClient initialTab={initialTab} recents={recents} />;
}
