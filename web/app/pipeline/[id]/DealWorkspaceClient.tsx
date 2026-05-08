"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TwilioCallStatePanel, { type CallState } from "@/app/calls/[leadId]/components/TwilioCallStatePanel";
import CallHistoryPanel from "@/app/calls/[leadId]/CallHistoryPanel";
import type { HistoryRow } from "@/app/calls/[leadId]/components/CallHistoryEntry";

// ── Types ─────────────────────────────────────────────────────────────────────
type CheckItem = { id: string; label: string; done: boolean };
export type DealDocument = { id: string; name: string; size: number | null; mime_type: string | null; created_at: string };
type Activity  = { id: string; text: string; time: string };

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

// ── Config ────────────────────────────────────────────────────────────────────
const STAGE_ORDER = ["prospection","analyse","offre","due_diligence","financement","cloture","abandonne"];
const STAGE_LABELS: Record<string, string> = {
  prospection:   "Prospection",
  analyse:       "Analyse",
  offre:         "Offre déposée",
  due_diligence: "Due Diligence",
  financement:   "Financement",
  cloture:       "Clôturé",
  abandonne:     "Abandonné",
};
const STAGE_COLORS: Record<string, string> = {
  prospection:   "#6B7280",
  analyse:       "#7C3AED",
  offre:         "#2563EB",
  due_diligence: "#D97706",
  financement:   "#059669",
  cloture:       "#10B981",
  abandonne:     "#EF4444",
};
const TEMP_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  froid: { label: "Froid",  bg: "#EFF6FF", text: "#1D4ED8" },
  tiede: { label: "Tiède",  bg: "#FFFBEB", text: "#92400E" },
  chaud: { label: "Chaud",  bg: "#FEF2F2", text: "#B91C1C" },
};

function formatCAD(n: number | null): string {
  if (!n) return "—";
  return new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
}
function formatDate(s: string): string {
  return new Date(s).toLocaleString("fr-CA", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Stage Progress Bar ────────────────────────────────────────────────────────
function StageProgressBar({ currentStage, onStageChange }: { currentStage: string; onStageChange: (s: string) => void }) {
  const activeStages = STAGE_ORDER.filter(s => s !== "abandonne");
  const currentIdx   = activeStages.indexOf(currentStage);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto", paddingBottom: 4 }}>
      {activeStages.map((stage, idx) => {
        const isActive   = stage === currentStage;
        const isDone     = idx < currentIdx;
        const color      = STAGE_COLORS[stage];
        return (
          <button
            key={stage}
            onClick={() => onStageChange(stage)}
            title={`Passer à ${STAGE_LABELS[stage]}`}
            style={{
              flex: 1, minWidth: 80, padding: "7px 6px",
              border: "none", cursor: "pointer", fontSize: 11, fontWeight: isActive ? 800 : 500,
              background: isActive ? color : isDone ? color + "22" : "#F3F4F6",
              color: isActive ? "#fff" : isDone ? color : "#9CA3AF",
              borderRadius: idx === 0 ? "8px 0 0 8px" : idx === activeStages.length - 1 ? "0 8px 8px 0" : 0,
              borderRight: idx < activeStages.length - 1 ? "1px solid rgba(255,255,255,0.3)" : "none",
              transition: "all 0.15s ease",
              textAlign: "center",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {STAGE_LABELS[stage]}
          </button>
        );
      })}
      {/* Abandonné button */}
      <button
        onClick={() => onStageChange("abandonne")}
        title="Marquer comme abandonné"
        style={{
          marginLeft: 8, padding: "7px 12px",
          border: "1px solid #FCA5A5", borderRadius: 8, cursor: "pointer",
          fontSize: 11, fontWeight: currentStage === "abandonne" ? 800 : 500,
          background: currentStage === "abandonne" ? "#EF4444" : "#FFF",
          color: currentStage === "abandonne" ? "#fff" : "#EF4444",
          flexShrink: 0,
        }}
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

  const done  = items.filter(i => i.done).length;
  const total = items.length;
  const pct   = Math.round((done / total) * 100);

  return (
    <div style={{ background: "var(--crm-bg-alt, #F9FAFB)", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "#6B7280" }}>
          Checklist — {STAGE_LABELS[stage]}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: pct === 100 ? "#059669" : "#6B7280" }}>
          {done}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: "#E5E7EB", borderRadius: 2, marginBottom: 12, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: pct === 100 ? "#059669" : "var(--crm-gold, #C9A84C)",
          borderRadius: 2, transition: "width 0.3s ease",
        }} />
      </div>

      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map(item => (
          <li key={item.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => onToggle(stage, item.id, !item.done)}
              style={{
                width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                border: `2px solid ${item.done ? "#059669" : "#D1D5DB"}`,
                background: item.done ? "#059669" : "transparent",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
              }}
              aria-label={item.done ? "Décocher" : "Cocher"}
            >
              {item.done && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4l2.5 2.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <span style={{
              fontSize: 13, flex: 1,
              color: item.done ? "#9CA3AF" : "#374151",
              textDecoration: item.done ? "line-through" : "none",
            }}>
              {item.label}
            </span>
          </li>
        ))}
      </ul>

      {pct === 100 && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#059669", fontWeight: 700 }}>
          Toutes les étapes complètes !
        </div>
      )}
    </div>
  );
}

// ── Field editor ──────────────────────────────────────────────────────────────
function EditableField({ label, value, type = "text", onSave }: {
  label: string;
  value: string | number | null;
  type?: "text" | "number" | "textarea" | "select-temp" | "select-priority";
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(String(value ?? ""));

  function commit() {
    onSave(draft);
    setEditing(false);
  }

  if (editing) {
    if (type === "textarea") return (
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{label}</div>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={5}
          style={{ width: "100%", padding: "8px 10px", border: "1px solid #C9A84C", borderRadius: 8, fontSize: 13, resize: "vertical", outline: "none", boxSizing: "border-box" }}
          autoFocus
        />
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button onClick={commit} style={{ fontSize: 12, padding: "4px 12px", background: "var(--crm-gold, #C9A84C)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>Sauvegarder</button>
          <button onClick={() => { setDraft(String(value ?? "")); setEditing(false); }} style={{ fontSize: 12, padding: "4px 10px", background: "#F3F4F6", color: "#374151", border: "none", borderRadius: 6, cursor: "pointer" }}>Annuler</button>
        </div>
      </div>
    );

    if (type === "select-temp") return (
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{label}</div>
        <select value={draft} onChange={e => setDraft(e.target.value)} autoFocus
          style={{ padding: "6px 10px", border: "1px solid #C9A84C", borderRadius: 8, fontSize: 13, outline: "none" }}>
          <option value="froid">Froid</option>
          <option value="tiede">Tiède</option>
          <option value="chaud">Chaud</option>
        </select>
        <button onClick={commit} style={{ marginLeft: 8, fontSize: 12, padding: "6px 12px", background: "var(--crm-gold, #C9A84C)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>OK</button>
        <button onClick={() => { setDraft(String(value ?? "")); setEditing(false); }} style={{ marginLeft: 6, fontSize: 12, padding: "6px 10px", background: "#F3F4F6", color: "#374151", border: "none", borderRadius: 6, cursor: "pointer" }}>✕</button>
      </div>
    );

    if (type === "select-priority") return (
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{label}</div>
        <select value={draft} onChange={e => setDraft(e.target.value)} autoFocus
          style={{ padding: "6px 10px", border: "1px solid #C9A84C", borderRadius: 8, fontSize: 13, outline: "none" }}>
          <option value="low">Basse</option>
          <option value="medium">Moyenne</option>
          <option value="high">Haute</option>
        </select>
        <button onClick={commit} style={{ marginLeft: 8, fontSize: 12, padding: "6px 12px", background: "var(--crm-gold, #C9A84C)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>OK</button>
        <button onClick={() => { setDraft(String(value ?? "")); setEditing(false); }} style={{ marginLeft: 6, fontSize: 12, padding: "6px 10px", background: "#F3F4F6", color: "#374151", border: "none", borderRadius: 6, cursor: "pointer" }}>✕</button>
      </div>
    );

    return (
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{label}</div>
        <input
          type={type}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(String(value ?? "")); setEditing(false); } }}
          autoFocus
          style={{ padding: "6px 10px", border: "1px solid #C9A84C", borderRadius: 8, fontSize: 13, outline: "none", minWidth: 160 }}
        />
        <button onClick={commit} style={{ marginLeft: 8, fontSize: 12, padding: "6px 12px", background: "var(--crm-gold, #C9A84C)", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>OK</button>
        <button onClick={() => { setDraft(String(value ?? "")); setEditing(false); }} style={{ marginLeft: 6, fontSize: 12, padding: "6px 10px", background: "#F3F4F6", color: "#374151", border: "none", borderRadius: 6, cursor: "pointer" }}>✕</button>
      </div>
    );
  }

  return (
    <div onClick={() => setEditing(true)} style={{ cursor: "pointer", padding: "6px 8px", borderRadius: 8, transition: "background 0.1s" }}
      onMouseEnter={e => (e.currentTarget.style.background = "#F9FAFB")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: value ? "#111827" : "#D1D5DB" }}>
        {value ? String(value) : "—  (cliquer pour modifier)"}
        <span style={{ fontSize: 11, color: "#C9A84C", marginLeft: 6 }}></span>
      </div>
    </div>
  );
}

// ── Activity Log ──────────────────────────────────────────────────────────────
function ActivityLog({ activities, onAdd }: { activities: Activity[]; onAdd: (text: string) => void }) {
  const [newText, setNewText] = useState("");
  const [adding, setAdding]   = useState(false);

  async function submit() {
    const t = newText.trim();
    if (!t) return;
    setAdding(true);
    onAdd(t);
    setNewText("");
    setAdding(false);
  }

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 10 }}>
        Journal d&apos;activité
      </div>
      {/* Add note */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="Ajouter une note ou activité…"
          style={{
            flex: 1, padding: "8px 12px", border: "1px solid #E5E7EB",
            borderRadius: 8, fontSize: 13, outline: "none",
          }}
        />
        <button
          onClick={submit}
          disabled={adding || !newText.trim()}
          style={{
            padding: "8px 16px", border: "none", borderRadius: 8,
            background: "var(--crm-gold, #C9A84C)", color: "#fff",
            fontSize: 13, fontWeight: 700, cursor: "pointer",
            opacity: adding || !newText.trim() ? 0.5 : 1,
          }}
        >
          +
        </button>
      </div>

      {/* Activity list */}
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
        {activities.length === 0 ? (
          <li style={{ fontSize: 13, color: "#9CA3AF" }}>Aucune activité enregistrée.</li>
        ) : (
          activities.map(act => (
            <li key={act.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{
                width: 6, height: 6, borderRadius: "50%", background: "var(--crm-gold, #C9A84C)",
                flexShrink: 0, marginTop: 5,
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: "#374151" }}>{act.text}</div>
                <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 1 }}>{formatDate(act.time)}</div>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DealWorkspaceClient({
  deal: initialDeal,
  documents,
  callHistory,
}: {
  deal: Deal;
  documents: DealDocument[];
  callHistory: HistoryRow[];
}) {
  const [deal, setDeal]     = useState<Deal>(initialDeal);
  const [saving, setSaving] = useState(false);
  const router              = useRouter();

  // ── Twilio call state (mirrors CallWorkspace.tsx pattern) ────────────────
  const [callState, setCallState]   = useState<CallState>("idle");
  const [callError, setCallError]   = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState<number>(0);
  const activeCallLogId             = useRef<string | null>(null);
  const pollRef                     = useRef<ReturnType<typeof setInterval> | null>(null);

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
    if (optimistic) setDeal(d => ({ ...d, ...optimistic }));
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
    setDeal(d => ({ ...d, stage }));
    patch({ stage, addActivity: { text: `Stade changé → ${STAGE_LABELS[stage]}` } });
  }, [patch]);

  const handleChecklistToggle = useCallback((stage: string, itemId: string, done: boolean) => {
    setDeal(d => {
      const updated = { ...d.checklists };
      if (updated[stage]) {
        updated[stage] = updated[stage].map(item => item.id === itemId ? { ...item, done } : item);
      }
      return { ...d, checklists: updated };
    });
    // Build updated checklists for the stage
    const updatedItems = (deal.checklists[stage] ?? []).map(item =>
      item.id === itemId ? { ...item, done } : item
    );
    patch({ checklists: { [stage]: updatedItems } });
  }, [deal.checklists, patch]);

  const handleActivityAdd = useCallback((text: string) => {
    const newEntry: Activity = { id: crypto.randomUUID(), text, time: new Date().toISOString() };
    setDeal(d => ({ ...d, activities: [newEntry, ...d.activities] }));
    patch({ addActivity: { text } });
  }, [patch]);

  const temp  = TEMP_CONFIG[deal.temperature] ?? TEMP_CONFIG.tiede;
  const color = STAGE_COLORS[deal.stage] ?? "#6B7280";

  return (
    <div style={{ padding: "0 0 60px" }}>
      {/* ── Top bar ── */}
      <div style={{
        borderBottom: "1px solid var(--crm-card-border, #E5E7EB)",
        padding: "16px 24px",
        background: "#fff",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <Link href={"/pipeline" as never} style={{ fontSize: 12, color: "#9CA3AF", textDecoration: "none" }}>
            ← Pipeline
          </Link>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#111827", flex: 1 }}>
            {deal.title}
          </h1>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10,
            background: temp.bg, color: temp.text,
          }}>{temp.label}</span>
          {saving && <span style={{ fontSize: 11, color: "#9CA3AF" }}>Sauvegarde…</span>}
        </div>

        {/* Stage progress bar */}
        <StageProgressBar currentStage={deal.stage} onStageChange={handleStageChange} />
      </div>

      {/* ── Body ── */}
      <div style={{ padding: "24px", display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, alignItems: "start" }}>

        {/* ── LEFT COLUMN ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Notes deal */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", marginBottom: 12 }}>Notes deal</div>
            <EditableField
              label="Notes générales"
              value={deal.notes_deal}
              type="textarea"
              onSave={v => patch({ notes_deal: v }, { notes_deal: v })}
            />
          </div>

          {/* Notes vendeur */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", marginBottom: 12 }}>Notes vendeur</div>
            <EditableField
              label="Motivation, délai, contexte"
              value={deal.notes_vendeur}
              type="textarea"
              onSave={v => patch({ notes_vendeur: v }, { notes_vendeur: v })}
            />
          </div>

          {/* AI Analysis */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", marginBottom: 12 }}>Analyse AI</div>
            <EditableField
              label="Analyse, risques, opportunités"
              value={deal.ai_analysis}
              type="textarea"
              onSave={v => patch({ ai_analysis: v }, { ai_analysis: v })}
            />
          </div>

          {/* Checklist */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", marginBottom: 12 }}>Checklist</div>
            <ChecklistPanel
              stage={deal.stage}
              checklists={deal.checklists}
              onToggle={handleChecklistToggle}
            />
            {!(deal.checklists[deal.stage]?.length) && (
              <div style={{ fontSize: 13, color: "#9CA3AF" }}>Aucune checklist pour ce stade.</div>
            )}
          </div>

          {/* Activity log */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "18px 20px" }}>
            <ActivityLog activities={deal.activities ?? []} onAdd={handleActivityAdd} />
          </div>

          {/* Historique d'appels */}
          {callHistory.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "18px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", marginBottom: 12 }}>
                Historique d&apos;appels
              </div>
              <CallHistoryPanel history={callHistory} />
            </div>
          )}

          {/* Documents */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", marginBottom: 12 }}>Documents ({documents.length})</div>
            {documents.length === 0 ? (
              <div style={{ fontSize: 13, color: "#9CA3AF" }}>Aucun document attaché.</div>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {documents.map(doc => (
                  <li key={doc.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#374151" }}>
                    <span style={{ fontSize: 16 }}>·</span>
                    <span style={{ flex: 1 }}>{doc.name}</span>
                    {doc.size && <span style={{ fontSize: 11, color: "#9CA3AF" }}>{(doc.size / 1024).toFixed(0)} KB</span>}
                    <span style={{ fontSize: 11, color: "#9CA3AF" }}>{formatDate(doc.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ── RIGHT SIDEBAR ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Deal info card */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", marginBottom: 14 }}>Détails du deal</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <EditableField label="Titre" value={deal.title} onSave={v => patch({ title: v }, { title: v })} />
              <EditableField label="Adresse" value={deal.address} onSave={v => patch({ address: v }, { address: v })} />
              <EditableField label="Unités" value={deal.units} type="number" onSave={v => patch({ units: parseInt(v, 10) || null }, { units: parseInt(v, 10) || null })} />
              <EditableField label="Prix demandé ($)" value={deal.asking_price} type="number" onSave={v => patch({ asking_price: parseInt(v, 10) || null }, { asking_price: parseInt(v, 10) || null })} />
              <EditableField label="Prix offert ($)" value={deal.offer_price} type="number" onSave={v => patch({ offer_price: parseInt(v, 10) || null }, { offer_price: parseInt(v, 10) || null })} />
              <EditableField label="Température" value={deal.temperature} type="select-temp" onSave={v => patch({ temperature: v }, { temperature: v })} />
              <EditableField label="Priorité" value={deal.priority} type="select-priority" onSave={v => patch({ priority: v }, { priority: v })} />
            </div>
          </div>

          {/* Prices summary */}
          {(deal.asking_price || deal.offer_price) && (
            <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 12, padding: "14px 16px" }}>
              {deal.asking_price && (
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: "#6B7280" }}>Prix demandé</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{formatCAD(deal.asking_price)}</span>
                </div>
              )}
              {deal.offer_price && (
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: "#6B7280" }}>Notre offre</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#7C3AED" }}>{formatCAD(deal.offer_price)}</span>
                </div>
              )}
              {deal.asking_price && deal.offer_price && (
                <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #86EFAC", paddingTop: 6, marginTop: 6 }}>
                  <span style={{ fontSize: 12, color: "#6B7280" }}>Écart</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: deal.offer_price <= deal.asking_price ? "#059669" : "#EF4444" }}>
                    {formatCAD(deal.asking_price - deal.offer_price)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Contact card */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", marginBottom: 14 }}>Contact vendeur</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <EditableField label="Nom" value={deal.contact_name} onSave={v => patch({ contact_name: v }, { contact_name: v })} />
              <EditableField label="Téléphone" value={deal.contact_phone} onSave={v => patch({ contact_phone: v }, { contact_phone: v })} />
              <EditableField label="Courriel" value={deal.contact_email} onSave={v => patch({ contact_email: v }, { contact_email: v })} />
            </div>
            {deal.contact_phone && (
              <div style={{ marginTop: 12 }}>
                {/* Primary Twilio CTA — same bridge flow as /calls/[leadId] */}
                {callState === "idle" || callState === "failed" || callState === "completed" ? (
                  <button
                    type="button"
                    onClick={startDealCall}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      width: "100%", padding: "9px",
                      background: "var(--crm-gold, #C9A84C)",
                      color: "#fff", borderRadius: 10, fontSize: 13, fontWeight: 700,
                      border: "none", cursor: "pointer",
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"
                        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
                    </svg>
                    Appeler
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      width: "100%", padding: "9px",
                      background: "#F3F4F6", color: "#6B7280",
                      borderRadius: 10, fontSize: 13, fontWeight: 700,
                      border: "none", cursor: "not-allowed",
                    }}
                  >
                    {callState === "initiating" ? "Connexion…"
                     : callState === "ringing"   ? "Sonnerie…"
                     : callState === "answered"  ? "En cours…"
                     : "Appel…"}
                  </button>
                )}

                {/* Fallback tel: link so Anthony can still tap-to-call from mobile */}
                <a
                  href={`tel:${deal.contact_phone}`}
                  style={{
                    display: "block", marginTop: 6, textAlign: "center",
                    padding: "6px", fontSize: 12, color: "#6B7280", textDecoration: "none",
                  }}
                >
                  Composer manuellement
                </a>

                {/* Live call status strip */}
                {(callState === "initiating" || callState === "ringing" || callState === "answered" || callState === "completed") && (
                  <div style={{ marginTop: 10 }}>
                    <TwilioCallStatePanel callState={callState} durationSec={durationSec} />
                  </div>
                )}

                {callError && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#EF4444" }}>{callError}</div>
                )}
              </div>
            )}
          </div>

          {/* Next action */}
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", marginBottom: 10 }}>⚡ Prochaine action</div>
            <EditableField
              label="Action à faire"
              value={deal.next_action}
              onSave={v => patch({ next_action: v }, { next_action: v })}
            />
          </div>

          {/* Meta */}
          <div style={{ fontSize: 11, color: "#9CA3AF", padding: "4px 8px" }}>
            <div>Créé: {formatDate(deal.created_at)}</div>
            <div>Modifié: {formatDate(deal.updated_at)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
