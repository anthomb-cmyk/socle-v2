"use client";
import { useState } from "react";
import Link from "next/link";
import type { CalendarFollowUp } from "./page";

function priorityDot(p: number) {
  if (p >= 80) return "var(--crm-red)";
  if (p >= 50) return "var(--crm-gold)";
  return "var(--crm-card-border)";
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });
}

function fmtDateHeader(dateKey: string) {
  // dateKey is YYYY-MM-DD
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

export default function CalendarClient({
  overdue,
  today,
  upcomingByDate,
}: {
  overdue: CalendarFollowUp[];
  today: CalendarFollowUp[];
  upcomingByDate: Record<string, CalendarFollowUp[]>;
}) {
  // IDs dismissed (done or cancelled) in this session — hide them optimistically
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

  const upcomingKeys = Object.keys(upcomingByDate).sort();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {error && (
        <div style={{ background: "var(--crm-red-light)", border: "1px solid #FFCDD2", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "var(--crm-red)", fontWeight: 600 }}>
          {error}
        </div>
      )}

      {/* ── Overdue ── */}
      {visible(overdue).length > 0 && (
        <CalSection
          label="En retard"
          count={visible(overdue).length}
          accent="var(--crm-red)"
          countBg="var(--crm-red-light)"
          countColor="var(--crm-red)"
        >
          {visible(overdue).map(f => (
            <EventCard
              key={f.id} f={f}
              borderColor="var(--crm-red)" bg="#FFF5F3"
              busy={busyId === f.id}
              onComplete={() => complete(f.id)}
              onCancel={() => cancel(f.id)}
              showDate
            />
          ))}
        </CalSection>
      )}

      {/* ── Today ── */}
      {visible(today).length > 0 && (
        <CalSection
          label="Aujourd'hui"
          count={visible(today).length}
          accent="var(--crm-amber)"
          countBg="var(--crm-amber-light)"
          countColor="var(--crm-amber)"
        >
          {visible(today).map(f => (
            <EventCard
              key={f.id} f={f}
              borderColor="var(--crm-amber)" bg="#FFFBF0"
              busy={busyId === f.id}
              onComplete={() => complete(f.id)}
              onCancel={() => cancel(f.id)}
            />
          ))}
        </CalSection>
      )}

      {/* ── Upcoming — grouped by date ── */}
      {upcomingKeys.map(key => {
        const items = visible(upcomingByDate[key]);
        if (items.length === 0) return null;
        const label = isToday(key) ? "Aujourd'hui" : isTomorrow(key) ? "Demain" : fmtDateHeader(key);
        return (
          <CalSection
            key={key}
            label={label}
            count={items.length}
            accent="var(--crm-blue)"
            countBg="var(--crm-blue-light)"
            countColor="var(--crm-blue)"
          >
            {items.map(f => (
              <EventCard
                key={f.id} f={f}
                borderColor="var(--crm-blue)" bg="var(--crm-card)"
                busy={busyId === f.id}
                onComplete={() => complete(f.id)}
                onCancel={() => cancel(f.id)}
              />
            ))}
          </CalSection>
        );
      })}
    </div>
  );
}

function CalSection({ label, count, accent, countBg, countColor, children }: {
  label: string; count: number; accent: string; countBg: string; countColor: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      {/* Section header */}
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

function EventCard({ f, borderColor, bg, busy, onComplete, onCancel, showDate }: {
  f: CalendarFollowUp;
  borderColor: string;
  bg: string;
  busy: boolean;
  onComplete: () => void;
  onCancel: () => void;
  showDate?: boolean;
}) {
  const owner = f.lead?.full_name ?? f.lead?.company_name ?? "—";
  const timeStr = showDate
    ? new Date(f.due_at).toLocaleString("fr-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : fmtTime(f.due_at);

  return (
    <div style={{
      background: bg,
      border: `1px solid var(--crm-card-border)`,
      borderLeft: `4px solid ${borderColor}`,
      borderRadius: 10,
      padding: "13px 16px",
      display: "flex",
      alignItems: "flex-start",
      gap: 14,
    }}>
      {/* Time column */}
      <div style={{ flexShrink: 0, width: showDate ? undefined : 44, textAlign: "center" }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "var(--crm-text2)", fontVariantNumeric: "tabular-nums" }}>
          {timeStr}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Owner + city + priority dot */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ fontWeight: 800, fontSize: 14, color: "var(--crm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{owner}</span>
          {f.lead?.city && (
            <span style={{ fontSize: 11, color: "var(--crm-text3)", fontWeight: 500, flexShrink: 0 }}>{f.lead.city}</span>
          )}
          <span
            style={{ width: 7, height: 7, borderRadius: "50%", background: priorityDot(f.priority), flexShrink: 0, marginLeft: "auto" }}
            title={`Priorité ${f.priority}`}
          />
        </div>

        {/* Note */}
        {f.note && (
          <p style={{ fontSize: 13, color: "var(--crm-text2)", margin: "0 0 8px", lineHeight: 1.5 }}>{f.note}</p>
        )}

        {/* Meta */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {f.lead?.address && (
            <span style={{ fontSize: 11, color: "var(--crm-text3)" }}>
              {f.lead.address}
            </span>
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
          onClick={onComplete} disabled={busy}
          style={{ background: "var(--crm-green)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.5 : 1, whiteSpace: "nowrap" }}
        >
          {busy ? "…" : "✓ Fait"}
        </button>
        <button
          onClick={onCancel} disabled={busy}
          style={{ background: "#fff", color: "var(--crm-text2)", border: "1px solid var(--crm-card-border)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.5 : 1 }}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
