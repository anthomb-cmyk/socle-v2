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

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Appels entrants</h1>
        <p className="text-sm text-zinc-500">
          Appels reçus sur Twilio. Les appels inconnus restent ici même sans lead ou investisseur lié.
        </p>
      </header>

      <div className="space-y-3">
        {calls.length === 0 && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-400">
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
    <article className="rounded-2xl border border-zinc-200 bg-white p-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {isTest && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs uppercase tracking-wide text-blue-800">
                test
              </span>
            )}
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs uppercase tracking-wide text-zinc-700">
              {labelMatch(matchType)}
            </span>
            <h2 className="font-semibold">{caller}</h2>
          </div>
          <div className="mt-1 text-sm text-zinc-500">
            {formatLocalDateTime(call.recorded_at)}
            {" · "}
            {formatDuration(call.duration_sec)}
            {" · "}
            transcription: {call.transcript_status ?? "—"}
          </div>
        </div>
        <div className="text-right text-xs font-mono text-zinc-400">
          <div>{call.twilio_call_sid ?? "—"}</div>
          {call.recording_sid && <div>{call.recording_sid}</div>}
        </div>
      </header>

      <div className="mt-4 grid gap-2 text-sm md:grid-cols-3">
        <FlowStat label="Appelant" value={caller} help="La personne qui a composé le numéro Socle." />
        <FlowStat label="Numéro Socle appelé" value={socleNumber} help="Le numéro Twilio qui a reçu l'appel entrant." />
        <FlowStat
          label="Transfert vers ton téléphone"
          value={forwardedTo ?? "+1 514 663 8466"}
          help="Le téléphone où Socle transfère l'appel pour que tu répondes."
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        {call.lead_id && (
          <Link href={`/leads/${call.lead_id}` as never} className="text-zinc-900 underline">
            Lead lié
          </Link>
        )}
        {call.contact_id && (
          <Link href={`/contacts/${call.contact_id}` as never} className="text-zinc-900 underline">
            {contactName || "Contact lié"}
          </Link>
        )}
        {investorId && (
          <Link href={`/investisseurs/${investorId}` as never} className="text-zinc-900 underline">
            Investisseur lié
          </Link>
        )}
        {!call.lead_id && !call.contact_id && !investorId && (
          <span className="text-amber-700">Aucun contact reconnu</span>
        )}
      </div>

      {call.transcript && (
        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Transcription</div>
        <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 whitespace-pre-wrap font-sans text-sm">
          {call.transcript}
        </pre>
        </div>
      )}
    </article>
  );
}

function FlowStat({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 font-medium text-zinc-900">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{help}</div>
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
