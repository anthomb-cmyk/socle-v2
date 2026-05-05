"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────
type CheckItem = { id: string; label: string; done: boolean };
type Deal = {
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
  checklists: Record<string, CheckItem[]>;
  activities: { id: string; text: string; time: string }[];
  updated_at: string;
};

// ── Stage config ──────────────────────────────────────────────────────────────
const ACTIVE_STAGES = [
  { key: "prospection",   label: "Prospection",    color: "#6B7280" },
  { key: "analyse",       label: "Analyse",        color: "#7C3AED" },
  { key: "offre",         label: "Offre déposée",  color: "#2563EB" },
  { key: "due_diligence", label: "Due Diligence",  color: "#D97706" },
  { key: "financement",   label: "Financement",    color: "#059669" },
] as const;

const CLOSED_STAGES = [
  { key: "cloture",   label: "Clôturé",    color: "#10B981" },
  { key: "abandonne", label: "Abandonné",  color: "#EF4444" },
] as const;

const TEMP_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  froid: { label: "Froid",  bg: "#EFF6FF", text: "#1D4ED8" },
  tiede: { label: "Tiède",  bg: "#FFFBEB", text: "#92400E" },
  chaud: { label: "Chaud",  bg: "#FEF2F2", text: "#B91C1C" },
};

const PRIORITY_CONFIG: Record<string, { dot: string }> = {
  low:    { dot: "#9CA3AF" },
  medium: { dot: "#F59E0B" },
  high:   { dot: "#EF4444" },
};

function formatCAD(n: number | null): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
}

function checklistProgress(checklists: Record<string, CheckItem[]>, stage: string): { done: number; total: number } {
  const items = checklists[stage] ?? [];
  return { done: items.filter(i => i.done).length, total: items.length };
}

// ── New Deal Modal ────────────────────────────────────────────────────────────
function NewDealModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (deal: Deal) => void;
}) {
  const [form, setForm] = useState({ title: "", address: "", units: "", asking_price: "", contact_name: "", contact_phone: "", stage: "prospection" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { title: form.title, stage: form.stage };
      if (form.address)       body.address       = form.address;
      if (form.units)         body.units         = parseInt(form.units, 10);
      if (form.asking_price)  body.asking_price  = parseInt(form.asking_price.replace(/\D/g, ""), 10);
      if (form.contact_name)  body.contact_name  = form.contact_name;
      if (form.contact_phone) body.contact_phone = form.contact_phone;

      const res = await fetch("/api/deals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!j.ok) { setErr(j.error); return; }
      onCreate(j.data);
      onClose();
    } catch {
      setErr("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", border: "1px solid #E5E7EB",
    borderRadius: 8, fontSize: 13, background: "#fff", color: "#111827",
    outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: "#fff", borderRadius: 16, padding: "24px 28px",
        width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "#111827" }}>Nouveau deal</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#6B7280" }}>✕</button>
        </div>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>Titre *</label>
            <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Ex: 6-plex Villeray" style={{ ...inputStyle, marginTop: 4 }} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>Stade</label>
              <select value={form.stage} onChange={e => setForm(f => ({ ...f, stage: e.target.value }))}
                style={{ ...inputStyle, marginTop: 4 }}>
                {ACTIVE_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>Unités</label>
              <input type="number" min="1" value={form.units} onChange={e => setForm(f => ({ ...f, units: e.target.value }))}
                placeholder="6" style={{ ...inputStyle, marginTop: 4 }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>Adresse</label>
            <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="123 rue Exemple, Montréal" style={{ ...inputStyle, marginTop: 4 }} />
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>Prix demandé ($)</label>
            <input value={form.asking_price} onChange={e => setForm(f => ({ ...f, asking_price: e.target.value }))}
              placeholder="1100000" style={{ ...inputStyle, marginTop: 4 }} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>Contact</label>
              <input value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                placeholder="Jean Tremblay" style={{ ...inputStyle, marginTop: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>Téléphone</label>
              <input value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))}
                placeholder="514-555-0000" style={{ ...inputStyle, marginTop: 4 }} />
            </div>
          </div>

          {err && <div style={{ fontSize: 12, color: "#EF4444" }}>{err}</div>}

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, padding: "10px", border: "1px solid #E5E7EB",
              borderRadius: 10, fontSize: 13, cursor: "pointer", background: "#F9FAFB", color: "#374151",
            }}>Annuler</button>
            <button type="submit" disabled={loading} style={{
              flex: 2, padding: "10px", border: "none", borderRadius: 10,
              fontSize: 13, fontWeight: 700, cursor: loading ? "wait" : "pointer",
              background: "var(--crm-gold, #C9A84C)", color: "#fff",
              opacity: loading ? 0.7 : 1,
            }}>
              {loading ? "Création…" : "Créer le deal →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Deal Card ─────────────────────────────────────────────────────────────────
const TEMP_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  froid: { label: "FROID",  bg: "#DBEAFE", color: "#1D4ED8" },
  tiede: { label: "TIÈDE",  bg: "#FEF3C7", color: "#92400E" },
  chaud: { label: "CHAUD",  bg: "#FEE2E2", color: "#B91C1C" },
};

function ContactAvatar({ name }: { name: string | null }) {
  if (!name) return null;
  const initials = name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  // Deterministic color from name
  const colors = ["#E0E7FF","#D1FAE5","#FEF3C7","#FCE7F3","#E0F2FE","#F3E8FF"];
  const textColors = ["#4338CA","#065F46","#92400E","#9D174D","#0369A1","#6B21A8"];
  const idx = name.charCodeAt(0) % colors.length;
  return (
    <div style={{
      width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
      background: colors[idx], color: textColors[idx],
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 10, fontWeight: 800, letterSpacing: "0.5px",
    }}>
      {initials}
    </div>
  );
}

function DealCard({ deal, onStageChange }: { deal: Deal; onStageChange: (dealId: string, newStage: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const tempBadge = TEMP_BADGE[deal.temperature] ?? TEMP_BADGE.tiede;
  const prio = PRIORITY_CONFIG[deal.priority] ?? PRIORITY_CONFIG.medium;
  const { done, total } = checklistProgress(deal.checklists, deal.stage);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const allStages = [...ACTIVE_STAGES, ...CLOSED_STAGES];

  return (
    <div style={{
      background: "#fff",
      border: "1px solid #E8EAED",
      borderRadius: 10,
      padding: "12px 14px",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      position: "relative",
      transition: "box-shadow 0.15s ease",
    }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)")}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)")}
    >
      {/* Priority dot */}
      <div style={{
        position: "absolute", top: 12, right: 12,
        width: 7, height: 7, borderRadius: "50%",
        background: prio.dot,
      }} />

      {/* Contact row */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <ContactAvatar name={deal.contact_name} />
        <span style={{ fontSize: 11, color: "#6B7280", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {deal.contact_name ?? "Contact à définir"}
        </span>
        {/* Stage change menu */}
        <div style={{ position: "relative" }}>
          <button onClick={() => setMenuOpen(o => !o)} style={{
            fontSize: 18, background: "none", border: "none",
            cursor: "pointer", color: "#D1D5DB", padding: "0 2px", lineHeight: 1,
          }}>⋯</button>
          {menuOpen && (
            <div style={{
              position: "absolute", right: 0, top: "100%", zIndex: 50,
              background: "#fff", border: "1px solid #E5E7EB",
              borderRadius: 10, padding: "6px 0", minWidth: 155,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", padding: "4px 12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Déplacer vers</div>
              {allStages.filter(s => s.key !== deal.stage).map(s => (
                <button key={s.key} onClick={() => { onStageChange(deal.id, s.key); setMenuOpen(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "7px 12px", background: "none", border: "none",
                    cursor: "pointer", fontSize: 12, color: "#374151",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#F9FAFB")}
                  onMouseLeave={e => (e.currentTarget.style.background = "none")}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Title */}
      <Link href={`/pipeline/${deal.id}` as never} style={{ textDecoration: "none" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", lineHeight: 1.35, marginBottom: 2 }}>
          {deal.title}
        </div>
        {deal.address && (
          <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {deal.address}{deal.units ? ` · ${deal.units} u.` : ""}
          </div>
        )}
      </Link>

      {/* Price row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: "var(--crm-gold, #C9A84C)", flex: 1 }}>
          {deal.asking_price ? formatCAD(deal.asking_price) : "Prix : TBD"}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: "0.4px",
          padding: "2px 7px", borderRadius: 6,
          background: tempBadge.bg, color: tempBadge.color,
        }}>{tempBadge.label}</span>
      </div>

      {/* Checklist + docs row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#9CA3AF" }}>
        <span>Checklist {pct}%</span>
        {total > 0 && (
          <div style={{ flex: 1, height: 3, background: "#F3F4F6", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 2,
              width: `${pct}%`,
              background: pct === 100 ? "#059669" : "var(--crm-gold, #C9A84C)",
            }} />
          </div>
        )}
      </div>

      {/* Open button */}
      <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
        <Link href={`/pipeline/${deal.id}` as never} style={{
          fontSize: 11, fontWeight: 700, color: "var(--crm-gold, #C9A84C)",
          textDecoration: "none", padding: "4px 10px",
          border: "1px solid #E5E7EB", borderRadius: 6,
          background: "#FAFAFA",
        }}>
          Ouvrir →
        </Link>
      </div>
    </div>
  );
}

// ── Pipeline Column ───────────────────────────────────────────────────────────
function PipelineColumn({
  stageKey, label, color, deals, onStageChange,
}: {
  stageKey: string;
  label: string;
  color: string;
  deals: Deal[];
  onStageChange: (dealId: string, newStage: string) => void;
}) {
  const totalValue = deals.reduce((sum, d) => sum + (d.asking_price ?? 0), 0);

  return (
    <div style={{
      minWidth: 240, width: 260, flexShrink: 0,
      display: "flex", flexDirection: "column",
    }}>
      {/* Column header */}
      <div style={{
        borderRadius: "12px 12px 0 0",
        borderBottom: `3px solid ${color}`,
        padding: "10px 14px",
        background: "#F9FAFB",
        marginBottom: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: "#111827", flex: 1 }}>{label}</span>
          <span style={{
            fontSize: 11, fontWeight: 700,
            padding: "2px 8px", borderRadius: 10,
            background: color + "22", color,
          }}>{deals.length}</span>
        </div>
        {totalValue > 0 && (
          <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2 }}>
            {formatCAD(totalValue)} total
          </div>
        )}
      </div>

      {/* Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        {deals.length === 0 ? (
          <div style={{
            border: "1px dashed #E5E7EB", borderRadius: 10,
            padding: "20px 14px", textAlign: "center",
            fontSize: 12, color: "#D1D5DB",
          }}>
            Aucun deal
          </div>
        ) : (
          deals.map(deal => (
            <DealCard key={deal.id} deal={deal} onStageChange={onStageChange} />
          ))
        )}
      </div>
    </div>
  );
}

// ── Main PipelineClient ───────────────────────────────────────────────────────
export default function PipelineClient({
  initialDeals,
  closedDeals,
}: {
  initialDeals: Deal[];
  closedDeals: Deal[];
}) {
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [showClosed, setShowClosed] = useState(false);
  const [showNewDeal, setShowNewDeal] = useState(false);
  const router = useRouter();

  const handleStageChange = useCallback(async (dealId: string, newStage: string) => {
    // Optimistic update
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: newStage, updated_at: new Date().toISOString() } : d));

    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage }),
      });
      const j = await res.json();
      if (!j.ok) {
        // Revert on error
        setDeals(initialDeals);
        alert("Erreur: " + j.error);
      }
    } catch {
      setDeals(initialDeals);
    }
  }, [initialDeals]);

  const handleCreate = useCallback((newDeal: Deal) => {
    setDeals(prev => [newDeal, ...prev]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (router as any).push(`/pipeline/${newDeal.id}`);
  }, [router]);

  // Group by stage
  const dealsByStage = ACTIVE_STAGES.reduce((acc, s) => {
    acc[s.key] = deals.filter(d => d.stage === s.key);
    return acc;
  }, {} as Record<string, Deal[]>);

  const closedByStage = CLOSED_STAGES.reduce((acc, s) => {
    acc[s.key] = closedDeals.filter(d => d.stage === s.key);
    return acc;
  }, {} as Record<string, Deal[]>);

  const totalActive = deals.length;
  const totalValue = deals.reduce((sum, d) => sum + (d.asking_price ?? 0), 0);

  return (
    <div style={{ padding: "24px 24px 40px" }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "var(--crm-text)", letterSpacing: "-0.3px" }}>
            Pipeline d&apos;acquisitions
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--crm-text3, #6B7280)" }}>
            {totalActive} deals actifs · {formatCAD(totalValue)} en jeu
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => setShowClosed(o => !o)}
            style={{
              fontSize: 12, padding: "8px 14px",
              border: "1px solid #E5E7EB", borderRadius: 10,
              background: showClosed ? "#F3F4F6" : "#fff",
              color: "#374151", cursor: "pointer", fontWeight: 600,
            }}
          >
            {showClosed ? "▲ Masquer clôturés" : "▼ Voir clôturés"}
          </button>
          <button
            onClick={() => setShowNewDeal(true)}
            style={{
              fontSize: 13, padding: "8px 18px",
              border: "none", borderRadius: 10, fontWeight: 700,
              background: "var(--crm-gold, #C9A84C)", color: "#fff",
              cursor: "pointer", boxShadow: "0 2px 8px rgba(201,168,76,0.35)",
            }}
          >
            + Nouveau deal
          </button>
        </div>
      </div>

      {/* ── Active kanban ── */}
      <div style={{
        display: "flex", gap: 14, overflowX: "auto",
        paddingBottom: 20, alignItems: "flex-start",
      }}>
        {ACTIVE_STAGES.map(stage => (
          <PipelineColumn
            key={stage.key}
            stageKey={stage.key}
            label={stage.label}
            color={stage.color}
            deals={dealsByStage[stage.key] ?? []}
            onStageChange={handleStageChange}
          />
        ))}
      </div>

      {/* ── Closed deals toggle ── */}
      {showClosed && (
        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 14 }}>
            Deals fermés
          </div>
          <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 12 }}>
            {CLOSED_STAGES.map(stage => (
              <PipelineColumn
                key={stage.key}
                stageKey={stage.key}
                label={stage.label}
                color={stage.color}
                deals={closedByStage[stage.key] ?? []}
                onStageChange={handleStageChange}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── New deal modal ── */}
      {showNewDeal && (
        <NewDealModal
          onClose={() => setShowNewDeal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
