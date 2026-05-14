"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import TwilioCallStatePanel, { type CallState } from "@/app/calls/[leadId]/components/TwilioCallStatePanel";
import CallHistoryPanel from "@/app/calls/[leadId]/CallHistoryPanel";
import type { HistoryRow } from "@/app/calls/[leadId]/components/CallHistoryEntry";

// ── Types ─────────────────────────────────────────────────────────────────────
type CheckItem = { id: string; label: string; done: boolean };
export type DealDocument = { id: string; name: string; size: number | null; mime_type: string | null; created_at: string };
type Activity  = { id: string; text: string; time: string };
export type DealSmsMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  at: string;
  from: string;
  to: string;
};

export type Deal = {
  id: string;
  title: string;
  stage: string;
  address: string | null;
  units: number | null;
  asking_price: number | null;
  offer_price: number | null;
  temperature: string;
  priority: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  notes_deal: string | null;
  notes_vendeur: string | null;
  ai_analysis: string | null;
  next_action: string | null;
  checklists: Record<string, CheckItem[]>;
  activities: Activity[];
  lat: number | null;
  lng: number | null;
  created_at: string;
  updated_at: string;
};

export type DealDossier = {
  leads: Array<{
    lead_id: string;
    contact_id: string | null;
    property_id: string | null;
    address: string | null;
    city: string | null;
    num_units: number | null;
    evaluation_total: number | null;
    full_name: string | null;
    company_name: string | null;
    best_phone: string | null;
    status: string | null;
    priority: number | null;
    last_contacted_at: string | null;
    next_action_at: string | null;
  }>;
  submissions: Array<{
    id: string;
    lead_id: string;
    call_log_id: string | null;
    outcome: string | null;
    seller_interest_level: string | null;
    timeline: string | null;
    motivation: string | null;
    asking_price: number | null;
    property_info: string | null;
    condition_notes: string | null;
    objections: string | null;
    best_callback_time: string | null;
    caller_summary: string | null;
    recommended_action: string | null;
    status: string | null;
    created_at: string;
  }>;
  callLogs: Array<HistoryRow & {
    lead_id?: string | null;
    summary?: string | null;
  }>;
};

// ── Config ────────────────────────────────────────────────────────────────────
const STAGE_ORDER = ["prospection", "analyse", "offre", "due_diligence", "financement", "cloture", "abandonne"];
const STAGE_LABELS: Record<string, string> = {
  prospection:   "Prospection",
  analyse:       "Analyse",
  offre:         "Offre déposée",
  due_diligence: "Due Diligence",
  financement:   "Financement",
  cloture:       "Clôturé",
  abandonne:     "Abandonné",
};
const TEMP_CONFIG: Record<string, { label: string; pill: string }> = {
  froid: { label: "Froid", pill: "pill--info" },
  tiede: { label: "Tiède", pill: "pill--review" },
  chaud: { label: "Chaud", pill: "pill--hot" },
};
const PRIORITY_LABELS: Record<string, string> = {
  low: "Basse", medium: "Moyenne", high: "Haute",
};

function formatCAD(n: number | null): string {
  if (!n) return "—";
  return new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
}
function formatDate(s: string): string {
  return new Date(s).toLocaleString("fr-CA", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatMaybeDate(s: string | null): string {
  return s ? formatDate(s) : "—";
}
function timelineLabel(value: string | null) {
  const labels: Record<string, string> = {
    immediate: "immédiat",
    "3_months": "3 mois",
    "6_months": "6 mois",
    no_rush: "pas pressé",
    unknown: "inconnu",
  };
  return value ? labels[value] ?? value : "—";
}
function excerpt(text: string | null | undefined, max = 520) {
  if (!text) return "—";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "—";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
function initialsFor(name: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

// ── Stage Stepper ─────────────────────────────────────────────────────────────
function StageStepper({ currentStage, onStageChange }: { currentStage: string; onStageChange: (s: string) => void }) {
  const activeStages = STAGE_ORDER.filter((s) => s !== "abandonne");
  const currentIdx = activeStages.indexOf(currentStage);

  return (
    <div className="dw-stepper">
      {activeStages.map((stage, idx) => {
        const isActive = stage === currentStage;
        const isDone = idx < currentIdx;
        const cls = ["dw-step", isActive ? "dw-step--active" : "", isDone ? "dw-step--done" : ""]
          .filter(Boolean).join(" ");
        return (
          <button
            key={stage}
            type="button"
            onClick={() => onStageChange(stage)}
            className={cls}
            title={`Passer à ${STAGE_LABELS[stage]}`}
          >
            {STAGE_LABELS[stage]}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onStageChange("abandonne")}
        className={`dw-step dw-step--abandon${currentStage === "abandonne" ? " dw-step--active" : ""}`}
        title="Marquer comme abandonné"
      >
        Abandonné
      </button>
    </div>
  );
}

// ── Checklist Panel ───────────────────────────────────────────────────────────
function ChecklistPanel({ stage, checklists, onToggle }: {
  stage: string;
  checklists: Record<string, CheckItem[]>;
  onToggle: (stage: string, itemId: string, done: boolean) => void;
}) {
  const items = checklists[stage] ?? [];
  if (items.length === 0) return null;

  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = Math.round((done / total) * 100);

  return (
    <div>
      <div className="dw-checklist__head">
        Checklist — {STAGE_LABELS[stage]}
        <span className={`dw-checklist__count${pct === 100 ? " dw-checklist__count--done" : ""}`}>
          {done}/{total}
        </span>
      </div>
      <div className="dw-checklist__bar">
        <div className={pct === 100 ? "is-done" : ""} style={{ width: `${pct}%` }} />
      </div>
      <ul className="dw-checklist__list">
        {items.map((item) => (
          <li key={item.id} className="dw-checklist__item">
            <button
              type="button"
              onClick={() => onToggle(stage, item.id, !item.done)}
              className={`dw-checklist__cb${item.done ? " dw-checklist__cb--done" : ""}`}
              aria-label={item.done ? "Décocher" : "Cocher"}
            >
              {item.done && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4l2.5 2.5L9 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <span className={`dw-checklist__label${item.done ? " dw-checklist__label--done" : ""}`}>
              {item.label}
            </span>
          </li>
        ))}
      </ul>
      {pct === 100 && <div className="dw-checklist__done-banner">Toutes les étapes complètes !</div>}
    </div>
  );
}

// ── Editable Field ────────────────────────────────────────────────────────────
function EditableField({ label, value, type = "text", onSave }: {
  label: string;
  value: string | number | null;
  type?: "text" | "number" | "textarea" | "select-temp" | "select-priority";
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));

  function commit() {
    onSave(draft);
    setEditing(false);
  }
  function cancel() {
    setDraft(String(value ?? ""));
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="dw-field__edit">
        <div className="dw-field__label">{label}</div>
        {type === "textarea" ? (
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} autoFocus />
        ) : type === "select-temp" ? (
          <select value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus>
            <option value="froid">Froid</option>
            <option value="tiede">Tiède</option>
            <option value="chaud">Chaud</option>
          </select>
        ) : type === "select-priority" ? (
          <select value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus>
            <option value="low">Basse</option>
            <option value="medium">Moyenne</option>
            <option value="high">Haute</option>
          </select>
        ) : (
          <input
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") cancel();
            }}
            autoFocus
          />
        )}
        <div className="dw-field__actions">
          <button type="button" className="btn btn--gold btn--sm" onClick={commit}>Sauvegarder</button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={cancel}>Annuler</button>
        </div>
      </div>
    );
  }

  const display = value === null || value === undefined || value === ""
    ? null
    : type === "select-temp" ? TEMP_CONFIG[String(value)]?.label ?? String(value)
    : type === "select-priority" ? PRIORITY_LABELS[String(value)] ?? String(value)
    : String(value);
  const isNumeric = type === "number";

  return (
    <div className="dw-field" onClick={() => setEditing(true)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setEditing(true); }}
    >
      <div className="dw-field__label">{label}</div>
      <div className={`dw-field__value${display === null ? " dw-field__value--empty" : ""}${isNumeric ? " dw-field__value--num" : ""}`}>
        {display ?? "— (cliquer pour modifier)"}
      </div>
    </div>
  );
}

// ── Activity Log ──────────────────────────────────────────────────────────────
function ActivityLog({ activities, onAdd }: { activities: Activity[]; onAdd: (text: string) => void }) {
  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);

  async function submit() {
    const t = newText.trim();
    if (!t) return;
    setAdding(true);
    onAdd(t);
    setNewText("");
    setAdding(false);
  }

  return (
    <div className="dw-activity">
      <div className="dw-activity__add">
        <input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Ajouter une note ou activité…"
        />
        <button
          type="button"
          className="btn btn--gold"
          onClick={submit}
          disabled={adding || !newText.trim()}
          style={{ opacity: adding || !newText.trim() ? 0.5 : 1 }}
        >
          Ajouter
        </button>
      </div>
      <ul className="dw-activity__list">
        {activities.length === 0 ? (
          <li className="dw-activity__empty">Aucune activité enregistrée.</li>
        ) : (
          activities.map((act) => (
            <li key={act.id} className="dw-activity__item">
              <div className="dw-activity__dot" />
              <div style={{ flex: 1 }}>
                <div className="dw-activity__text">{act.text}</div>
                <div className="dw-activity__time">{formatDate(act.time)}</div>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// ── SMS conversation (inside tab) ─────────────────────────────────────────────
function SmsConversationPanel({ deal, messages }: { deal: Deal; messages: DealSmsMessage[] }) {
  const sorted = [...messages].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return (
    <div className="dw-sms">
      <div className="dw-sms__head">
        <div>
          <div className="dw-sms__title">Conversation SMS</div>
          <div className="dw-sms__sub">
            {deal.contact_name || "Vendeur"} · <span className="mono">{deal.contact_phone || "numéro inconnu"}</span>
          </div>
        </div>
        <Link href={"/textos" as never} prefetch={false} className="btn btn--sm">
          Ouvrir Textos
        </Link>
      </div>
      <div className="dw-sms__list">
        {sorted.map((m) => (
          <div key={m.id} className={`dw-sms__bubble dw-sms__bubble--${m.direction === "outbound" ? "out" : "in"}`}>
            <div style={{ whiteSpace: "pre-wrap" }}>{m.body || "Message vide"}</div>
            <div className="dw-sms__bubble__meta">
              {m.direction === "outbound" ? "Envoyé" : "Reçu"} · {formatDate(m.at)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Dossier ───────────────────────────────────────────────────────────────────
function DossierBeforeCall({ deal, documents, dossier }: {
  deal: Deal;
  documents: DealDocument[];
  dossier: DealDossier;
}) {
  const lead = dossier.leads[0] ?? null;
  const submission = dossier.submissions[0] ?? null;
  const callLog = dossier.callLogs.find((row) => row.summary || row.notes || row.transcript) ?? null;
  const owner = deal.contact_name ?? lead?.full_name ?? lead?.company_name ?? "—";
  const leadAddress = [lead?.address, lead?.city].filter(Boolean).join(", ");
  const address = (deal.address ?? leadAddress) || "—";

  return (
    <section className="dw-dossier">
      <div className="dw-dossier__head">
        <div>
          <div className="dw-dossier__kicker">Dossier avant appel</div>
          <h2 className="dw-dossier__title">{deal.title}</h2>
        </div>
        <span className="dw-dossier__tag">
          <span className="mono">{dossier.callLogs.length}</span>{" "}
          appel{dossier.callLogs.length > 1 ? "s" : ""} lié{dossier.callLogs.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="dw-dossier__facts">
        <DossierFactCard
          title="Bâtiment"
          rows={[
            ["Adresse", address],
            ["Unités", (deal.units ?? lead?.num_units) != null ? String(deal.units ?? lead?.num_units) : "—"],
            ["Évaluation", lead?.evaluation_total != null ? formatCAD(lead.evaluation_total) : "—"],
            ["Prix demandé", formatCAD(deal.asking_price ?? submission?.asking_price ?? null)],
          ]}
        />
        <DossierFactCard
          title="Vendeur"
          rows={[
            ["Nom", owner],
            ["Téléphone", deal.contact_phone ?? lead?.best_phone ?? "—"],
            ["Motivation", submission?.motivation ?? "—"],
            ["Délai", timelineLabel(submission?.timeline ?? null)],
          ]}
        />
        <DossierFactCard
          title="Données ajoutées"
          rows={[
            ["Submissions", String(dossier.submissions.length)],
            ["Transcripts", String(dossier.callLogs.filter((row) => row.transcript).length)],
            ["Documents", String(documents.length)],
            ["Dernier appel", formatMaybeDate(callLog?.recorded_at ?? null)],
          ]}
        />
      </div>

      <div className="dw-dossier__evidence">
        <EvidenceCard
          title="Notes du transcript et appels"
          body={excerpt(callLog?.summary ?? callLog?.notes ?? callLog?.transcript)}
          footer={callLog?.outcome ? `Outcome: ${callLog.outcome}` : undefined}
        />
        <EvidenceCard
          title="Notes caller"
          body={excerpt(submission?.caller_summary ?? deal.notes_vendeur ?? deal.notes_deal)}
          footer={submission?.created_at ? `Soumis le ${formatDate(submission.created_at)}` : undefined}
        />
      </div>
    </section>
  );
}

function DossierFactCard({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="dw-fact">
      <div className="dw-fact__title">{title}</div>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label} className="dw-fact__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function EvidenceCard({ title, body, footer }: { title: string; body: string; footer?: string }) {
  return (
    <div className="dw-evidence">
      <div className="dw-evidence__title">{title}</div>
      <p className="dw-evidence__body">{body}</p>
      {footer && <div className="dw-evidence__footer">{footer}</div>}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
type DealTab = "notes" | "calls" | "sms" | "activity" | "checklist" | "docs";

function TabsBar({
  active, onChange, counts,
}: {
  active: DealTab;
  onChange: (t: DealTab) => void;
  counts: { calls: number; sms: number; activity: number; docs: number };
}) {
  const tabs: Array<[DealTab, string, number | null]> = [
    ["notes", "Notes", null],
    ["calls", "Appels", counts.calls],
    ["sms", "Textos", counts.sms],
    ["activity", "Activité", counts.activity],
    ["checklist", "Checklist", null],
    ["docs", "Documents", counts.docs],
  ];
  return (
    <div className="dw-tabs__bar" role="tablist">
      {tabs.map(([key, label, n]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={active === key}
          className={`dw-tab${active === key ? " dw-tab--active" : ""}`}
          onClick={() => onChange(key)}
        >
          {label}
          {n !== null && <span className="dw-tab__n">{n}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DealWorkspaceClient({
  deal: initialDeal,
  documents,
  callHistory,
  dossier,
  smsMessages,
}: {
  deal: Deal;
  documents: DealDocument[];
  callHistory: HistoryRow[];
  dossier: DealDossier;
  smsMessages: DealSmsMessage[];
}) {
  const [deal, setDeal] = useState<Deal>(initialDeal);
  const [saving, setSaving] = useState(false);

  // Twilio call state (unchanged) ─────────────────────────────────────────────
  const [callState, setCallState] = useState<CallState>("idle");
  const [callError, setCallError] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState<number>(0);
  const activeCallLogId = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tab state (new) ───────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<DealTab>("notes");

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  function startPolling(callLogId: string) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/calls/status?callLogId=${callLogId}`);
        const j = await r.json();
        if (!j.ok) return;
        const events = (j.data?.statusEvents ?? []) as { status: string }[];
        const last = events[events.length - 1]?.status ?? "";
        if (last === "in-progress") setCallState("answered");
        if (typeof j.data?.durationSec === "number") setDurationSec(j.data.durationSec);
        if (last === "completed" || j.data?.durationSec != null) {
          setCallState("completed"); stopPolling();
        }
      } catch { /* non-fatal */ }
    }, 3000);
  }

  useEffect(() => () => stopPolling(), []);

  async function startDealCall() {
    const phone = deal.contact_phone?.trim();
    if (!phone) { setCallError("Aucun numéro de téléphone renseigné pour ce contact."); return; }
    setCallState("initiating");
    setCallError(null);
    setDurationSec(0);
    try {
      const r = await fetch(`/api/deals/${deal.id}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_e164: phone }),
      });
      const j = await r.json();
      if (!j.ok) {
        setCallState("failed");
        setCallError(j.error ?? "Échec du lancement de l'appel.");
        return;
      }
      activeCallLogId.current = j.data.callLogId;
      setCallState("ringing");
      startPolling(j.data.callLogId);
    } catch {
      setCallState("failed");
      setCallError("Erreur réseau. Réessaie.");
    }
  }

  const patch = useCallback(async (fields: Record<string, unknown>, optimistic?: Partial<Deal>) => {
    if (optimistic) setDeal((d) => ({ ...d, ...optimistic }));
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const j = await res.json();
      if (!j.ok) {
        setDeal(initialDeal);
        alert("Erreur: " + j.error);
      }
    } catch {
      setDeal(initialDeal);
    } finally {
      setSaving(false);
    }
  }, [deal.id, initialDeal]);

  const handleStageChange = useCallback((stage: string) => {
    setDeal((d) => ({ ...d, stage }));
    patch({ stage, addActivity: { text: `Stade changé → ${STAGE_LABELS[stage]}` } });
  }, [patch]);

  const handleChecklistToggle = useCallback((stage: string, itemId: string, done: boolean) => {
    setDeal((d) => {
      const updated = { ...d.checklists };
      if (updated[stage]) {
        updated[stage] = updated[stage].map((item) => item.id === itemId ? { ...item, done } : item);
      }
      return { ...d, checklists: updated };
    });
    const updatedItems = (deal.checklists[stage] ?? []).map((item) =>
      item.id === itemId ? { ...item, done } : item,
    );
    patch({ checklists: { [stage]: updatedItems } });
  }, [deal.checklists, patch]);

  const handleActivityAdd = useCallback((text: string) => {
    const newEntry: Activity = { id: crypto.randomUUID(), text, time: new Date().toISOString() };
    setDeal((d) => ({ ...d, activities: [newEntry, ...d.activities] }));
    patch({ addActivity: { text } });
  }, [patch]);

  const temp = TEMP_CONFIG[deal.temperature] ?? TEMP_CONFIG.tiede;
  const askPrice = deal.asking_price;
  const offerPrice = deal.offer_price;
  const diff = askPrice && offerPrice ? askPrice - offerPrice : null;
  const diffNeg = diff !== null && diff < 0;

  return (
    <div className="dw-page">
      {/* ── Top bar ── */}
      <div className="dw-topbar">
        <div className="dw-topbar__row">
          <Link href={"/pipeline" as never} className="dw-topbar__crumb">← Pipeline</Link>
          <h1 className="dw-topbar__title">{deal.title}</h1>
          <span className={`pill ${temp.pill}`}>
            <span className="pill__dot" />{temp.label}
          </span>
          {saving && <span className="dw-topbar__saving">Sauvegarde…</span>}
        </div>
        <StageStepper currentStage={deal.stage} onStageChange={handleStageChange} />
      </div>

      {/* ── Body ── */}
      <div className="dw-body">
        {/* ── Main column ── */}
        <div className="dw-main">
          <DossierBeforeCall deal={deal} documents={documents} dossier={dossier} />

          <div className="dw-tabs">
            <TabsBar
              active={activeTab}
              onChange={setActiveTab}
              counts={{
                calls: callHistory.length,
                sms: smsMessages.length,
                activity: deal.activities?.length ?? 0,
                docs: documents.length,
              }}
            />
            <div className="dw-tab__panel">
              {activeTab === "notes" && (
                <div className="dw-notes">
                  <div className="dw-notes__section">
                    <div className="dw-notes__title">Notes deal <small>générales</small></div>
                    <EditableField
                      label="Notes"
                      value={deal.notes_deal}
                      type="textarea"
                      onSave={(v) => patch({ notes_deal: v }, { notes_deal: v })}
                    />
                  </div>
                  <div className="dw-notes__section">
                    <div className="dw-notes__title">Notes vendeur <small>motivation, délai, contexte</small></div>
                    <EditableField
                      label="Notes vendeur"
                      value={deal.notes_vendeur}
                      type="textarea"
                      onSave={(v) => patch({ notes_vendeur: v }, { notes_vendeur: v })}
                    />
                  </div>
                  <div className="dw-notes__ai">
                    <div className="dw-notes__title">Analyse AI <small>risques &amp; opportunités</small></div>
                    <EditableField
                      label="Analyse"
                      value={deal.ai_analysis}
                      type="textarea"
                      onSave={(v) => patch({ ai_analysis: v }, { ai_analysis: v })}
                    />
                  </div>
                </div>
              )}

              {activeTab === "calls" && (
                callHistory.length > 0
                  ? <CallHistoryPanel history={callHistory} />
                  : <div className="dw-tab__panel--empty">Aucun appel enregistré pour ce deal.</div>
              )}

              {activeTab === "sms" && (
                smsMessages.length > 0
                  ? <SmsConversationPanel deal={deal} messages={smsMessages} />
                  : <div className="dw-tab__panel--empty">Aucun texto échangé pour ce deal.</div>
              )}

              {activeTab === "activity" && (
                <ActivityLog activities={deal.activities ?? []} onAdd={handleActivityAdd} />
              )}

              {activeTab === "checklist" && (
                deal.checklists[deal.stage]?.length
                  ? <ChecklistPanel stage={deal.stage} checklists={deal.checklists} onToggle={handleChecklistToggle} />
                  : <div className="dw-tab__panel--empty">Aucune checklist pour ce stade.</div>
              )}

              {activeTab === "docs" && (
                documents.length === 0
                  ? <div className="dw-tab__panel--empty">Aucun document attaché.</div>
                  : (
                    <ul className="dw-docs">
                      {documents.map((doc) => (
                        <li key={doc.id} className="dw-doc">
                          <span>{doc.name}</span>
                          {doc.size && <span className="dw-doc__size">{(doc.size / 1024).toFixed(0)} KB</span>}
                          <span className="dw-doc__date">{formatDate(doc.created_at)}</span>
                        </li>
                      ))}
                    </ul>
                  )
              )}
            </div>
          </div>
        </div>

        {/* ── Right rail ── */}
        <aside className="dw-rail">
          {/* Contact card */}
          <div className="dw-rail__card">
            <div className="dw-rail__title">Contact vendeur</div>
            <div className="dw-contact__head">
              <div className="dw-contact__avatar">{initialsFor(deal.contact_name)}</div>
              <div className="dw-contact__id">
                <strong>{deal.contact_name ?? "Vendeur"}</strong>
                <small>{deal.contact_email ?? "—"}</small>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <EditableField label="Nom" value={deal.contact_name} onSave={(v) => patch({ contact_name: v }, { contact_name: v })} />
              <EditableField label="Téléphone" value={deal.contact_phone} onSave={(v) => patch({ contact_phone: v }, { contact_phone: v })} />
              <EditableField label="Courriel" value={deal.contact_email} onSave={(v) => patch({ contact_email: v }, { contact_email: v })} />
            </div>

            {deal.contact_phone && (
              <div>
                {callState === "idle" || callState === "failed" || callState === "completed" ? (
                  <button type="button" onClick={startDealCall} className="dw-callbtn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"
                        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
                    </svg>
                    Appeler
                  </button>
                ) : (
                  <button type="button" disabled className="dw-callbtn dw-callbtn--busy">
                    {callState === "initiating" ? "Connexion…"
                     : callState === "ringing" ? "Sonnerie…"
                     : callState === "answered" ? "En cours…"
                     : "Appel…"}
                  </button>
                )}

                <a href={`tel:${deal.contact_phone}`} className="dw-callfallback">
                  Composer manuellement
                </a>

                {(callState === "initiating" || callState === "ringing" || callState === "answered" || callState === "completed") && (
                  <div style={{ marginTop: 10 }}>
                    <TwilioCallStatePanel callState={callState} durationSec={durationSec} />
                  </div>
                )}

                {callError && <div className="dw-callerror">{callError}</div>}
              </div>
            )}
          </div>

          {/* Offre card (dark) */}
          {(askPrice || offerPrice) && (
            <div className="dw-offre">
              <div className="dw-offre__kicker">Offre {deal.address ? `· ${deal.address}` : ""}</div>
              {askPrice ? (
                <div className="dw-offre__row">
                  <span>Prix demandé</span>
                  <span>{formatCAD(askPrice)}</span>
                </div>
              ) : null}
              {offerPrice ? (
                <div className="dw-offre__row">
                  <span>Notre offre</span>
                  <span>{formatCAD(offerPrice)}</span>
                </div>
              ) : null}
              {diff !== null && (
                <div className={`dw-offre__row ${diffNeg ? "dw-offre__row--diff-neg" : "dw-offre__row--diff"}`}>
                  <span>Écart</span>
                  <span>{formatCAD(diff)}</span>
                </div>
              )}
              <div className="dw-offre__pills">
                <span className="dw-offre__pill">T° · {temp.label}</span>
                <span className="dw-offre__pill">Priorité · {PRIORITY_LABELS[deal.priority] ?? deal.priority}</span>
                {deal.units != null && <span className="dw-offre__pill"><span className="mono">{deal.units}</span> unités</span>}
              </div>
            </div>
          )}

          {/* Deal details */}
          <div className="dw-rail__card">
            <div className="dw-rail__title">Détails du deal</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <EditableField label="Titre" value={deal.title} onSave={(v) => patch({ title: v }, { title: v })} />
              <EditableField label="Adresse" value={deal.address} onSave={(v) => patch({ address: v }, { address: v })} />
              <EditableField label="Unités" value={deal.units} type="number" onSave={(v) => patch({ units: parseInt(v, 10) || null }, { units: parseInt(v, 10) || null })} />
              <EditableField label="Prix demandé ($)" value={deal.asking_price} type="number" onSave={(v) => patch({ asking_price: parseInt(v, 10) || null }, { asking_price: parseInt(v, 10) || null })} />
              <EditableField label="Prix offert ($)" value={deal.offer_price} type="number" onSave={(v) => patch({ offer_price: parseInt(v, 10) || null }, { offer_price: parseInt(v, 10) || null })} />
              <EditableField label="Température" value={deal.temperature} type="select-temp" onSave={(v) => patch({ temperature: v }, { temperature: v })} />
              <EditableField label="Priorité" value={deal.priority} type="select-priority" onSave={(v) => patch({ priority: v }, { priority: v })} />
            </div>
          </div>

          {/* Next action */}
          <div className="dw-rail__card">
            <div className="dw-rail__title">Prochaine action</div>
            <EditableField
              label="Action à faire"
              value={deal.next_action}
              onSave={(v) => patch({ next_action: v }, { next_action: v })}
            />
          </div>

          {/* Meta */}
          <div className="dw-meta">
            <div>Créé · {formatDate(deal.created_at)}</div>
            <div>Modifié · {formatDate(deal.updated_at)}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
