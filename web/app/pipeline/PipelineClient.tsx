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
  froid: { label: "❄️ Froid",  bg: "#EFF6FF", text: "#1D4ED8" },
  tiede: { label: "🌤 Tiède",  bg: "#FFFBEB", text: "#92400E" },
  chaud: { label: "🔥 Chaud",  bg: "#FEF2F2", text: "#B91C1C" },
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
function DealCard({ deal, onStageChange }: { deal: Deal; onStageChange: (dealId: string, newStage: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const temp = TEMP_CONFIG[deal.temperature] ?? TEMP_CONFIG.tiede;
  const prio = PRIORITY_CONFIG[deal.priority] ?? PRIORITY_CONFIG.medium;
  const { done, total } = checklistProgress(deal.checklists, deal.stage);
  const docsCount = 0; // document count not loaded in list view

  const allStages = [...ACTIVE_STAGES, ...CLOSED_STAGES];

  return (
    <div style={{
      background: "#fff",
      border: "1px solid #E5E7EB",
      borderRadius: 12,
      padding: "12px 14px",
      boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
      position: "relative",
    }}>
      {/* Priority dot */}
      <div style={{
        position: "absolute", top: 10, right: 10,
        width: 8, height: 8, borderRadius: "50%",
        background: prio.dot,
      }} />

      {/* Title */}
      <Link href={`/pipeline/${deal.id}` as never} style={{ textDecoration: "none" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginRight: 16, marginBottom: 3, lineHeight: 1.3 }}>
          {deal.title}
        </div>
      </Link>

      {/* Address + units */}
      {deal.address && (
        <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {deal.address}{deal.units ? ` · ${deal.units} unités` : ""}
        </div>
      )}

      {/* Price + temperature */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {deal.asking_price && (
          <span style={{ fontSize: 13, fontWeight: 700, color: "#059669" }}>
            {formatCAD(deal.asking_price)}
          </span>
        )}
        {deal.offer_price && deal.offer_price !== deal.asking_price && (
          <span style={{ fontSize: 11, color: "#7C3AED", fontWeight: 600 }}>
            → offre {formatCAD(deal.offer_price)}
          </span>
        )}
        <span style={{
          marginLeft: "auto",
          fontSize: 10, fontWeight: 700,
          padding: "2px 7px", borderRadius: 8,
          background: temp.bg, color: temp.text,
        }}>{temp.label}</span>
      </div>

      {/* Checklist progress */}
      {total > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9CA3AF", marginBottom: 3 }}>
            <span>Checklist {deal.stage}</span>
            <span style={{ color: done === total ? "#059669" : "#6B7280", fontWeight: 700 }}>{done}/{total}</span>
          </div>
          <div style={{ height: 3, background: "#F3F4F6", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 2,
              width: `${total > 0 ? Math.round((done / total) * 100) : 0}%`,
              background: done === total ? "#059669" : "var(--crm-gold, #C9A84C)",
              transition: "width 0.3s ease",
            }} />
          </div>
        </div>
      )}

      {/* Contact + Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {deal.contact_name && (
          <div style={{
            width: 24, height: 24, borderRadius: "50%",
            background: "#E5E7EB", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 700, color: "#374151", flexShrink: 0,
          }}>
            {deal.contact_name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
          </div>
        )}
        {docsCount > 0 && (
          <span style={{ fontSize: 10, color: "#6B7280" }}>📎 {docsCount}</span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
          <Link href={`/pipeline/${deal.id}` as never} style={{
            fontSize: 10, fontWeight: 600, color: "var(--crm-gold, #C9A84C)",
            textDecoration: "none", padding: "3px 8px",
            border: "1px solid var(--crm-gold, #C9A84C)", borderRadius: 6,
          }}>
            Ouvrir →
          </Link>
          {/* Stage change menu */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setMenuOpen(o => !o)} style={{
              fontSize: 16, background: "none", border: "none",
              cursor: "pointer", color: "#9CA3AF", padding: "0 4px", lineHeight: 1,
            }}>⋯</button>
            {menuOpen && (
              <div style={{
                position: "absolute", right: 0, top: "100%", zIndex: 50,
                background: "#fff", border: "1px solid #E5E7EB",
                borderRadius: 10, padding: "6px 0", minWidth: 160,
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", padding: "4px 12px", textTransform: "uppercase" }}>Déplacer vers</div>
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
