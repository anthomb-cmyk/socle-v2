"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Investor = {
  id: string;
  full_name: string;
  firm_name: string | null;
  email: string | null;
  phone_e164: string | null;
  city: string | null;
  province: string | null;
  status: string;
  source: string | null;
  capital_available_cad: number | null;
  ticket_size_min_cad: number | null;
  ticket_size_max_cad: number | null;
  preferred_geography: string | null;
  asset_class_focus: string | null;
  notes: string | null;
  updated_at: string;
};

type Call = {
  id: string;
  twilio_call_sid: string | null;
  direction: string | null;
  duration_sec: number | null;
  recording_url: string | null;
  recording_sid: string | null;
  transcript: string | null;
  transcript_status: string | null;
  summary: string | null;
  outcome: string | null;
  started_at: string | null;
  recorded_at: string | null;
  created_at: string;
  raw?: {
    recording_source_call_sid?: string | null;
    related_calls?: Array<{ sid?: string | null }>;
  } | null;
};

type Deal = {
  id: string;
  deal_name: string;
  stage: string;
  property_id: string | null;
  pipeline_deal_id: string | null;
  ticket_size_cad: number | null;
  expected_close_at: string | null;
  probability_pct: number | null;
  notes: string | null;
  updated_at: string;
  properties?: { id: string; address: string | null; city: string | null; num_units: number | null } | null;
  pipeline_deal?: PipelineDeal | null;
};

type PipelineDeal = {
  id: string;
  title: string;
  stage: string;
  address: string | null;
  units: number | null;
  asking_price: number | null;
  offer_price: number | null;
  temperature: string | null;
  priority: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  next_action: string | null;
  notes_deal: string | null;
  notes_vendeur: string | null;
};

type Note = {
  id: string;
  body: string;
  author_id: string | null;
  created_at: string;
  updated_at: string;
};

const STAGE_LABELS: Record<string, string> = {
  prospect: "Prospect",
  discussing: "En discussion",
  loi: "LOI",
  due_diligence: "Due diligence",
  financing: "Financement",
  closed_won: "Conclu",
  closed_lost: "Perdu",
};

function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M$`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k$`;
  return `${n}$`;
}
function fmtDuration(sec: number | null): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}
function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("fr-CA", { dateStyle: "medium", timeStyle: "short" });
}
function shortSid(sid: string | null): string {
  return sid ? `${sid.slice(0, 14)}…` : "—";
}
function pipelineDealLabel(deal: PipelineDeal): string {
  return [
    deal.title,
    deal.address,
    deal.units ? `${deal.units} portes` : null,
    deal.stage,
  ].filter(Boolean).join(" · ");
}

export default function InvestorDetailClient({
  initialInvestor,
}: {
  initialInvestor: Investor;
}) {
  const [investor, setInvestor] = useState<Investor>(initialInvestor);
  const [tab, setTab] = useState<"calls" | "deals" | "notes" | "edit">("calls");

  return (
    <main className="socle-page">
      <header>
        <Link href={"/investisseurs" as never} className="btn btn--ghost btn--sm">
          <Icon name="chevronLeft" />Investisseurs
        </Link>
        <section className="investor-hero">
          <div className="investor-hero__avatar">{initials(investor.full_name)}</div>
          <div className="investor-hero__body">
            <div className="investor-hero__pills">
              <InvestorStatus status={investor.status} />
              <span className="pill pill--brand">Co-invest LP</span>
            </div>
          <h1 className="investor-hero__name">{investor.full_name}</h1>
          {investor.firm_name && (
            <div className="investor-hero__firm">{investor.firm_name}{investor.city && <> · <em>{investor.city}</em></>}</div>
          )}
          <div className="investor-hero__contact">
            {investor.email && <a href={`mailto:${investor.email}`}><Icon name="mail" />{investor.email}</a>}
            {investor.phone_e164 && <a href={`tel:${investor.phone_e164.replace(/\D/g, "")}`} className="mono"><Icon name="phone" />{investor.phone_e164}</a>}
            {investor.source && <span>Source · {investor.source}</span>}
          </div>
          </div>
          <div className="socle-head-actions">
            <button className="btn btn--primary" type="button">Trouver un deal</button>
            <button className="btn" type="button">Lier un deal</button>
          </div>
        </section>
        <SummaryGrid investor={investor} />
      </header>

      <nav className="tabs">
        {(
          [
            ["calls", "Appels"],
            ["deals", "Deals"],
            ["notes", "Notes"],
            ["edit", "Modifier"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`tab ${tab === key ? "tab--active" : ""}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "calls" && <CallsTab investorId={investor.id} />}
      {tab === "deals" && <DealsTab investorId={investor.id} />}
      {tab === "notes" && <NotesTab investorId={investor.id} />}
      {tab === "edit" && (
        <EditTab
          investor={investor}
          onSaved={(next) => setInvestor(next)}
        />
      )}
    </main>
  );
}

function SummaryGrid({ investor }: { investor: Investor }) {
  const ticket =
    investor.ticket_size_min_cad && investor.ticket_size_max_cad
      ? `${fmtMoney(investor.ticket_size_min_cad)} – ${fmtMoney(investor.ticket_size_max_cad)}`
      : investor.ticket_size_max_cad
      ? `≤ ${fmtMoney(investor.ticket_size_max_cad)}`
      : investor.ticket_size_min_cad
      ? `≥ ${fmtMoney(investor.ticket_size_min_cad)}`
      : "—";
  return (
    <div className="kpi-strip">
      <Stat hero label="Capital dispo" value={fmtMoney(investor.capital_available_cad)} />
      <Stat label="Ticket" value={ticket} />
      <Stat label="Focus" value={investor.asset_class_focus ?? "—"} />
      <Stat label="Géographie" value={investor.preferred_geography ?? "—"} />
      <Stat label="Email" value={investor.email ?? "—"} />
      <Stat label="Téléphone" value={investor.phone_e164 ?? "—"} />
      <Stat label="Ville" value={investor.city ?? "—"} />
      <Stat label="Source" value={investor.source ?? "—"} />
    </div>
  );
}

function Stat({ label, value, hero }: { label: string; value: string; hero?: boolean }) {
  return (
    <div className={`ki ${hero ? "ki--hero" : ""}`}>
      <div className="ki__l">{label}</div>
      <div className="ki__v">{value}</div>
    </div>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "LP";
}

function InvestorStatus({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "Actif", cls: "pill--ready" },
    prospect: { label: "Prospect", cls: "pill--review" },
    inactive: { label: "Inactif", cls: "pill--cold" },
    lost: { label: "Perdu", cls: "pill--hot" },
  };
  const item = map[status] ?? { label: status, cls: "pill--cold" };
  return <span className={`pill ${item.cls}`}><span className="pill__dot" />{item.label}</span>;
}

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
    chevronLeft: <path d="M15 18l-6-6 6-6" />,
    mail: <path d="M4 6h16v12H4zM4 7l8 6 8-6" />,
    phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
    check: <path d="M20 6L9 17l-5-5" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    map: <path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3zM9 3v15M15 6v15" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>{paths[name]}</svg>;
}

// ── Calls tab ──────────────────────────────────────────────────────────────
function CallsTab({ investorId }: { investorId: string }) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAttach, setShowAttach] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/investors/${investorId}/calls`);
    const j = await r.json();
    setLoading(false);
    if (j.ok) setCalls(j.data);
  }, [investorId]);
  useEffect(() => { reload(); }, [reload]);

  // Auto-refresh while any transcript is processing
  useEffect(() => {
    const processing = calls.some((c) => c.transcript_status === "processing");
    if (!processing) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [calls, reload]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowAttach((v) => !v)}
          className="text-sm border border-zinc-300 rounded-lg px-3 py-1.5 hover:bg-zinc-50"
        >
          {showAttach ? "Annuler" : "+ Rattacher un appel Twilio"}
        </button>
      </div>
      {showAttach && (
        <AttachTwilio investorId={investorId} onAttached={() => { setShowAttach(false); reload(); }} />
      )}

      {loading && <div className="text-zinc-400 text-sm p-4">Chargement…</div>}
      {!loading && calls.length === 0 && (
        <div className="text-zinc-400 text-sm p-8 bg-white rounded-2xl border border-zinc-200 text-center">
          Aucun appel pour cet investisseur.
        </div>
      )}

      {calls.map((call) => (
        <CallCard key={call.id} call={call} investorId={investorId} onChange={reload} />
      ))}
    </div>
  );
}

function AttachTwilio({
  investorId,
  onAttached,
}: {
  investorId: string;
  onAttached: () => void;
}) {
  const [sid, setSid] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/investors/${investorId}/calls/attach-twilio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          sid.trim().toUpperCase().startsWith("RE")
            ? { recording_sid: sid.trim() }
            : { call_sid: sid.trim() },
        ),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Erreur");
      setSid("");
      onAttached();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 flex gap-2 items-center"
    >
      <input
        value={sid}
        onChange={(e) => setSid(e.target.value)}
        placeholder="CA… Call SID ou RE… Recording SID"
        className="flex-1 border border-zinc-300 rounded-lg px-3 py-2 text-sm font-mono"
        required
      />
      <button
        type="submit"
        disabled={busy || !sid}
        className="bg-zinc-900 text-white text-sm rounded-lg px-3 py-2 disabled:opacity-50"
      >
        {busy ? "Rattachement…" : "Rattacher + transcrire"}
      </button>
      {err && <div className="text-sm text-red-600">{err}</div>}
    </form>
  );
}

function CallCard({
  call,
  investorId,
  onChange,
}: {
  call: Call;
  investorId: string;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(call.summary ?? "");
  const [outcome, setOutcome] = useState(call.outcome ?? "");
  const [retrying, setRetrying] = useState(false);
  const [retryErr, setRetryErr] = useState<string | null>(null);
  const [recordingSid, setRecordingSid] = useState("");

  async function save() {
    await fetch(`/api/investors/${investorId}/calls/${call.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary, outcome }),
    });
    setEditing(false);
    onChange();
  }
  async function remove() {
    if (!confirm("Supprimer cet appel ?")) return;
    await fetch(`/api/investors/${investorId}/calls/${call.id}`, { method: "DELETE" });
    onChange();
  }
  async function retryTranscript() {
    if (!call.twilio_call_sid) return;
    setRetrying(true);
    setRetryErr(null);
    try {
      const r = await fetch(`/api/investors/${investorId}/calls/attach-twilio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_sid: call.twilio_call_sid }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Erreur");
      onChange();
    } catch (e) {
      setRetryErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  }
  async function attachRecordingSid(e: React.FormEvent) {
    e.preventDefault();
    if (!recordingSid.trim()) return;
    setRetrying(true);
    setRetryErr(null);
    try {
      const r = await fetch(`/api/investors/${investorId}/calls/attach-twilio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recording_sid: recordingSid.trim() }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Erreur");
      setRecordingSid("");
      onChange();
    } catch (e) {
      setRetryErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  }

  return (
    <article className="bg-white rounded-2xl border border-zinc-200 p-4">
      <header className="flex items-center gap-2 text-sm">
        <span className="text-xs uppercase tracking-wide rounded px-1.5 py-0.5 bg-zinc-100">
          {call.direction ?? "manuel"}
        </span>
        <span className="text-zinc-500">{fmtDate(call.started_at ?? call.created_at)}</span>
        <span className="text-zinc-400">·</span>
        <span className="text-zinc-500">{fmtDuration(call.duration_sec)}</span>
        {call.twilio_call_sid && (
          <span className="text-xs font-mono text-zinc-400 ml-2">{call.twilio_call_sid.slice(0, 14)}…</span>
        )}
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-800"
        >
          {editing ? "Annuler" : "Modifier"}
        </button>
        <button
          type="button"
          onClick={remove}
          className="text-xs text-red-500 hover:text-red-700"
        >
          Supprimer
        </button>
      </header>

      {/* Transcript */}
      <div className="mt-3">
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">
          Transcription{" "}
          <span className="ml-2 normal-case text-zinc-400">({call.transcript_status ?? "—"})</span>
        </div>
        {call.transcript_status === "processing" && (
          <div className="text-sm text-zinc-400 italic">Whisper traite l&apos;enregistrement…</div>
        )}
        {call.transcript_status === "failed" && (
          <div className="text-sm text-red-500">La transcription a échoué.</div>
        )}
        {call.transcript_status === "skipped" && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <div className="flex flex-wrap items-center gap-2">
              <span>Aucun enregistrement trouvé automatiquement pour {shortSid(call.twilio_call_sid)}.</span>
              {call.twilio_call_sid && (
                <button
                  type="button"
                  onClick={retryTranscript}
                  disabled={retrying}
                  className="rounded-md bg-amber-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  {retrying ? "Recherche…" : "Réessayer"}
                </button>
              )}
            </div>
            <form onSubmit={attachRecordingSid} className="flex flex-wrap gap-2">
              <input
                value={recordingSid}
                onChange={(e) => setRecordingSid(e.target.value)}
                placeholder="Coller un Recording SID RE… depuis Twilio"
                className="min-w-72 flex-1 rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm font-mono text-zinc-900"
              />
              <button
                type="submit"
                disabled={retrying || !recordingSid.trim()}
                className="rounded-md bg-zinc-900 px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Transcrire ce recording
              </button>
            </form>
            {retryErr && <span className="text-red-600">{retryErr}</span>}
          </div>
        )}
        {call.transcript && (
          <pre className="text-sm whitespace-pre-wrap font-sans bg-zinc-50 rounded-lg p-3 border border-zinc-200">
            {call.transcript}
          </pre>
        )}
        {!call.transcript && call.transcript_status === "completed" && (
          <div className="text-sm text-zinc-400 italic">
            (transcription vide — silence ou audio inintelligible)
          </div>
        )}
      </div>

      {/* Summary + outcome */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Résumé</div>
          {editing ? (
            <textarea
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            />
          ) : (
            <div className="text-sm text-zinc-700">
              {call.summary ?? <span className="text-zinc-400">—</span>}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Résultat</div>
          {editing ? (
            <input
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="intéressé, à rappeler, passé…"
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            />
          ) : (
            <div className="text-sm text-zinc-700">
              {call.outcome ?? <span className="text-zinc-400">—</span>}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={save}
            className="bg-zinc-900 text-white text-sm rounded-lg px-3 py-1.5"
          >
            Enregistrer
          </button>
        </div>
      )}
    </article>
  );
}

// ── Deals tab ──────────────────────────────────────────────────────────────
function DealsTab({ investorId }: { investorId: string }) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/investors/${investorId}/deals`);
    const j = await r.json();
    setLoading(false);
    if (j.ok) setDeals(j.data);
  }, [investorId]);
  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="lead-grid" style={{ padding: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => setShowNew((v) => !v)}
          className="btn"
        >
          {showNew ? "Annuler" : "Lier un deal"}
        </button>
      </div>
      {showNew && (
        <NewDealForm
          investorId={investorId}
          onCreated={() => { setShowNew(false); reload(); }}
        />
      )}

      {loading && <div className="crm-empty-state">Chargement…</div>}
      {!loading && deals.length === 0 && (
        <div className="crm-empty-state card">
          Aucun deal pour cet investisseur.
        </div>
      )}

      {deals.map((d) => (
        <DealCard key={d.id} deal={d} investorId={investorId} onChange={reload} />
      ))}
      </div>
      <aside className="match-panel">
        <div className="panel__h">
          <div className="panel__t">Matching</div>
          <span className="pill pill--brand">{deals.length} liés</span>
        </div>
        <div className="outcome-list">
          <button className="out-btn out-btn--pos" type="button"><span className="out-btn__i"><Icon name="check" /></span>Ticket compatible</button>
          <button className="out-btn out-btn--neu" type="button"><span className="out-btn__i"><Icon name="map" /></span>Géographie cible</button>
          <button className="out-btn out-btn--neg" type="button"><span className="out-btn__i"><Icon name="clock" /></span>À relancer</button>
        </div>
      </aside>
    </div>
  );
}

function NewDealForm({
  investorId,
  onCreated,
}: {
  investorId: string;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<"pipeline" | "manual">("pipeline");
  const [form, setForm] = useState({
    deal_name: "",
    stage: "prospect",
    pipeline_deal_id: "",
    ticket_size_cad: "",
    expected_close_at: "",
    probability_pct: "",
    notes: "",
  });
  const [pipelineQuery, setPipelineQuery] = useState("");
  const [pipelineDeals, setPipelineDeals] = useState<PipelineDeal[]>([]);
  const [selectedPipelineDeal, setSelectedPipelineDeal] = useState<PipelineDeal | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = pipelineQuery.trim();

    const timer = window.setTimeout(async () => {
      setPipelineLoading(true);
      try {
        const query = q ? `?q=${encodeURIComponent(q)}&limit=20` : "?limit=20";
        const r = await fetch(`/api/deals${query}`);
        const j = await r.json();
        if (j.ok) {
          setPipelineDeals(
            (j.data as PipelineDeal[]).filter((deal) => !["cloture", "abandonne"].includes(deal.stage)),
          );
        }
      } finally {
        setPipelineLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [mode, pipelineQuery]);

  function selectPipelineDeal(deal: PipelineDeal) {
    setSelectedPipelineDeal(deal);
    setForm((prev) => ({
      ...prev,
      pipeline_deal_id: deal.id,
      deal_name: prev.deal_name || deal.title,
    }));
    setPipelineQuery(pipelineDealLabel(deal));
    setPipelineDeals([]);
  }
  function clearPipelineDeal() {
    setSelectedPipelineDeal(null);
    setForm((prev) => ({ ...prev, pipeline_deal_id: "", deal_name: mode === "pipeline" ? "" : prev.deal_name }));
    setPipelineQuery("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = { ...form };
      for (const k of Object.keys(payload)) if (payload[k] === "") payload[k] = null;
      if (payload.ticket_size_cad) payload.ticket_size_cad = Number(payload.ticket_size_cad);
      if (payload.probability_pct) payload.probability_pct = Number(payload.probability_pct);
      const r = await fetch(`/api/investors/${investorId}/deals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Erreur");
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 space-y-3"
    >
      <div className="inline-flex rounded-lg border border-zinc-300 bg-white p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode("pipeline")}
          className={`rounded-md px-3 py-1.5 ${mode === "pipeline" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50"}`}
        >
          Lier un deal pipeline
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("manual");
            clearPipelineDeal();
          }}
          className={`rounded-md px-3 py-1.5 ${mode === "manual" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50"}`}
        >
          Créer sans pipeline
        </button>
      </div>

      {mode === "pipeline" && (
        <div className="rounded-xl border border-zinc-200 bg-white p-3 space-y-3">
          <div className="relative">
            <input
              value={pipelineQuery}
              onChange={(e) => {
                setPipelineQuery(e.target.value);
                setSelectedPipelineDeal(null);
                setForm((prev) => ({ ...prev, pipeline_deal_id: "", deal_name: "" }));
              }}
              placeholder="Chercher par nom, adresse ou contact du deal"
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            />
            {pipelineLoading && <div className="mt-2 text-sm text-zinc-400">Recherche des deals actifs…</div>}
            {!pipelineLoading && !selectedPipelineDeal && pipelineDeals.length > 0 && (
              <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-zinc-200 bg-white">
                {pipelineDeals.map((deal) => (
                  <button
                    key={deal.id}
                    type="button"
                    onClick={() => selectPipelineDeal(deal)}
                    className="block w-full border-b border-zinc-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-zinc-50"
                  >
                    <span className="font-medium text-zinc-900">{deal.title}</span>
                    <span className="ml-2 text-zinc-500">{deal.address ?? "Sans adresse"}</span>
                    <span className="ml-2 text-xs uppercase text-zinc-400">{deal.stage}</span>
                  </button>
                ))}
              </div>
            )}
            {!pipelineLoading && !selectedPipelineDeal && pipelineDeals.length === 0 && (
              <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
                Aucun deal actif trouvé.
              </div>
            )}
          </div>
          {selectedPipelineDeal && (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-emerald-950">{selectedPipelineDeal.title}</div>
                <div className="text-emerald-800">
                  {[selectedPipelineDeal.address, selectedPipelineDeal.units ? `${selectedPipelineDeal.units} portes` : null, selectedPipelineDeal.stage].filter(Boolean).join(" · ")}
                </div>
              </div>
              <button
                type="button"
                onClick={clearPipelineDeal}
                className="text-xs font-medium text-emerald-900 hover:text-emerald-950"
              >
                Changer
              </button>
            </div>
          )}
        </div>
      )}

      {mode === "manual" && (
        <input
          required={mode === "manual"}
          value={form.deal_name}
          onChange={(e) => setForm({ ...form, deal_name: e.target.value })}
          placeholder="Nom du deal *"
          className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        <select
          value={form.stage}
          onChange={(e) => setForm({ ...form, stage: e.target.value })}
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        >
          {Object.entries(STAGE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          type="number"
          value={form.ticket_size_cad}
          onChange={(e) => setForm({ ...form, ticket_size_cad: e.target.value })}
          placeholder="Ticket investisseur (CAD)"
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <input
          type="date"
          value={form.expected_close_at}
          onChange={(e) => setForm({ ...form, expected_close_at: e.target.value })}
          className="col-span-2 border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        />
        <input
          type="number"
          min="0"
          max="100"
          value={form.probability_pct}
          onChange={(e) => setForm({ ...form, probability_pct: e.target.value })}
          placeholder="Probabilité %"
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <textarea
        rows={2}
        value={form.notes}
        onChange={(e) => setForm({ ...form, notes: e.target.value })}
        placeholder="Notes"
        className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
      />
      {err && <div className="text-sm text-red-600">{err}</div>}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy || (mode === "pipeline" && !form.pipeline_deal_id)}
          className="bg-zinc-900 text-white text-sm rounded-lg px-3 py-2 disabled:opacity-50"
        >
          {busy ? "Création…" : mode === "pipeline" ? "Lier à l'investisseur" : "Créer"}
        </button>
      </div>
    </form>
  );
}

function DealCard({
  deal,
  investorId,
  onChange,
}: {
  deal: Deal;
  investorId: string;
  onChange: () => void;
}) {
  const [stage, setStage] = useState(deal.stage);
  const pipeline = deal.pipeline_deal;

  async function updateStage(next: string) {
    setStage(next);
    await fetch(`/api/investors/${investorId}/deals/${deal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: next }),
    });
    onChange();
  }
  async function remove() {
    if (!confirm("Supprimer ce deal ?")) return;
    await fetch(`/api/investors/${investorId}/deals/${deal.id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <article className="deal-card">
      <header className="deal-card__head">
        <select
          value={stage}
          onChange={(e) => updateStage(e.target.value)}
          className="deal-stage-select"
          aria-label="Stade du deal"
        >
          {Object.entries(STAGE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 className="deal-card__title">{deal.deal_name}</h3>
          {pipeline && (
            <div className="deal-card__title__sub">
              {[pipeline.address, pipeline.units ? `${pipeline.units} logements` : null].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <span className="deal-card__temp">{pipeline?.temperature ?? "Tiède"}{pipeline?.priority ? ` · ${pipeline.priority}` : ""}</span>
      </header>

      {pipeline && (
        <div className="deal-card__price-row">
          <DealStat label="Adresse" value={pipeline.address ?? "—"} />
          <DealStat label="Portes" value={pipeline.units != null ? String(pipeline.units) : "—"} />
          <DealStat label="Prix demandé" value={fmtMoney(pipeline.asking_price)} />
          <DealStat label="Offre" value={fmtMoney(pipeline.offer_price)} />
          <DealStat label="Stade pipeline" value={pipeline.stage} />
          <DealStat label="Température" value={pipeline.temperature ?? "—"} />
          <DealStat label="Priorité" value={pipeline.priority ?? "—"} />
          <DealStat label="Ticket invest." value={fmtMoney(deal.ticket_size_cad)} />
        </div>
      )}

      <div className="deal-card__body">
        <div className="deal-card__contact">
          <div className="deal-card__notes-h">Contact vendeur</div>
          <div className="deal-card__contact__name">{pipeline?.contact_name ?? "—"}</div>
          <div className="deal-card__contact__data mono">
            {[pipeline?.contact_phone, pipeline?.contact_email].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <div>
          {pipeline?.next_action && (
            <>
              <div className="deal-card__notes-h">Prochaine action</div>
              <p className="deal-card__notes">{pipeline.next_action}</p>
            </>
          )}

          {pipeline?.notes_deal && (
            <>
              <div className="deal-card__notes-h" style={{ marginTop: 14 }}>Notes du deal</div>
              <p className="deal-card__notes">{pipeline.notes_deal}</p>
            </>
          )}

          {pipeline?.notes_vendeur && (
            <>
              <div className="deal-card__notes-h" style={{ marginTop: 14 }}>Notes vendeur</div>
              <p className="deal-card__notes">{pipeline.notes_vendeur}</p>
            </>
          )}
          {deal.notes && <p className="deal-card__notes">{deal.notes}</p>}
        </div>
      </div>

      <footer className="deal-card__foot" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {pipeline ? (
          <Link href={`/pipeline/${pipeline.id}` as never}>Ouvrir le deal pipeline <Icon name="arrowRight" /></Link>
        ) : <span className="socle-muted">Deal manuel</span>}
        <button onClick={remove} type="button" className="btn btn--ghost btn--sm">
          Supprimer
        </button>
      </footer>
    </article>
  );
}

function DealStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ki">
      <div className="ki__l">{label}</div>
      <div className="ki__v">{value}</div>
    </div>
  );
}

// ── Notes tab ──────────────────────────────────────────────────────────────
function NotesTab({ investorId }: { investorId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/investors/${investorId}/notes`);
    const j = await r.json();
    setLoading(false);
    if (j.ok) setNotes(j.data);
  }, [investorId]);
  useEffect(() => { reload(); }, [reload]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    await fetch(`/api/investors/${investorId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setBody("");
    setBusy(false);
    reload();
  }
  async function remove(id: string) {
    if (!confirm("Supprimer cette note ?")) return;
    await fetch(`/api/investors/${investorId}/notes/${id}`, { method: "DELETE" });
    reload();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 space-y-2">
        <textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Note libre (markdown OK)…"
          className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        />
        <div className="flex justify-end">
          <button
            disabled={busy || !body.trim()}
            type="submit"
            className="bg-zinc-900 text-white text-sm rounded-lg px-3 py-1.5 disabled:opacity-50"
          >
            Ajouter
          </button>
        </div>
      </form>

      {loading && <div className="text-zinc-400 text-sm p-4">Chargement…</div>}
      {!loading && notes.length === 0 && (
        <div className="text-zinc-400 text-sm p-8 bg-white rounded-2xl border border-zinc-200 text-center">
          Aucune note pour cet investisseur.
        </div>
      )}

      {notes.map((n) => (
        <article key={n.id} className="bg-white rounded-2xl border border-zinc-200 p-4">
          <div className="flex items-center text-xs text-zinc-500 mb-2">
            <span>{fmtDate(n.created_at)}</span>
            <button
              type="button"
              onClick={() => remove(n.id)}
              className="ml-auto text-red-500 hover:text-red-700"
            >
              Supprimer
            </button>
          </div>
          <pre className="text-sm whitespace-pre-wrap font-sans">{n.body}</pre>
        </article>
      ))}
    </div>
  );
}

// ── Edit tab ───────────────────────────────────────────────────────────────
function EditTab({
  investor,
  onSaved,
}: {
  investor: Investor;
  onSaved: (next: Investor) => void;
}) {
  const [form, setForm] = useState(investor);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/investors/${investor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Erreur");
      onSaved(form);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function set<K extends keyof Investor>(key: K, value: Investor[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form onSubmit={save} className="bg-white rounded-2xl border border-zinc-200 p-5 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <input
          value={form.full_name}
          onChange={(e) => set("full_name", e.target.value)}
          placeholder="Nom complet"
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        />
        <input
          value={form.firm_name ?? ""}
          onChange={(e) => set("firm_name", e.target.value || null)}
          placeholder="Firme"
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input
          value={form.email ?? ""}
          onChange={(e) => set("email", e.target.value || null)}
          placeholder="Email"
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        />
        <input
          value={form.phone_e164 ?? ""}
          onChange={(e) => set("phone_e164", e.target.value || null)}
          placeholder="+15145551234"
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input
          value={form.city ?? ""}
          onChange={(e) => set("city", e.target.value || null)}
          placeholder="Ville"
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        />
        <select
          value={form.status}
          onChange={(e) => set("status", e.target.value)}
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="prospect">Prospect</option>
          <option value="active">Actif</option>
          <option value="inactive">Inactif</option>
          <option value="lost">Perdu</option>
        </select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <input
          type="number"
          value={form.capital_available_cad ?? ""}
          onChange={(e) =>
            set("capital_available_cad", e.target.value ? Number(e.target.value) : null)
          }
          placeholder="Capital dispo"
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        />
        <input
          type="number"
          value={form.ticket_size_min_cad ?? ""}
          onChange={(e) =>
            set("ticket_size_min_cad", e.target.value ? Number(e.target.value) : null)
          }
          placeholder="Ticket min"
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        />
        <input
          type="number"
          value={form.ticket_size_max_cad ?? ""}
          onChange={(e) =>
            set("ticket_size_max_cad", e.target.value ? Number(e.target.value) : null)
          }
          placeholder="Ticket max"
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <input
        value={form.preferred_geography ?? ""}
        onChange={(e) => set("preferred_geography", e.target.value || null)}
        placeholder="Géographie préférée"
        className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
      />
      <input
        value={form.asset_class_focus ?? ""}
        onChange={(e) => set("asset_class_focus", e.target.value || null)}
        placeholder="Focus actif"
        className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
      />
      <textarea
        rows={4}
        value={form.notes ?? ""}
        onChange={(e) => set("notes", e.target.value || null)}
        placeholder="Notes"
        className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
      />
      {err && <div className="text-sm text-red-600">{err}</div>}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="bg-zinc-900 text-white text-sm rounded-lg px-4 py-2 disabled:opacity-50"
        >
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}
