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
};

type Deal = {
  id: string;
  deal_name: string;
  stage: string;
  property_id: string | null;
  ticket_size_cad: number | null;
  expected_close_at: string | null;
  probability_pct: number | null;
  notes: string | null;
  updated_at: string;
  properties?: { id: string; address: string | null; city: string | null; num_units: number | null } | null;
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

export default function InvestorDetailClient({
  initialInvestor,
}: {
  initialInvestor: Investor;
}) {
  const [investor, setInvestor] = useState<Investor>(initialInvestor);
  const [tab, setTab] = useState<"calls" | "deals" | "notes" | "edit">("calls");

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <Link href={"/investisseurs" as never} className="text-sm text-zinc-500 hover:underline">
          ← Investisseurs
        </Link>
        <div className="mt-2 flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">{investor.full_name}</h1>
          {investor.firm_name && (
            <span className="text-base text-zinc-500">— {investor.firm_name}</span>
          )}
          <span className="ml-auto text-xs uppercase tracking-wide rounded px-1.5 py-0.5 bg-zinc-100">
            {investor.status}
          </span>
        </div>
        <SummaryGrid investor={investor} />
      </header>

      <nav className="flex gap-1 border-b border-zinc-200 mb-4">
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
            className={`px-4 py-2 text-sm border-b-2 ${
              tab === key
                ? "border-zinc-900 font-semibold text-zinc-900"
                : "border-transparent text-zinc-500 hover:text-zinc-800"
            }`}
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
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
      <Stat label="Capital dispo" value={fmtMoney(investor.capital_available_cad)} />
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-sm mt-0.5">{value}</div>
    </div>
  );
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
        body: JSON.stringify({ call_sid: sid.trim() }),
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
        placeholder="CA1690ea5f… (Twilio Call SID)"
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
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowNew((v) => !v)}
          className="text-sm border border-zinc-300 rounded-lg px-3 py-1.5 hover:bg-zinc-50"
        >
          {showNew ? "Annuler" : "+ Nouveau deal"}
        </button>
      </div>
      {showNew && (
        <NewDealForm
          investorId={investorId}
          onCreated={() => { setShowNew(false); reload(); }}
        />
      )}

      {loading && <div className="text-zinc-400 text-sm p-4">Chargement…</div>}
      {!loading && deals.length === 0 && (
        <div className="text-zinc-400 text-sm p-8 bg-white rounded-2xl border border-zinc-200 text-center">
          Aucun deal pour cet investisseur.
        </div>
      )}

      {deals.map((d) => (
        <DealCard key={d.id} deal={d} investorId={investorId} onChange={reload} />
      ))}
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
  const [form, setForm] = useState({
    deal_name: "",
    stage: "prospect",
    ticket_size_cad: "",
    expected_close_at: "",
    probability_pct: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      <div className="grid grid-cols-2 gap-3">
        <input
          required
          value={form.deal_name}
          onChange={(e) => setForm({ ...form, deal_name: e.target.value })}
          placeholder="Nom du deal *"
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        />
        <select
          value={form.stage}
          onChange={(e) => setForm({ ...form, stage: e.target.value })}
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        >
          {Object.entries(STAGE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <input
          type="number"
          value={form.ticket_size_cad}
          onChange={(e) => setForm({ ...form, ticket_size_cad: e.target.value })}
          placeholder="Ticket (CAD)"
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={form.expected_close_at}
          onChange={(e) => setForm({ ...form, expected_close_at: e.target.value })}
          className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
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
          disabled={busy}
          className="bg-zinc-900 text-white text-sm rounded-lg px-3 py-2 disabled:opacity-50"
        >
          {busy ? "Création…" : "Créer"}
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
    <article className="bg-white rounded-2xl border border-zinc-200 p-4">
      <header className="flex items-center gap-2">
        <h3 className="font-semibold">{deal.deal_name}</h3>
        <select
          value={stage}
          onChange={(e) => updateStage(e.target.value)}
          className="ml-2 text-xs border border-zinc-300 rounded px-1.5 py-0.5"
        >
          {Object.entries(STAGE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <span className="ml-auto text-sm text-zinc-500">{fmtMoney(deal.ticket_size_cad)}</span>
        <button onClick={remove} type="button" className="text-xs text-red-500 hover:text-red-700">
          Supprimer
        </button>
      </header>
      <div className="mt-2 text-sm text-zinc-600 flex gap-4">
        {deal.properties && (
          <span>
            Propriété :{" "}
            <Link
              href={`/properties/${deal.properties.id}` as never}
              className="text-zinc-900 underline"
            >
              {deal.properties.address ?? "—"}
            </Link>
          </span>
        )}
        {deal.expected_close_at && (
          <span>Clôture prévue : {deal.expected_close_at}</span>
        )}
        {deal.probability_pct != null && <span>Probabilité : {deal.probability_pct}%</span>}
      </div>
      {deal.notes && <p className="mt-2 text-sm whitespace-pre-wrap">{deal.notes}</p>}
    </article>
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
