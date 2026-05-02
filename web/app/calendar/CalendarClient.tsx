"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { CalendarFollowUp } from "./page";

// ── Helpers ──────────────────────────────────────────────────────────────────

function priorityDot(p: number) {
  if (p >= 80) return "var(--crm-red)";
  if (p >= 50) return "var(--crm-gold)";
  return "var(--crm-card-border)";
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });
}

function fmtDateHeader(dateKey: string) {
  return new Date(dateKey + "T12:00:00").toLocaleDateString("fr-CA", {
    weekday: "long", month: "long", day: "numeric",
  });
}

function isToday(dateKey: string) {
  return dateKey === new Date().toISOString().slice(0, 10);
}

function isTomorrow(dateKey: string) {
  const t = new Date(); t.setDate(t.getDate() + 1);
  return dateKey === t.toISOString().slice(0, 10);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Actions = {
  complete: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  busyId: string | null;
};

// ── Root component ────────────────────────────────────────────────────────────

export default function CalendarClient({
  overdue,
  today,
  upcomingByDate,
}: {
  overdue: CalendarFollowUp[];
  today: CalendarFollowUp[];
  upcomingByDate: Record<string, CalendarFollowUp[]>;
}) {
  const [tab, setTab] = useState<"list" | "calendar">("list");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function dismiss(id: string) {
    setDismissed(prev => new Set([...prev, id]));
  }

  async function complete(id: string) {
    setBusyId(id); setError(null);
    const r = await fetch(`/api/follow-ups/${id}/complete`, { method: "POST" });
    const j = await r.json();
    setBusyId(null);
    if (!j.ok) { setError(j.error); return; }
    dismiss(id);
  }

  async function cancel(id: string) {
    if (!confirm("Annuler ce suivi ?")) return;
    setBusyId(id); setError(null);
    const r = await fetch(`/api/follow-ups/${id}`, { method: "DELETE" });
    const j = await r.json();
    setBusyId(null);
    if (!j.ok) { setError(j.error); return; }
    dismiss(id);
  }

  function visible(items: CalendarFollowUp[]) {
    return items.filter(f => !dismissed.has(f.id));
  }

  // Flat list of all follow-ups used by calendar view
  const allFollowUps = useMemo(() => [
    ...overdue,
    ...today,
    ...Object.values(upcomingByDate).flat(),
  ], [overdue, today, upcomingByDate]);

  const actions: Actions = { complete, cancel, busyId };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Tab switcher ── */}
      <div style={{
        display: "flex",
        gap: 4,
        background: "var(--crm-bg-alt)",
        border: "1px solid var(--crm-card-border)",
        borderRadius: 10,
        padding: 4,
        width: "fit-content",
      }}>
        {(["list", "calendar"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "6px 16px",
              borderRadius: 7,
              border: "none",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              background: tab === t ? "var(--crm-card)" : "transparent",
              color: tab === t ? "var(--crm-text)" : "var(--crm-text3)",
              boxShadow: tab === t ? "0 1px 4px rgba(0,0,0,.08)" : "none",
              transition: "all 0.15s",
            }}
          >
            {t === "list" ? "Vue liste" : "Vue calendrier"}
          </button>
        ))}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{ background: "var(--crm-red-light)", border: "1px solid #FFCDD2", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "var(--crm-red)", fontWeight: 600 }}>
          {error}
        </div>
      )}

      {/* ── Tab content ── */}
      {tab === "list" ? (
        <ListView
          overdue={visible(overdue)}
          today={visible(today)}
          upcomingByDate={upcomingByDate}
          dismissed={dismissed}
          actions={actions}
        />
      ) : (
        <MonthView
          allFollowUps={allFollowUps}
          dismissed={dismissed}
          actions={actions}
        />
      )}
    </div>
  );
}

// ── List view ─────────────────────────────────────────────────────────────────

function ListView({
  overdue, today, upcomingByDate, dismissed, actions,
}: {
  overdue: CalendarFollowUp[];
  today: CalendarFollowUp[];
  upcomingByDate: Record<string, CalendarFollowUp[]>;
  dismissed: Set<string>;
  actions: Actions;
}) {
  const upcomingKeys = Object.keys(upcomingByDate).sort();
  const allGone =
    overdue.length === 0 &&
    today.length === 0 &&
    upcomingKeys.every(k => (upcomingByDate[k] ?? []).every(f => dismissed.has(f.id)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {overdue.length > 0 && (
        <CalSection label="En retard" count={overdue.length} accent="var(--crm-red)" countBg="var(--crm-red-light)" countColor="var(--crm-red)">
          {overdue.map(f => (
            <EventCard key={f.id} f={f} borderColor="var(--crm-red)" bg="#FFF5F3" actions={actions} showDate />
          ))}
        </CalSection>
      )}

      {today.length > 0 && (
        <CalSection label="Aujourd'hui" count={today.length} accent="var(--crm-amber)" countBg="var(--crm-amber-light)" countColor="var(--crm-amber)">
          {today.map(f => (
            <EventCard key={f.id} f={f} borderColor="var(--crm-amber)" bg="#FFFBF0" actions={actions} />
          ))}
        </CalSection>
      )}

      {upcomingKeys.map(key => {
        const items = (upcomingByDate[key] ?? []).filter(f => !dismissed.has(f.id));
        if (items.length === 0) return null;
        const label = isToday(key) ? "Aujourd'hui" : isTomorrow(key) ? "Demain" : fmtDateHeader(key);
        return (
          <CalSection key={key} label={label} count={items.length} accent="var(--crm-blue)" countBg="var(--crm-blue-light)" countColor="var(--crm-blue)">
            {items.map(f => (
              <EventCard key={f.id} f={f} borderColor="var(--crm-blue)" bg="var(--crm-card)" actions={actions} />
            ))}
          </CalSection>
        );
      })}

      {allGone && (
        <div className="crm-card">
          <div className="crm-empty-state">
            <span className="crm-empty-state-icon">🎉</span>
            <p className="crm-empty-state-title">Aucun suivi à venir</p>
            <p className="crm-empty-state-sub">Tous les suivis ont été traités.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Month calendar view ───────────────────────────────────────────────────────

const MONTH_NAMES_FR = [
  "Janvier","Février","Mars","Avril","Mai","Juin",
  "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
];
const DAY_NAMES_FR = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];

function MonthView({
  allFollowUps, dismissed, actions,
}: {
  allFollowUps: CalendarFollowUp[];
  dismissed: Set<string>;
  actions: Actions;
}) {
  const [current, setCurrent] = useState<Date>(() => {
    const d = new Date(); d.setDate(1); return d;
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const year = current.getFullYear();
  const month = current.getMonth();

  // Group visible follow-ups by date key
  const byDate = useMemo<Record<string, CalendarFollowUp[]>>(() => {
    const map: Record<string, CalendarFollowUp[]> = {};
    for (const f of allFollowUps) {
      if (dismissed.has(f.id)) continue;
      const key = f.due_at.slice(0, 10);
      if (!map[key]) map[key] = [];
      map[key].push(f);
    }
    return map;
  }, [allFollowUps, dismissed]);

  // Build grid (Monday-first)
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = (firstDay.getDay() + 6) % 7; // Mon=0 … Sun=6

  const cells: (string | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  const today = todayKey();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const hasAnyThisMonth = Object.keys(byDate).some(k => k.startsWith(monthPrefix));

  const selectedItems = selectedDay ? (byDate[selectedDay] ?? []) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Month navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          onClick={() => setCurrent(new Date(year, month - 1, 1))}
          aria-label="Mois précédent"
          style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--crm-card-border)", background: "var(--crm-card)", cursor: "pointer", fontSize: 16, color: "var(--crm-text2)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >‹</button>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: "var(--crm-text)", margin: 0, flex: 1 }}>
          {MONTH_NAMES_FR[month]} {year}
        </h2>
        <button
          onClick={() => setCurrent(new Date(year, month + 1, 1))}
          aria-label="Mois suivant"
          style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--crm-card-border)", background: "var(--crm-card)", cursor: "pointer", fontSize: 16, color: "var(--crm-text2)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >›</button>
      </div>

      {/* Grid */}
      <div className="crm-card" style={{ padding: 0, overflow: "hidden" }}>
        {/* Day-of-week header */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", background: "var(--crm-bg-alt)", borderBottom: "1px solid var(--crm-card-border)" }}>
          {DAY_NAMES_FR.map(d => (
            <div key={d} style={{ padding: "8px 4px", textAlign: "center", fontSize: 10, fontWeight: 800, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-text3)" }}>
              {d}
            </div>
          ))}
        </div>

        {rows.map((row, ri) => (
          <div key={ri} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {row.map((dateKey, ci) => {
              const borderR = ci < 6 ? "1px solid var(--crm-card-border)" : "none";
              const borderB = ri < rows.length - 1 ? "1px solid var(--crm-card-border)" : "none";

              if (!dateKey) {
                return <div key={ci} style={{ minHeight: 76, background: "var(--crm-bg-alt)", borderRight: borderR, borderBottom: borderB, opacity: 0.35 }} />;
              }

              const items = byDate[dateKey] ?? [];
              const isT = dateKey === today;
              const isSel = dateKey === selectedDay;
              const hasItems = items.length > 0;

              return (
                <div
                  key={ci}
                  onClick={() => hasItems ? setSelectedDay(isSel ? null : dateKey) : undefined}
                  style={{
                    minHeight: 76,
                    padding: "5px 5px 3px",
                    borderRight: borderR,
                    borderBottom: borderB,
                    cursor: hasItems ? "pointer" : "default",
                    background: isSel ? "var(--crm-gold-light)" : isT ? "rgba(59,130,246,0.05)" : "var(--crm-card)",
                    outline: isSel ? "2px solid var(--crm-gold)" : "none",
                    outlineOffset: -2,
                    transition: "background 0.1s",
                  }}
                >
                  {/* Day number circle */}
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    marginBottom: 3,
                    fontSize: 11, fontWeight: isT ? 800 : 600,
                    color: isT ? "#fff" : "var(--crm-text2)",
                    background: isT ? "var(--crm-blue)" : "transparent",
                  }}>
                    {parseInt(dateKey.slice(8))}
                  </div>

                  {/* First 2 follow-ups */}
                  {items.slice(0, 2).map(f => {
                    const name = f.lead?.full_name ?? f.lead?.company_name ?? "—";
                    const past = f.due_at < new Date().toISOString();
                    return (
                      <div key={f.id} style={{
                        fontSize: 10, fontWeight: 600,
                        color: past ? "var(--crm-red)" : "var(--crm-text2)",
                        background: past ? "var(--crm-red-light)" : "var(--crm-bg-alt)",
                        borderLeft: `2px solid ${past ? "var(--crm-red)" : "var(--crm-blue)"}`,
                        borderRadius: 4,
                        padding: "1px 4px",
                        marginBottom: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {name}
                      </div>
                    );
                  })}

                  {items.length > 2 && (
                    <div style={{ fontSize: 10, color: "var(--crm-text3)", fontWeight: 600, paddingLeft: 3 }}>
                      +{items.length - 2}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Selected day detail panel */}
      {selectedDay && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 8, borderBottom: "2px solid var(--crm-gold)" }}>
            <h3 style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.9px", textTransform: "uppercase", color: "var(--crm-text2)", margin: 0, flex: 1 }}>
              {fmtDateHeader(selectedDay)}
            </h3>
            <span style={{ fontSize: 10, fontWeight: 700, background: "var(--crm-gold-light)", color: "var(--crm-gold)", borderRadius: 999, padding: "2px 9px" }}>
              {selectedItems.length} suivi{selectedItems.length > 1 ? "s" : ""}
            </span>
            <button
              onClick={() => setSelectedDay(null)}
              aria-label="Fermer"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--crm-text3)", fontSize: 18, lineHeight: 1, padding: "0 4px" }}
            >×</button>
          </div>

          {selectedItems.length === 0 ? (
            <div className="crm-card">
              <div className="crm-empty-state">
                <p className="crm-empty-state-title" style={{ fontSize: 13 }}>Aucun suivi à venir</p>
              </div>
            </div>
          ) : (
            selectedItems.map(f => (
              <EventCard key={f.id} f={f} borderColor="var(--crm-gold)" bg="var(--crm-card)" actions={actions} showDate />
            ))
          )}
        </div>
      )}

      {/* Empty month state */}
      {!hasAnyThisMonth && (
        <div className="crm-card">
          <div className="crm-empty-state">
            <span className="crm-empty-state-icon">📅</span>
            <p className="crm-empty-state-title">Aucun suivi à venir</p>
            <p className="crm-empty-state-sub">Aucun suivi prévu pour {MONTH_NAMES_FR[month].toLowerCase()} {year}.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function CalSection({ label, count, accent, countBg, countColor, children }: {
  label: string; count: number; accent: string; countBg: string; countColor: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, paddingBottom: 8, borderBottom: `2px solid ${accent}` }}>
        <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.9px", textTransform: "uppercase", color: "var(--crm-text2)", margin: 0, flex: 1 }}>
          {label}
        </h2>
        <span style={{ fontSize: 10, fontWeight: 700, background: countBg, color: countColor, borderRadius: 999, padding: "2px 9px" }}>
          {count}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {children}
      </div>
    </section>
  );
}

// ── Event card ────────────────────────────────────────────────────────────────

function EventCard({ f, borderColor, bg, actions, showDate }: {
  f: CalendarFollowUp;
  borderColor: string;
  bg: string;
  actions: Actions;
  showDate?: boolean;
}) {
  const busy = actions.busyId === f.id;
  const owner = f.lead?.full_name ?? f.lead?.company_name ?? "—";
  const timeStr = showDate
    ? new Date(f.due_at).toLocaleString("fr-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : fmtTime(f.due_at);

  return (
    <div style={{
      background: bg,
      border: "1px solid var(--crm-card-border)",
      borderLeft: `4px solid ${borderColor}`,
      borderRadius: 10,
      padding: "13px 16px",
      display: "flex",
      alignItems: "flex-start",
      gap: 14,
    }}>
      {/* Time */}
      <div style={{ flexShrink: 0, width: showDate ? undefined : 44, textAlign: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "var(--crm-text2)", fontVariantNumeric: "tabular-nums" }}>
          {timeStr}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ fontWeight: 800, fontSize: 14, color: "var(--crm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {owner}
          </span>
          {f.lead?.city && (
            <span style={{ fontSize: 11, color: "var(--crm-text3)", fontWeight: 500, flexShrink: 0 }}>{f.lead.city}</span>
          )}
          <span
            style={{ width: 7, height: 7, borderRadius: "50%", background: priorityDot(f.priority), flexShrink: 0, marginLeft: "auto" }}
            title={`Priorité ${f.priority}`}
          />
        </div>

        {f.note && (
          <p style={{ fontSize: 13, color: "var(--crm-text2)", margin: "0 0 8px", lineHeight: 1.5 }}>{f.note}</p>
        )}

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {f.lead?.address && (
            <span style={{ fontSize: 11, color: "var(--crm-text3)" }}>{f.lead.address}</span>
          )}
          {f.lead?.best_phone && (
            <a href={`tel:${f.lead.best_phone.replace(/\D/g, "")}`} className="crm-phone-link" style={{ fontSize: 12 }}>
              {f.lead.best_phone}
            </a>
          )}
          {f.lead_id && (
            <Link href={`/leads/${f.lead_id}` as never} className="crm-open-lead-link">
              Ouvrir lead →
            </Link>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
        <button
          onClick={() => actions.complete(f.id)}
          disabled={busy}
          style={{ background: "var(--crm-green)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.5 : 1, whiteSpace: "nowrap" }}
        >
          {busy ? "…" : "✓ Fait"}
        </button>
        <button
          onClick={() => actions.cancel(f.id)}
          disabled={busy}
          style={{ background: "#fff", color: "var(--crm-text2)", border: "1px solid var(--crm-card-border)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.5 : 1 }}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
