"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type FollowUp = {
  id: string; lead_id: string | null; due_at: string; note: string;
  priority: number; status: string; source: string | null;
  lead: { full_name: string | null; company_name: string | null; address: string; city: string | null; best_phone: string | null } | null;
};

function priorityColor(p: number): string {
  if (p >= 80) return "var(--crm-red)";
  if (p >= 50) return "var(--crm-gold)";
  return "var(--crm-text3)";
}

function fmtDue(iso: string) {
  return new Date(iso).toLocaleString("fr-CA", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function FollowUpsList() {
  const [overdue, setOverdue] = useState<FollowUp[]>([]);
  const [today, setToday] = useState<FollowUp[]>([]);
  const [upcoming, setUpcoming] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const [a, b, c] = await Promise.all([
      fetch("/api/follow-ups?bucket=overdue").then(r => r.json()),
      fetch("/api/follow-ups?bucket=today").then(r => r.json()),
      fetch("/api/follow-ups?bucket=upcoming").then(r => r.json()),
    ]);
    setOverdue(a.ok ? a.data : []);
    setToday(b.ok ? b.data : []);
    setUpcoming(c.ok ? c.data : []);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function complete(id: string) {
    setBusyId(id); setError(null);
    const r = await fetch(`/api/follow-ups/${id}/complete`, { method: "POST" });
    const j = await r.json();
    setBusyId(null);
    if (!j.ok) { setError(j.error); return; }
    refresh();
  }

  async function cancel(id: string) {
    if (!confirm("Annuler ce suivi ?")) return;
    setBusyId(id); setError(null);
    const r = await fetch(`/api/follow-ups/${id}`, { method: "DELETE" });
    const j = await r.json();
    setBusyId(null);
    if (!j.ok) { setError(j.error); return; }
    refresh();
  }

  if (loading) {
    return (
      <div className="crm-empty-state">
        <span className="crm-empty-state-icon" style={{ fontSize: 18, opacity: 0.4 }}>⟳</span>
        <p className="crm-empty-state-title">Chargement des suivis…</p>
      </div>
    );
  }

  const total = overdue.length + today.length + upcoming.length;
  if (total === 0) {
    return (
      <div className="crm-card">
        <div className="crm-empty-state">
          <span className="crm-empty-state-icon">🎉</span>
          <p className="crm-empty-state-title">Aucun suivi en attente</p>
          <p className="crm-empty-state-sub">Tout est à jour. Bon travail !</p>
        </div>
      </div>
    );
  }

  const sections: Array<{ label: string; fr: string; items: FollowUp[]; accent: string; bg: string }> = [
    { label: "overdue",  fr: "En retard",      items: overdue,  accent: "var(--crm-red)",   bg: "#FFF5F3" },
    { label: "today",    fr: "Aujourd'hui",     items: today,    accent: "var(--crm-amber)", bg: "#FFFBF0" },
    { label: "upcoming", fr: "À venir",         items: upcoming, accent: "var(--crm-blue)",  bg: "var(--crm-card)" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {error && (
        <div style={{ background: "var(--crm-red-light)", border: "1px solid #FFCDD2", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "var(--crm-red)", fontWeight: 600 }}>
          {error}
        </div>
      )}
      {sections.filter(s => s.items.length > 0).map(s => (
        <section key={s.label}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase", color: "var(--crm-text3)" }}>{s.fr}</span>
            <span style={{ fontSize: 10, fontWeight: 700, background: s.label === "overdue" ? "var(--crm-red-light)" : "var(--crm-bg-alt)", color: s.label === "overdue" ? "var(--crm-red)" : "var(--crm-text2)", borderRadius: 999, padding: "1px 8px" }}>{s.items.length}</span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {s.items.map(f => (
              <FollowUpCard
                key={f.id}
                f={f}
                accent={s.accent}
                bg={s.bg}
                busy={busyId === f.id}
                onComplete={() => complete(f.id)}
                onCancel={() => cancel(f.id)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function FollowUpCard({ f, accent, bg, busy, onComplete, onCancel }: {
  f: FollowUp; accent: string; bg: string; busy: boolean;
  onComplete: () => void; onCancel: () => void;
}) {
  const owner = f.lead?.full_name ?? f.lead?.company_name ?? "—";

  return (
    <li style={{
      background: bg,
      border: `1px solid var(--crm-card-border)`,
      borderLeft: `4px solid ${accent}`,
      borderRadius: 10,
      padding: "13px 16px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Owner + city */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontWeight: 800, fontSize: 14, color: "var(--crm-text)" }}>{owner}</span>
          {f.lead?.city && (
            <span style={{ fontSize: 11, color: "var(--crm-text3)", fontWeight: 500 }}>{f.lead.city}</span>
          )}
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: priorityColor(f.priority), flexShrink: 0, marginLeft: "auto" }} title={`Priorité ${f.priority}`} />
        </div>

        {/* Note */}
        {f.note && (
          <p style={{ fontSize: 13, color: "var(--crm-text2)", margin: "0 0 8px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{f.note}</p>
        )}

        {/* Meta row */}
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--crm-text3)", fontWeight: 500 }}>📅 {fmtDue(f.due_at)}</span>
          {f.lead?.best_phone && (
            <a href={`tel:${f.lead.best_phone.replace(/\D/g, "")}`} className="crm-phone-link" style={{ fontSize: 12 }}>
              {f.lead.best_phone}
            </a>
          )}
          {f.source && <span style={{ fontSize: 11, color: "var(--crm-text3)" }}>via {f.source}</span>}
          {f.lead_id && (
            <>
              <Link href={`/calls/${f.lead_id}` as never}
                style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "var(--crm-green)", borderRadius: 8, padding: "4px 10px", textDecoration: "none", whiteSpace: "nowrap" }}>
                📞 Appeler
              </Link>
              <Link href={`/leads/${f.lead_id}` as never} className="crm-open-lead-link">
                Fiche →
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
        <button
          onClick={onComplete}
          disabled={busy}
          style={{ background: "var(--crm-green)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.5 : 1, whiteSpace: "nowrap" }}
        >
          {busy ? "…" : "✓ Fait"}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          style={{ background: "#fff", color: "var(--crm-text2)", border: "1px solid var(--crm-card-border)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.5 : 1 }}
        >
          Annuler
        </button>
      </div>
    </li>
  );
}
