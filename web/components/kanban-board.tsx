"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

// ── Stage definitions ────────────────────────────────────────────────────────
const CALLING_STAGES = [
  { status: "new",           label: "Nouveau",        color: "#6B7280", bg: "#F9FAFB" },
  { status: "ready_to_call", label: "À appeler",      color: "#2563EB", bg: "#EFF6FF" },
  { status: "in_outreach",   label: "Contacté",       color: "#7C3AED", bg: "#F5F3FF" },
  { status: "no_answer",     label: "Sans réponse",   color: "#D97706", bg: "#FFFBEB" },
  { status: "meeting_set",   label: "RDV fixé",       color: "#C9A84C", bg: "#FEFCE8" },
  { status: "qualified",     label: "Qualifié",       color: "#059669", bg: "#ECFDF5" },
  { status: "rejected",      label: "Fermé / DNC",    color: "#9CA3AF", bg: "#F3F4F6" },
] as const;

type Stage = typeof CALLING_STAGES[number];

type KanbanLead = {
  lead_id: string;
  status: string;
  priority: number;
  assigned_to: string | null;
  address: string;
  city: string | null;
  num_units: number | null;
  full_name: string | null;
  company_name: string | null;
  best_phone: string | null;
  last_contacted_at: string | null;
  display_name?: string | null;
};

function relativeDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}j`;
}

// ── LeadCard ─────────────────────────────────────────────────────────────────
function LeadCard({
  lead,
  onMove,
  stages,
  busy,
}: {
  lead: KanbanLead;
  onMove: (leadId: string, newStatus: string) => void;
  stages: typeof CALLING_STAGES;
  busy: boolean;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const currentIdx = stages.findIndex(s => s.status === lead.status);
  const prevStage = currentIdx > 0 ? stages[currentIdx - 1] : null;
  const nextStage = currentIdx < stages.length - 1 ? stages[currentIdx + 1] : null;

  const label = lead.full_name ?? lead.company_name ?? lead.address;
  const sub = lead.city ? `${lead.address}, ${lead.city}` : lead.address;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 10,
        padding: "10px 12px",
        marginBottom: 8,
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        position: "relative",
      }}
    >
      {/* Priority bar */}
      {lead.priority >= 70 && (
        <div style={{
          position: "absolute", top: 0, left: 0, width: 3, height: "100%",
          background: lead.priority >= 90 ? "#EF4444" : lead.priority >= 70 ? "#F59E0B" : "#3B82F6",
          borderRadius: "10px 0 0 10px",
        }} />
      )}

      <div style={{ paddingLeft: lead.priority >= 70 ? 6 : 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: "#111827", lineHeight: 1.3, marginBottom: 2 }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 4 }}>
          {sub}{lead.num_units ? ` · ${lead.num_units} un.` : ""}
        </div>

        {/* Bottom row */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {lead.best_phone && (
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "#374151", background: "#F3F4F6", padding: "1px 5px", borderRadius: 4 }}>
              {lead.best_phone}
            </span>
          )}
          {lead.display_name && (
            <span style={{ fontSize: 11, color: "#6B7280" }}>@{lead.display_name}</span>
          )}
          {lead.last_contacted_at && (
            <span style={{ fontSize: 11, color: "#9CA3AF", marginLeft: "auto" }}>
              {relativeDate(lead.last_contacted_at)}
            </span>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 4, marginTop: 8, alignItems: "center" }}>
          <Link
            href={`/calls/${lead.lead_id}` as never}
            style={{
              fontSize: 11, color: "#2563EB", textDecoration: "none", padding: "3px 8px",
              border: "1px solid #BFDBFE", borderRadius: 6, background: "#EFF6FF",
              fontWeight: 500,
            }}
          >
            Appeler →
          </Link>
          <Link
            href={`/leads/${lead.lead_id}` as never}
            style={{
              fontSize: 11, color: "#6B7280", textDecoration: "none", padding: "3px 8px",
              border: "1px solid #E5E7EB", borderRadius: 6,
            }}
          >
            Dossier
          </Link>

          {/* Move button */}
          <div style={{ position: "relative", marginLeft: "auto" }}>
            <button
              onClick={() => setShowMenu(v => !v)}
              disabled={busy}
              style={{
                fontSize: 11, color: "#6B7280", background: "none", border: "none",
                cursor: "pointer", padding: "3px 4px", lineHeight: 1,
              }}
              title="Déplacer"
            >
              ⋯
            </button>
            {showMenu && (
              <div style={{
                position: "absolute", right: 0, top: "100%", zIndex: 50,
                background: "#fff", border: "1px solid #E5E7EB", borderRadius: 8,
                boxShadow: "0 4px 12px rgba(0,0,0,0.12)", minWidth: 160, padding: 4,
              }}>
                {stages
                  .filter(s => s.status !== lead.status)
                  .map(s => (
                    <button
                      key={s.status}
                      onClick={() => { onMove(lead.lead_id, s.status); setShowMenu(false); }}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        padding: "6px 10px", fontSize: 12, background: "none",
                        border: "none", cursor: "pointer", borderRadius: 6,
                        color: "#374151",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#F9FAFB")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      → {s.label}
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

// ── KanbanColumn ─────────────────────────────────────────────────────────────
function KanbanColumn({
  stage,
  leads,
  onMove,
  busy,
  stages,
}: {
  stage: Stage;
  leads: KanbanLead[];
  onMove: (leadId: string, newStatus: string) => void;
  busy: string | null;
  stages: typeof CALLING_STAGES;
}) {
  return (
    <div style={{
      minWidth: 240, maxWidth: 280, flex: "0 0 260px",
      display: "flex", flexDirection: "column",
    }}>
      {/* Column header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 10px 6px",
        borderRadius: "10px 10px 0 0",
        background: stage.bg,
        border: `1px solid ${stage.color}30`,
        borderBottom: `2px solid ${stage.color}`,
        marginBottom: 8,
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: stage.color }}>{stage.label}</span>
        <span style={{
          marginLeft: "auto", fontSize: 11, fontWeight: 600,
          background: `${stage.color}20`, color: stage.color,
          padding: "1px 7px", borderRadius: 10,
        }}>{leads.length}</span>
      </div>

      {/* Cards */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 80 }}>
        {leads.length === 0 && (
          <div style={{ padding: "20px 10px", textAlign: "center", color: "#9CA3AF", fontSize: 12 }}>
            Aucun lead
          </div>
        )}
        {leads.map(l => (
          <LeadCard
            key={l.lead_id}
            lead={l}
            onMove={onMove}
            stages={stages}
            busy={busy === l.lead_id}
          />
        ))}
      </div>
    </div>
  );
}

// ── KanbanBoard ───────────────────────────────────────────────────────────────
export default function KanbanBoard({ canEdit }: { canEdit: boolean }) {
  const [leads, setLeads] = useState<KanbanLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [users, setUsers] = useState<Record<string, string>>({});

  const STATUSES = CALLING_STAGES.map(s => s.status).join(",");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch all calling-workflow leads (up to 500)
      const [leadsRes, usersRes] = await Promise.all([
        fetch(`/api/leads?limit=500&status=new`),
        fetch("/api/users"),
      ]);

      // Fetch each status bucket in parallel
      const bucketFetches = await Promise.all(
        CALLING_STAGES.map(s =>
          fetch(`/api/leads?limit=200&status=${s.status}`).then(r => r.json())
        )
      );

      const allLeads: KanbanLead[] = bucketFetches.flatMap(j => j.ok ? (j.data?.leads ?? []) : []);

      const uj = await usersRes.json();
      if (uj.ok) {
        const m: Record<string, string> = {};
        for (const u of uj.data ?? []) m[u.user_id] = u.display_name ?? "";
        setUsers(m);
      }

      // Attach display_name to leads
      setLeads(allLeads.map((l: KanbanLead) => ({
        ...l,
        display_name: l.assigned_to ? (users[l.assigned_to] ?? null) : null,
      })));
    } catch {
      setError("Erreur de chargement");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  // Re-attach display names once users loaded
  useEffect(() => {
    if (Object.keys(users).length > 0) {
      setLeads(prev => prev.map(l => ({
        ...l,
        display_name: l.assigned_to ? (users[l.assigned_to] ?? null) : null,
      })));
    }
  }, [users]);

  async function moveCard(leadId: string, newStatus: string) {
    if (!canEdit) return;
    setBusy(leadId);
    // Optimistic update
    setLeads(prev => prev.map(l => l.lead_id === leadId ? { ...l, status: newStatus } : l));
    try {
      const r = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const j = await r.json();
      if (!j.ok) {
        // Revert
        load();
        setError(j.error);
      }
    } catch {
      load();
      setError("Erreur réseau");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return (
    <div style={{ padding: 40, textAlign: "center", color: "#9CA3AF" }}>Chargement du kanban…</div>
  );

  if (error) return (
    <div style={{ padding: 20, color: "#EF4444", fontSize: 13 }}>{error}</div>
  );

  const byStatus = new Map<string, KanbanLead[]>();
  for (const s of CALLING_STAGES) byStatus.set(s.status, []);
  for (const l of leads) {
    const bucket = byStatus.get(l.status);
    if (bucket) {
      bucket.push(l);
    }
  }

  // Sort each bucket by priority desc
  for (const [, arr] of byStatus) {
    arr.sort((a, b) => b.priority - a.priority);
  }

  const total = leads.length;
  const statSummary = CALLING_STAGES.map(s => ({
    ...s,
    count: byStatus.get(s.status)?.length ?? 0,
  }));

  return (
    <div>
      {/* Mini funnel stats */}
      <div style={{
        display: "flex", gap: 0, marginBottom: 16, borderRadius: 10,
        overflow: "hidden", border: "1px solid #E5E7EB",
      }}>
        {statSummary.map((s, i) => (
          <div
            key={s.status}
            style={{
              flex: 1, padding: "8px 0", textAlign: "center",
              background: s.bg,
              borderRight: i < statSummary.length - 1 ? "1px solid #E5E7EB" : "none",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.count}</div>
            <div style={{ fontSize: 10, color: "#6B7280", marginTop: 1 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Board */}
      <div style={{
        display: "flex",
        gap: 12,
        overflowX: "auto",
        paddingBottom: 16,
        alignItems: "flex-start",
      }}>
        {CALLING_STAGES.map(stage => (
          <KanbanColumn
            key={stage.status}
            stage={stage}
            leads={byStatus.get(stage.status) ?? []}
            onMove={moveCard}
            busy={busy}
            stages={CALLING_STAGES}
          />
        ))}
      </div>
    </div>
  );
}
