"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
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

type Counts = {
  deals: number | null;
  negotiating: number | null;
  calls: number | null;
  notes: number | null;
  callsThisMonth: number | null;
  lastCall: Call | null;
};

type TabKey = "deals" | "calls" | "notes" | "criteria";

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
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

function fmtMoneyLong(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n);
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

function splitTags(value: string | null): string[] {
  return (value ?? "")
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export default function InvestorDetailClient({
  initialInvestor,
}: {
  initialInvestor: Investor;
}) {
  const [investor, setInvestor] = useState<Investor>(initialInvestor);
  const [tab, setTab] = useState<TabKey>("deals");
  const [counts, setCounts] = useState<Counts>({
    deals: null,
    negotiating: null,
    calls: null,
    notes: null,
    callsThisMonth: null,
    lastCall: null,
  });

  const reloadCounts = useCallback(async () => {
    const [dealsRes, callsRes, notesRes] = await Promise.all([
      fetch(`/api/investors/${investor.id}/deals`),
      fetch(`/api/investors/${investor.id}/calls`),
      fetch(`/api/investors/${investor.id}/notes`),
    ]);
    const [dealsJson, callsJson, notesJson] = await Promise.all([
      dealsRes.json(),
      callsRes.json(),
      notesRes.json(),
    ]);

    const deals = dealsJson.ok ? (dealsJson.data as Deal[]) : [];
    const calls = callsJson.ok ? (callsJson.data as Call[]) : [];
    const notes = notesJson.ok ? (notesJson.data as Note[]) : [];
    const now = new Date();

    setCounts({
      deals: deals.length,
      negotiating: deals.filter((deal) => ["discussing", "loi", "due_diligence", "financing"].includes(deal.stage)).length,
      calls: calls.length,
      notes: notes.length,
      callsThisMonth: calls.filter((call) => {
        const date = call.started_at ?? call.created_at;
        if (!date) return false;
        const parsed = new Date(date);
        return parsed.getMonth() === now.getMonth() && parsed.getFullYear() === now.getFullYear();
      }).length,
      lastCall: calls[0] ?? null,
    });
  }, [investor.id]);

  useEffect(() => {
    reloadCounts();
  }, [reloadCounts]);

  return (
    <main className="invd-main">
      <div className="invd-topbar">
        <div className="invd-crumbs">
          <Link href={"/investisseurs" as never}>Investisseurs</Link>
          <span className="invd-crumbs__sep">/</span>
          <span>{investor.full_name}</span>
        </div>
        <div className="invd-topbar__nav">
          <Link href={"/investisseurs" as never} className="btn">
            <Icon name="chevronLeft" /> Retour
          </Link>
        </div>
      </div>

      <section className="invd-hero">
        <div className="invd-hero__avatar">{initials(investor.full_name)}</div>
        <div className="invd-hero__body">
          <div className="invd-hero__pills">
            <InvestorStatus status={investor.status} />
            {investor.source ? <span className="pill pill--brand">{investor.source}</span> : null}
          </div>
          <h1 className="invd-hero__name">{investor.full_name}</h1>
          <div className="invd-hero__firm">
            {investor.firm_name ?? "—"}
            {investor.city ? <> · <em>{investor.city}</em></> : null}
          </div>
          <div className="invd-hero__contact">
            {investor.email ? (
              <a href={`mailto:${investor.email}`}>
                <Icon name="mail" /> {investor.email}
              </a>
            ) : (
              <span><Icon name="mail" /> —</span>
            )}
            {investor.phone_e164 ? (
              <a href={`tel:${investor.phone_e164.replace(/\D/g, "")}`}>
                <Icon name="phone" /> <span className="mono">{investor.phone_e164}</span>
              </a>
            ) : (
              <span><Icon name="phone" /> —</span>
            )}
            <span><Icon name="message" /> Telegram —</span>
          </div>
        </div>
        <div className="invd-hero__acts">
          <button className="btn" type="button" onClick={() => setTab("deals")}>
            <Icon name="trending" /> Deals
          </button>
          <button className="btn btn--gold" type="button" onClick={() => setTab("criteria")}>
            <Icon name="plus" /> Critères
          </button>
        </div>
      </section>

      <SummaryGrid investor={investor} counts={counts} />

      <div className="invd-grid">
        <section className="invd-panel">
          <nav className="invd-tabs-row" aria-label="Sections investisseur">
            {(
              [
                ["deals", "Deals", counts.deals],
                ["calls", "Appels", counts.calls],
                ["notes", "Notes", counts.notes],
                ["criteria", "Critères", null],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`invd-tab ${tab === key ? "invd-tab--active" : ""}`}
              >
                {label}
                {count != null ? <span className="invd-tab__c">{count}</span> : null}
              </button>
            ))}
          </nav>
          <div className="invd-panel__body">
            {tab === "deals" && <DealsTab investorId={investor.id} onChanged={reloadCounts} />}
            {tab === "calls" && <CallsTab investorId={investor.id} onChanged={reloadCounts} />}
            {tab === "notes" && <NotesTab investorId={investor.id} onChanged={reloadCounts} />}
            {tab === "criteria" && (
              <EditTab investor={investor} onSaved={(next) => setInvestor(next)} />
            )}
          </div>
        </section>

        <aside className="invd-aside">
          <CriteriaPanel investor={investor} onEdit={() => setTab("criteria")} />
          <MatchingPanel investor={investor} />
          <LastTouch call={counts.lastCall} />
        </aside>
      </div>
    </main>
  );
}

function SummaryGrid({ investor, counts }: { investor: Investor; counts: Counts }) {
  const ticket =
    investor.ticket_size_min_cad && investor.ticket_size_max_cad
      ? `${fmtMoney(investor.ticket_size_min_cad)} – ${fmtMoney(investor.ticket_size_max_cad)}`
      : investor.ticket_size_max_cad
      ? `≤ ${fmtMoney(investor.ticket_size_max_cad)}`
      : investor.ticket_size_min_cad
      ? `≥ ${fmtMoney(investor.ticket_size_min_cad)}`
      : "—";

  const capitalSub =
    investor.capital_available_cad && investor.ticket_size_max_cad
      ? `${Math.round((investor.capital_available_cad / investor.ticket_size_max_cad) * 100)}% du ticket max`
      : "—";

  return (
    <div className="invd-kpi-strip">
      <Stat hero label="Capital disponible" value={fmtMoney(investor.capital_available_cad)} sub={capitalSub} />
      <Stat label="Ticket" value={ticket} sub="par transaction" />
      <Stat label="Deals liés" value={counts.deals == null ? "—" : String(counts.deals)} sub={`${counts.negotiating ?? "—"} en cours`} />
      <Stat label="Appels" value={counts.calls == null ? "—" : String(counts.calls)} sub={`${counts.callsThisMonth ?? "—"} ce mois`} />
      <Stat criteria label="Focus actif" value={investor.asset_class_focus ?? "—"} sub={investor.asset_class_focus ? "Critère enregistré" : "Critère manquant"} />
    </div>
  );
}

function Stat({ label, value, sub, hero, criteria }: { label: string; value: string; sub?: string; hero?: boolean; criteria?: boolean }) {
  return (
    <div className={`invd-ki ${hero ? "invd-ki--hero" : ""} ${criteria ? "invd-ki--criteria" : ""}`}>
      <div className="invd-ki__l">{label}</div>
      <div className="invd-ki__v">{value}</div>
      {sub ? <div className="invd-ki__sub">{sub}</div> : null}
    </div>
  );
}

function CriteriaPanel({ investor, onEdit }: { investor: Investor; onEdit: () => void }) {
  const geos = splitTags(investor.preferred_geography);
  return (
    <div className="invd-panel invd-criteria-card">
      <div className="invd-panel__head">
        <div className="invd-panel__t">Critères d&apos;investissement</div>
        <button className="btn btn--sm" type="button" onClick={onEdit}>
          <Icon name="edit" /> Modifier
        </button>
      </div>
      <CritRow label="Capital total" value={<span className="mono">{fmtMoneyLong(investor.capital_available_cad)}</span>} />
      <CritRow label="Ticket min" value={<span className="mono">{fmtMoneyLong(investor.ticket_size_min_cad)}</span>} />
      <CritRow label="Ticket max" value={<span className="mono">{fmtMoneyLong(investor.ticket_size_max_cad)}</span>} />
      <CritRow
        label="Géographie"
        value={
          geos.length ? (
            <div className="invd-crit-tags">
              {geos.map((geo) => <span key={geo} className="invd-crit-tags__tag">{geo}</span>)}
            </div>
          ) : "—"
        }
      />
      <CritRow label="Focus actif" value={investor.asset_class_focus ?? "—"} />
      <CritRow label="Source" value={investor.source ?? "—"} />
    </div>
  );
}

function CritRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="invd-crit-row">
      <div className="invd-crit-row__l">{label}</div>
      <div className="invd-crit-row__v">{value}</div>
    </div>
  );
}

function MatchingPanel({ investor }: { investor: Investor }) {
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const r = await fetch("/api/deals?limit=100");
      const j = await r.json();
      if (active) {
        setDeals(j.ok ? (j.data as PipelineDeal[]) : []);
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const matches = useMemo(() => {
    return deals
      .map((deal) => ({ deal, score: computeMatchScore(investor, deal) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [deals, investor]);

  return (
    <div className="invd-panel invd-match-card">
      <div className="invd-panel__head">
        <div className="invd-panel__t">Deals qui matchent</div>
        <span className="pill pill--brand">{loading ? "—" : `${matches.length} trouvés`}</span>
      </div>
      {loading ? <div className="invd-empty">Chargement…</div> : null}
      {!loading && matches.length === 0 ? <div className="invd-empty">—</div> : null}
      {matches.map(({ deal, score }) => {
        const equity = estimatedEquity(deal);
        return (
          <Link key={deal.id} href={`/pipeline/${deal.id}` as never} className="invd-match">
            <div className={`invd-match__score ${score < 85 ? "invd-match__score--mid" : ""}`}>
              {score}<span className="invd-match__score__l">MATCH</span>
            </div>
            <div>
              <div className="invd-match__t">{deal.title}</div>
              <div className="invd-match__sub">
                {[deal.units ? `${deal.units} log.` : null, deal.contact_name, deal.stage].filter(Boolean).join(" · ") || "—"}
              </div>
              <div className="invd-match__data">
                {[fmtMoney(deal.offer_price ?? deal.asking_price), `MEP ${fmtMoney(equity)}`, deal.address ?? "—"].join(" · ")}
              </div>
            </div>
          </Link>
        );
      })}
      <div className="invd-muted">Score calculé via géographie + ticket overlap.</div>
    </div>
  );
}

function LastTouch({ call }: { call: Call | null }) {
  return (
    <div className="invd-last-touch">
      <div className="invd-last-touch__icon"><Icon name="phone" /></div>
      <div>
        <div className="invd-last-touch__t">Dernier appel</div>
        <div className="invd-last-touch__sub">{call?.summary ?? call?.outcome ?? "—"}</div>
      </div>
      <span className="invd-last-touch__time">{call ? fmtDate(call.started_at ?? call.created_at) : "—"}</span>
    </div>
  );
}

function computeMatchScore(investor: Investor, deal: PipelineDeal): number {
  const geos = splitTags(investor.preferred_geography).map((geo) => geo.toLowerCase());
  const haystack = `${deal.address ?? ""} ${deal.title ?? ""}`.toLowerCase();
  const geoScore = geos.length > 0 && geos.some((geo) => haystack.includes(geo)) ? 45 : 0;

  const equity = estimatedEquity(deal);
  const min = investor.ticket_size_min_cad ?? 0;
  const max = investor.ticket_size_max_cad ?? investor.capital_available_cad ?? 0;
  const ticketScore = equity != null && max > 0 && equity >= min && equity <= max ? 45 : 0;
  const focusScore = investor.asset_class_focus && deal.units != null ? 10 : 0;

  return geoScore + ticketScore + focusScore;
}

function estimatedEquity(deal: PipelineDeal): number | null {
  const price = deal.offer_price ?? deal.asking_price;
  return price == null ? null : Math.round(price * 0.2);
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
  const paths: Record<string, ReactNode> = {
    arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
    chevronLeft: <path d="M15 18l-6-6 6-6" />,
    mail: <path d="M4 6h16v12H4zM4 7l8 6 8-6" />,
    phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
    check: <path d="M20 6L9 17l-5-5" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    map: <path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3zM9 3v15M15 6v15" />,
    message: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3H13a8.5 8.5 0 0 1 8 8v.5z" />,
    trending: <path d="M3 17l6-6 4 4 8-8M14 7h7v7" />,
    plus: <path d="M12 4v16M4 12h16" />,
    edit: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
    trash: <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function CallsTab({ investorId, onChanged }: { investorId: string; onChanged: () => void }) {
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
  useEffect(() => {
    const processing = calls.some((c) => c.transcript_status === "processing");
    if (!processing) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [calls, reload]);

  return (
    <div className="invd-stack">
      <div className="invd-panel__head">
        <div className="invd-panel__t">Appels investisseur</div>
        <button type="button" onClick={() => setShowAttach((v) => !v)} className="btn btn--sm">
          {showAttach ? "Annuler" : "Rattacher un appel Twilio"}
        </button>
      </div>
      {showAttach && <AttachTwilio investorId={investorId} onAttached={() => { setShowAttach(false); reload(); onChanged(); }} />}
      {loading && <div className="invd-empty">Chargement…</div>}
      {!loading && calls.length === 0 && <div className="invd-empty">Aucun appel pour cet investisseur.</div>}
      {calls.map((call) => (
        <CallCard key={call.id} call={call} investorId={investorId} onChange={() => { reload(); onChanged(); }} />
      ))}
    </div>
  );
}

function AttachTwilio({ investorId, onAttached }: { investorId: string; onAttached: () => void }) {
  const [sid, setSid] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
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
    <form onSubmit={submit} className="invd-form">
      <input value={sid} onChange={(e) => setSid(e.target.value)} placeholder="CA… Call SID ou RE… Recording SID" className="invd-field mono" required />
      {err ? <div className="invd-danger">{err}</div> : null}
      <div className="invd-inline-actions">
        <button type="submit" disabled={busy || !sid} className="btn btn--primary">
          {busy ? "Rattachement…" : "Rattacher + transcrire"}
        </button>
      </div>
    </form>
  );
}

function CallCard({ call, investorId, onChange }: { call: Call; investorId: string; onChange: () => void }) {
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

  async function attachRecordingSid(e: FormEvent) {
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
    <article className="invd-call-card">
      <header className="invd-call-card__head">
        <span className="pill pill--review">{call.direction ?? "manuel"}</span>
        <span>{fmtDate(call.started_at ?? call.created_at)}</span>
        <span>{fmtDuration(call.duration_sec)}</span>
        <span className="mono">{shortSid(call.twilio_call_sid)}</span>
        <button type="button" onClick={() => setEditing((v) => !v)} className="btn btn--sm">
          {editing ? "Annuler" : "Modifier"}
        </button>
        <button type="button" onClick={remove} className="btn btn--sm">
          <Icon name="trash" /> Supprimer
        </button>
      </header>

      <div>
        <div className="invd-label">Transcription <span className="invd-muted">({call.transcript_status ?? "—"})</span></div>
        {call.transcript_status === "processing" ? <div className="invd-muted">Whisper traite l&apos;enregistrement…</div> : null}
        {call.transcript_status === "failed" ? <div className="invd-danger">La transcription a échoué.</div> : null}
        {call.transcript_status === "skipped" ? (
          <form onSubmit={attachRecordingSid} className="invd-form">
            <div>Aucun enregistrement trouvé automatiquement pour {shortSid(call.twilio_call_sid)}.</div>
            <input value={recordingSid} onChange={(e) => setRecordingSid(e.target.value)} placeholder="Recording SID RE…" className="invd-field mono" />
            <div className="invd-inline-actions">
              {call.twilio_call_sid ? (
                <button type="button" onClick={retryTranscript} disabled={retrying} className="btn btn--sm">
                  {retrying ? "Recherche…" : "Réessayer"}
                </button>
              ) : null}
              <button type="submit" disabled={retrying || !recordingSid.trim()} className="btn btn--primary">
                Transcrire ce recording
              </button>
            </div>
            {retryErr ? <span className="invd-danger">{retryErr}</span> : null}
          </form>
        ) : null}
        {call.transcript ? <pre className="invd-pre">{call.transcript}</pre> : null}
        {!call.transcript && call.transcript_status === "completed" ? <div className="invd-muted">(transcription vide)</div> : null}
      </div>

      <div className="invd-call-card__section">
        <div>
          <div className="invd-label">Résumé</div>
          {editing ? <textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} className="invd-field" /> : <div>{call.summary ?? "—"}</div>}
        </div>
        <div>
          <div className="invd-label">Résultat</div>
          {editing ? <input value={outcome} onChange={(e) => setOutcome(e.target.value)} className="invd-field" /> : <div>{call.outcome ?? "—"}</div>}
        </div>
      </div>

      {editing ? (
        <div className="invd-inline-actions">
          <button type="button" onClick={save} className="btn btn--primary">Enregistrer</button>
        </div>
      ) : null}
    </article>
  );
}

function DealsTab({ investorId, onChanged }: { investorId: string; onChanged: () => void }) {
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
    <div>
      <div className="invd-panel__head">
        <div className="invd-panel__t">Pipeline · {loading ? "—" : deals.length} deals partagés</div>
        <button type="button" onClick={() => setShowNew((v) => !v)} className="btn btn--sm">
          <Icon name="plus" /> {showNew ? "Annuler" : "Lier un deal"}
        </button>
      </div>
      <div className="invd-deals">
        {showNew ? <NewDealForm investorId={investorId} onCreated={() => { setShowNew(false); reload(); onChanged(); }} /> : null}
        {loading ? <div className="invd-empty">Chargement…</div> : null}
        {!loading && deals.length === 0 ? <div className="invd-empty">Aucun deal pour cet investisseur.</div> : null}
        {deals.map((deal) => <DealCard key={deal.id} deal={deal} investorId={investorId} onChange={() => { reload(); onChanged(); }} />)}
      </div>
    </div>
  );
}

function NewDealForm({ investorId, onCreated }: { investorId: string; onCreated: () => void }) {
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
        if (j.ok) setPipelineDeals((j.data as PipelineDeal[]).filter((deal) => !["cloture", "abandonne"].includes(deal.stage)));
      } finally {
        setPipelineLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [pipelineQuery]);

  function selectPipelineDeal(deal: PipelineDeal) {
    setSelectedPipelineDeal(deal);
    setForm((prev) => ({ ...prev, pipeline_deal_id: deal.id, deal_name: prev.deal_name || deal.title }));
    setPipelineQuery(pipelineDealLabel(deal));
    setPipelineDeals([]);
  }

  function clearPipelineDeal() {
    setSelectedPipelineDeal(null);
    setForm((prev) => ({ ...prev, pipeline_deal_id: "", deal_name: mode === "pipeline" ? "" : prev.deal_name }));
    setPipelineQuery("");
  }

  async function submit(e: FormEvent) {
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
    <form onSubmit={submit} className="invd-form">
      <div className="invd-hero__pills">
        <button type="button" onClick={() => setMode("pipeline")} className={`pill ${mode === "pipeline" ? "pill--ready" : "pill--review"}`}>Deal pipeline</button>
        <button type="button" onClick={() => { setMode("manual"); clearPipelineDeal(); }} className={`pill ${mode === "manual" ? "pill--ready" : "pill--review"}`}>Sans pipeline</button>
      </div>

      {mode === "pipeline" ? (
        <div className="invd-stack">
          <input value={pipelineQuery} onChange={(e) => { setPipelineQuery(e.target.value); setSelectedPipelineDeal(null); setForm((prev) => ({ ...prev, pipeline_deal_id: "", deal_name: "" })); }} placeholder="Chercher par nom, adresse ou contact du deal" className="invd-field" />
          {pipelineLoading ? <div className="invd-muted">Recherche des deals actifs…</div> : null}
          {!pipelineLoading && !selectedPipelineDeal && pipelineDeals.map((deal) => (
            <button key={deal.id} type="button" onClick={() => selectPipelineDeal(deal)} className="invd-match">
              <div className="invd-match__score invd-match__score--mid"><Icon name="check" /></div>
              <div>
                <div className="invd-match__t">{deal.title}</div>
                <div className="invd-match__sub">{[deal.address, deal.units ? `${deal.units} portes` : null, deal.stage].filter(Boolean).join(" · ") || "—"}</div>
              </div>
            </button>
          ))}
          {!pipelineLoading && !selectedPipelineDeal && pipelineDeals.length === 0 ? <div className="invd-empty">Aucun deal actif trouvé.</div> : null}
          {selectedPipelineDeal ? (
            <div className="invd-empty">
              {selectedPipelineDeal.title} · {selectedPipelineDeal.address ?? "—"}
              <button type="button" onClick={clearPipelineDeal} className="btn btn--sm">Changer</button>
            </div>
          ) : null}
        </div>
      ) : (
        <input required value={form.deal_name} onChange={(e) => setForm({ ...form, deal_name: e.target.value })} placeholder="Nom du deal" className="invd-field" />
      )}

      <div className="invd-form__grid">
        <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} className="invd-field">
          {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="number" value={form.ticket_size_cad} onChange={(e) => setForm({ ...form, ticket_size_cad: e.target.value })} placeholder="Ticket investisseur CAD" className="invd-field" />
      </div>
      <div className="invd-form__grid invd-form__grid--3">
        <input type="date" value={form.expected_close_at} onChange={(e) => setForm({ ...form, expected_close_at: e.target.value })} className="invd-field" />
        <input type="number" min="0" max="100" value={form.probability_pct} onChange={(e) => setForm({ ...form, probability_pct: e.target.value })} placeholder="Probabilité %" className="invd-field" />
        <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" className="invd-field" />
      </div>
      {err ? <div className="invd-danger">{err}</div> : null}
      <div className="invd-inline-actions">
        <button type="submit" disabled={busy || (mode === "pipeline" && !form.pipeline_deal_id)} className="btn btn--primary">
          {busy ? "Création…" : mode === "pipeline" ? "Lier à l'investisseur" : "Créer"}
        </button>
      </div>
    </form>
  );
}

function DealCard({ deal, investorId, onChange }: { deal: Deal; investorId: string; onChange: () => void }) {
  const [stage, setStage] = useState(deal.stage);
  const pipeline = deal.pipeline_deal;
  const equity = pipeline ? estimatedEquity(pipeline) : null;

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
    <article className="invd-deal-card">
      <header className="invd-deal-card__head">
        <select value={stage} onChange={(e) => updateStage(e.target.value)} className="invd-deal-stage-select" aria-label="Stade du deal">
          {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div>
          <h3 className="invd-deal-card__title">{deal.deal_name}</h3>
          {pipeline ? <div className="invd-deal-card__title__sub">{[pipeline.address, pipeline.units ? `${pipeline.units} logements` : null].filter(Boolean).join(" · ")}</div> : null}
        </div>
        <span className="invd-deal-card__temp">{[pipeline?.temperature, pipeline?.priority].filter(Boolean).join(" · ") || "—"}</span>
      </header>

      <div className="invd-deal-card__price-row">
        <DealStat label="Prix demandé" value={fmtMoney(pipeline?.asking_price ?? null)} />
        <DealStat label="Notre offre" value={fmtMoney(pipeline?.offer_price ?? null)} />
        <DealStat label="Mise de fonds" value={fmtMoney(equity)} />
        <DealStat label="Ticket investisseur" value={fmtMoney(deal.ticket_size_cad)} />
      </div>

      <div className="invd-deal-card__body">
        <div className="invd-deal-card__contact">
          <div className="invd-deal-card__contact__avatar">{initials(pipeline?.contact_name ?? "—")}</div>
          <div>
            <div className="invd-deal-card__contact__name">{pipeline?.contact_name ?? "—"}</div>
            <div className="invd-deal-card__contact__role">Vendeur</div>
          </div>
          <div className="invd-deal-card__contact__data">
            <span>{pipeline?.contact_phone ?? "—"}</span>
            <span>{pipeline?.contact_email ?? "—"}</span>
          </div>
        </div>

        <DealNotes title="Notes du deal" body={pipeline?.notes_deal ?? deal.notes} />
        <DealNotes title="Notes vendeur" body={pipeline?.notes_vendeur ?? null} />
        {pipeline?.next_action ? <DealNotes title="Prochaine action" body={pipeline.next_action} /> : null}
      </div>

      <footer className="invd-deal-card__foot">
        {pipeline ? (
          <Link href={`/pipeline/${pipeline.id}` as never}>
            Ouvrir le deal pipeline <Icon name="arrowRight" />
          </Link>
        ) : <span className="invd-muted">Deal manuel</span>}
        <div className="invd-deal-card__foot__menu">
          <button onClick={remove} type="button" className="btn btn--sm">
            <Icon name="trash" /> Supprimer
          </button>
        </div>
      </footer>
    </article>
  );
}

function DealStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="invd-dc-mini">
      <div className="invd-dc-mini__l">{label}</div>
      <div className={`invd-dc-mini__v ${value === "—" ? "invd-dc-mini__v--muted" : ""}`}>{value}</div>
    </div>
  );
}

function DealNotes({ title, body }: { title: string; body: string | null | undefined }) {
  return (
    <div>
      <div className="invd-deal-card__notes-h"><Icon name="edit" /> {title}</div>
      <p className="invd-deal-card__notes">{body ?? "—"}</p>
    </div>
  );
}

function NotesTab({ investorId, onChanged }: { investorId: string; onChanged: () => void }) {
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

  async function add(e: FormEvent) {
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
    onChanged();
  }

  async function remove(id: string) {
    if (!confirm("Supprimer cette note ?")) return;
    await fetch(`/api/investors/${investorId}/notes/${id}`, { method: "DELETE" });
    reload();
    onChanged();
  }

  return (
    <div className="invd-stack">
      <form onSubmit={add} className="invd-form">
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Note libre" className="invd-field" />
        <div className="invd-inline-actions">
          <button disabled={busy || !body.trim()} type="submit" className="btn btn--primary">Ajouter</button>
        </div>
      </form>
      {loading ? <div className="invd-empty">Chargement…</div> : null}
      {!loading && notes.length === 0 ? <div className="invd-empty">Aucune note pour cet investisseur.</div> : null}
      {notes.map((note) => (
        <article key={note.id} className="invd-note-card">
          <div className="invd-note-card__head">
            <span>{fmtDate(note.created_at)}</span>
            <button type="button" onClick={() => remove(note.id)} className="btn btn--sm"><Icon name="trash" /> Supprimer</button>
          </div>
          <pre className="invd-pre">{note.body}</pre>
        </article>
      ))}
    </div>
  );
}

function EditTab({ investor, onSaved }: { investor: Investor; onSaved: (next: Investor) => void }) {
  const [form, setForm] = useState(investor);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: FormEvent) {
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
    <form onSubmit={save} className="invd-form">
      <div className="invd-panel__head">
        <div className="invd-panel__t">Critères & modification</div>
      </div>
      <div className="invd-form__grid">
        <input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Nom complet" className="invd-field" />
        <input value={form.firm_name ?? ""} onChange={(e) => set("firm_name", e.target.value || null)} placeholder="Firme" className="invd-field" />
      </div>
      <div className="invd-form__grid">
        <input value={form.email ?? ""} onChange={(e) => set("email", e.target.value || null)} placeholder="Email" className="invd-field" />
        <input value={form.phone_e164 ?? ""} onChange={(e) => set("phone_e164", e.target.value || null)} placeholder="+15145551234" className="invd-field" />
      </div>
      <div className="invd-form__grid">
        <input value={form.city ?? ""} onChange={(e) => set("city", e.target.value || null)} placeholder="Ville" className="invd-field" />
        <select value={form.status} onChange={(e) => set("status", e.target.value)} className="invd-field">
          <option value="prospect">Prospect</option>
          <option value="active">Actif</option>
          <option value="inactive">Inactif</option>
          <option value="lost">Perdu</option>
        </select>
      </div>
      <div className="invd-form__grid invd-form__grid--3">
        <input type="number" value={form.capital_available_cad ?? ""} onChange={(e) => set("capital_available_cad", e.target.value ? Number(e.target.value) : null)} placeholder="Capital dispo" className="invd-field" />
        <input type="number" value={form.ticket_size_min_cad ?? ""} onChange={(e) => set("ticket_size_min_cad", e.target.value ? Number(e.target.value) : null)} placeholder="Ticket min" className="invd-field" />
        <input type="number" value={form.ticket_size_max_cad ?? ""} onChange={(e) => set("ticket_size_max_cad", e.target.value ? Number(e.target.value) : null)} placeholder="Ticket max" className="invd-field" />
      </div>
      <input value={form.preferred_geography ?? ""} onChange={(e) => set("preferred_geography", e.target.value || null)} placeholder="Géographie préférée" className="invd-field" />
      <input value={form.asset_class_focus ?? ""} onChange={(e) => set("asset_class_focus", e.target.value || null)} placeholder="Focus actif" className="invd-field" />
      <textarea rows={4} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} placeholder="Notes" className="invd-field" />
      {err ? <div className="invd-danger">{err}</div> : null}
      <div className="invd-inline-actions">
        <button type="submit" disabled={busy} className="btn btn--primary">
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}
