import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LOCAL_TIME_ZONE = "America/Toronto";

type InboundCall = {
  id: string;
  lead_id: string | null;
  contact_id: string | null;
  twilio_call_sid: string | null;
  parent_call_sid: string | null;
  duration_sec: number | null;
  recording_url: string | null;
  recording_sid: string | null;
  transcript_status: string | null;
  transcript: string | null;
  recorded_at: string | null;
  raw: {
    from?: string | null;
    to?: string | null;
    match_type?: string | null;
    investor_id?: string | null;
    twilio?: Record<string, unknown> | null;
  } | null;
  contacts?: { id: string; full_name: string | null; company_name: string | null } | null;
  leads?: { id: string; property_id: string | null } | null;
};

export default async function InboundCallsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as string;
  if (role !== "admin") redirect("/calls/queue");

  const sb = createSupabaseAdminClient();
  const { data } = await sb
    .from("call_logs")
    .select(`
      id, lead_id, contact_id, twilio_call_sid, parent_call_sid,
      duration_sec, recording_url, recording_sid, transcript_status,
      transcript, recorded_at, raw
    `)
    .eq("direction", "inbound")
    .order("recorded_at", { ascending: false })
    .limit(100);

  const baseCalls = (data ?? []) as unknown as InboundCall[];
  const contactIds = [...new Set(baseCalls.map((call) => call.contact_id).filter((id): id is string => Boolean(id)))];
  const leadIds = [...new Set(baseCalls.map((call) => call.lead_id).filter((id): id is string => Boolean(id)))];

  const [contactsRes, leadsRes] = await Promise.all([
    contactIds.length
      ? sb.from("contacts").select("id, full_name, company_name").in("id", contactIds)
      : Promise.resolve({ data: [] }),
    leadIds.length
      ? sb.from("leads").select("id, property_id").in("id", leadIds)
      : Promise.resolve({ data: [] }),
  ]);

  const contactsById = new Map(
    ((contactsRes.data ?? []) as Array<{ id: string; full_name: string | null; company_name: string | null }>)
      .map((contact) => [contact.id, contact]),
  );
  const leadsById = new Map(
    ((leadsRes.data ?? []) as Array<{ id: string; property_id: string | null }>)
      .map((lead) => [lead.id, lead]),
  );

  const calls = baseCalls.map((call) => ({
    ...call,
    contacts: call.contact_id ? contactsById.get(call.contact_id) ?? null : null,
    leads: call.lead_id ? leadsById.get(call.lead_id) ?? null : null,
  }));

  const recognizedCount = calls.filter((call) => call.lead_id || call.contact_id || call.raw?.investor_id).length;
  const unknownCount = calls.length - recognizedCount;
  const withTranscriptCount = calls.filter((call) => call.transcript).length;

  return (
    <main className="ic-page">
      <header className="ic-head">
        <div>
          <div className="ic-head__eyebrow">Twilio · inbound</div>
          <h1 className="ic-head__title">Appels entrants</h1>
          <p className="ic-head__sub">
            Appels reçus sur les numéros Socle, avec reconnaissance contact/lead et transcription quand disponible.
          </p>
        </div>
        <div className="ic-metrics">
          <Metric label="Total" value={calls.length} />
          <Metric label="Reconnus" value={recognizedCount} tone="green" />
          <Metric label="Inconnus" value={unknownCount} tone="amber" />
          <Metric label="Transcrits" value={withTranscriptCount} />
        </div>
      </header>

      <div className="ic-list">
        {calls.length === 0 && (
          <div className="ic-empty">
            Aucun appel entrant enregistré.
          </div>
        )}
        {calls.map((call) => (
          <InboundCallCard key={call.id} call={call} />
        ))}
      </div>
    </main>
  );
}

function InboundCallCard({ call }: { call: InboundCall }) {
  const contactName = [call.contacts?.full_name, call.contacts?.company_name].filter(Boolean).join(" — ");
  const investorId = call.raw?.investor_id ?? null;
  const matchType = call.raw?.match_type ?? (call.contact_id ? "contact" : "unmatched");
  const caller = call.raw?.from ?? "Numéro inconnu";
  const socleNumber = call.raw?.to ?? "Numéro Socle inconnu";
  const forwardedTo = String(call.raw?.twilio?.["DialCallSid"] ? "" : "") || null;
  const isTest =
    call.twilio_call_sid === "CA11111111111111111111111111111111" ||
    caller === "+15145550000";

  return (
    <article className={`ic-card${!call.lead_id && !call.contact_id && !investorId ? " ic-card--unknown" : ""}`}>
      <header className="ic-card__head">
        <div className="ic-card__main">
          <div className="ic-card__title-row">
            {isTest && (
              <span className="ic-pill ic-pill--test">
                test
              </span>
            )}
            <span className={`ic-pill ic-pill--${matchType === "unmatched" ? "unknown" : "known"}`}>
              {labelMatch(matchType)}
            </span>
            <h2 className="ic-card__caller">{caller}</h2>
          </div>
          <div className="ic-card__meta">
            {formatLocalDateTime(call.recorded_at)}
            {" · "}
            {formatDuration(call.duration_sec)}
            {" · "}
            transcription: {call.transcript_status ?? "—"}
          </div>
        </div>
        <div className="ic-card__sid">
          <div>{call.twilio_call_sid ?? "—"}</div>
          {call.recording_sid && <div>{call.recording_sid}</div>}
        </div>
      </header>

      <div className="ic-flow">
        <FlowStat label="Appelant" value={caller} help="La personne qui a composé le numéro Socle." />
        <FlowStat label="Numéro Socle appelé" value={socleNumber} help="Le numéro Twilio qui a reçu l'appel entrant." />
        <FlowStat
          label="Transfert vers ton téléphone"
          value={forwardedTo ?? "+1 514 663 8466"}
          help="Le téléphone où Socle transfère l'appel pour que tu répondes."
        />
      </div>

      <div className="ic-links">
        {call.lead_id && (
          <Link href={`/leads/${call.lead_id}` as never} className="ic-link">
            Lead lié
          </Link>
        )}
        {call.contact_id && (
          <Link href={`/contacts/${call.contact_id}` as never} className="ic-link">
            {contactName || "Contact lié"}
          </Link>
        )}
        {investorId && (
          <Link href={`/investisseurs/${investorId}` as never} className="ic-link">
            Investisseur lié
          </Link>
        )}
        {!call.lead_id && !call.contact_id && !investorId && (
          <span className="ic-unmatched">Aucun contact reconnu</span>
        )}
      </div>

      {call.transcript && (
        <div className="ic-transcript">
          <div className="ic-transcript__label">Transcription</div>
        <pre className="ic-transcript__body">
          {call.transcript}
        </pre>
        </div>
      )}
    </article>
  );
}

function FlowStat({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div className="ic-flow-stat">
      <div className="ic-flow-stat__label">{label}</div>
      <div className="ic-flow-stat__value">{value}</div>
      <div className="ic-flow-stat__help">{help}</div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "green" | "amber" }) {
  return (
    <div className={`ic-metric${tone ? ` ic-metric--${tone}` : ""}`}>
      <div className="ic-metric__label">{label}</div>
      <div className="ic-metric__value">{value}</div>
    </div>
  );
}

function labelMatch(matchType: string): string {
  if (matchType === "investor") return "investisseur reconnu";
  if (matchType === "contact") return "contact reconnu";
  return "non reconnu";
}

function formatDuration(sec: number | null): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function formatLocalDateTime(value: string | null): string {
  if (!value) return "—";
  return `${new Intl.DateTimeFormat("fr-CA", {
    timeZone: LOCAL_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))} (heure du Québec)`;
}
