"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Lead = {
  lead_id: string;
  status: string;
  priority: number;
  assigned_to: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  address: string;
  city: string | null;
  num_units: number | null;
  contact_kind: string;
  full_name: string | null;
  company_name: string | null;
  best_phone: string | null;
  last_contacted_at: string | null;
};

type User = { user_id: string; display_name: string; role: string };
type Campaign = { id: string; name: string };

const PAGE_SIZE = 100;

// ── V1-style status pills ─────────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  new:                      { label: "Nouveau",        cls: "crm-pill--nouveau" },
  ready_to_call:            { label: "À appeler",      cls: "crm-pill--a-appeler" },
  in_outreach:              { label: "Contacté",       cls: "crm-pill--contacte" },
  no_answer:                { label: "Sans réponse",   cls: "crm-pill--sans-reponse" },
  meeting_set:              { label: "RDV fixé",       cls: "crm-pill--rdv-fixe" },
  qualified:                { label: "Qualifié",       cls: "crm-pill--qualifie" },
  rejected:                 { label: "Fermé",          cls: "crm-pill--ferme" },
  do_not_contact:           { label: "DNC",            cls: "crm-pill--dnc" },
  // Enrichment
  needs_enrichment:         { label: "Enrichissement", cls: "crm-pill--enrichissement" },
  needs_human_review:       { label: "À vérifier",    cls: "crm-pill--a-verifier" },
  brave_queued:             { label: "Brave…",         cls: "crm-pill--pipeline" },
  unresolved_after_brave:   { label: "Non résolu",     cls: "crm-pill--non-resolu" },
  directory_411_queued:     { label: "411…",           cls: "crm-pill--pipeline" },
  unresolved_after_411:     { label: "Non résolu",     cls: "crm-pill--non-resolu" },
  places_queued:            { label: "Places…",        cls: "crm-pill--pipeline" },
  unresolved_after_places:  { label: "Non résolu",     cls: "crm-pill--non-resolu" },
  openclaw_queued:          { label: "OpenClaw…",      cls: "crm-pill--pipeline" },
  no_contact_found:         { label: "Introuvable",    cls: "crm-pill--ferme" },
  phone_verified:           { label: "Tél. vérifié",   cls: "crm-pill--qualifie" },
  enrichment_pending:       { label: "En attente",     cls: "crm-pill--pipeline" },
  enrichment_running:       { label: "En cours…",      cls: "crm-pill--pipeline" },
};

function statusConfig(status: string) {
  return STATUS_CFG[status] ?? { label: status.replace(/_/g, " "), cls: "crm-pill--nouveau" };
}

// Left-border color by priority (0–100 scale) or special statuses
function rowBorderClass(priority: number, status: string): string {
  if (status === "do_not_contact" || status === "rejected") return "crm-row-done";
  if (status === "needs_human_review" || status === "meeting_set") return "crm-row-warm";
  if (status === "qualified" || status === "phone_verified") return "crm-row-cold";
  if (priority >= 80) return "crm-row-hot";
  if (priority >= 50) return "crm-row-warm";
  return "crm-row-normal";
}

function formatPhone(phone: string): string {
  const m = phone.replace(/\D/g, "");
  if (m.length === 11 && m[0] === "1") return `(${m.slice(1,4)}) ${m.slice(4,7)}-${m.slice(7)}`;
  if (m.length === 10) return `(${m.slice(0,3)}) ${m.slice(3,6)}-${m.slice(6)}`;
  return phone;
}

// ── Batch progress types ─────────────────────────────────────────────────────

type BatchStatus = {
  total: number;
  by_status: { pending: number; processing: number; completed: number; failed: number; cancelled: number };
  candidates_total: number;
  auto_attached_count: number;
  needs_review_count: number;
  leads_with_phone: number;
  elapsed_seconds: number | null;
};

type BatchProgress = {
  leadIds: string[];
  status: BatchStatus | null;
  done: boolean;
  dismissed: boolean;
};

export default function LeadsTable({ canAssign }: { canAssign: boolean }) {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);

  // Filters
  const [city, setCity] = useState("");
  const [status, setStatus] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [hasPhone, setHasPhone] = useState(false);
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");

  // Selection + bulk ops
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTarget, setAssignTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Batch enrichment progress panel
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const buildParams = useCallback((currentOffset = 0) => {
    const params = new URLSearchParams();
    if (city) params.set("city", city);
    if (status) params.set("status", status);
    if (campaignId) params.set("campaign_id", campaignId);
    if (assignedTo) params.set("assigned_to", assignedTo);
    if (hasPhone) params.set("has_phone", "1");
    if (q) params.set("q", q);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(currentOffset));
    return params;
  }, [city, status, campaignId, assignedTo, hasPhone, q]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOffset(0);
    const resp = await fetch(`/api/leads?${buildParams(0)}`);
    const json = await resp.json();
    setLoading(false);
    if (!json.ok) { setError(json.error); return; }
    setLeads(json.data.leads);
    setTotal(json.data.total);
    setCities(json.data.cities ?? []);
    setCampaigns(json.data.campaigns ?? []);
  }, [buildParams]);

  async function loadMore() {
    const nextOffset = offset + PAGE_SIZE;
    setLoadingMore(true);
    const resp = await fetch(`/api/leads?${buildParams(nextOffset)}`);
    const json = await resp.json();
    setLoadingMore(false);
    if (!json.ok) return;
    setLeads(prev => [...prev, ...json.data.leads]);
    setOffset(nextOffset);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [city, status, campaignId, assignedTo, hasPhone, q]);

  useEffect(() => {
    if (!canAssign) return;
    fetch("/api/users").then(r => r.json()).then(j => j.ok && setUsers(j.data));
  }, [canAssign]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  function startBatchProgress(leadIds: string[]) {
    setBatchProgress({ leadIds, status: null, done: false, dismissed: false });

    // Poll every 2 seconds
    const poll = async () => {
      try {
        const r = await fetch(`/api/enrichment/batch-status?leadIds=${leadIds.join(",")}`);
        const j = await r.json();
        if (!j.ok) return;
        const s: BatchStatus = j.data;
        const inProgress = s.by_status.pending + s.by_status.processing;
        const done = inProgress === 0;
        setBatchProgress(prev => prev ? { ...prev, status: s, done } : null);
        if (done) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          router.refresh();
        }
      } catch {
        // swallow network errors during polling
      }
    };

    poll();
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(poll, 2000);
  }

  function stopBatchProgress() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setBatchProgress(null);
  }

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; });
  }
  function toggleAll() {
    setSelected(selected.size === leads.length ? new Set() : new Set(leads.map(l => l.lead_id)));
  }
  function selectPhoneReady() {
    setSelected(new Set(leads.filter(l => l.best_phone).map(l => l.lead_id)));
  }

  async function bulkAssign() {
    if (selected.size === 0 || !assignTarget) return;
    setBusy(true); setError(null); setSuccessMsg(null);
    const resp = await fetch("/api/leads/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadIds: [...selected],
        userId: assignTarget === "__unassign__" ? null : assignTarget,
      }),
    });
    const json = await resp.json();
    setBusy(false);
    if (!json.ok) { setError(json.error); return; }
    const assigneeName = users.find(u => u.user_id === assignTarget)?.display_name ?? "caller";
    setSuccessMsg(`${selected.size} leads assignés à ${assigneeName}`);
    setSelected(new Set());
    setAssignTarget("");
    refresh();
    setTimeout(() => setSuccessMsg(null), 4000);
  }

  const hasMore = leads.length < total;
  const phoneReady = leads.filter(l => l.best_phone).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ─── Filter bar ─── */}
      <div style={{
        background: "var(--crm-card)",
        border: "1px solid var(--crm-card-border)",
        borderRadius: 10,
        padding: "12px 14px",
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "flex-end",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}>
        <FilterField label="Campagne">
          <select value={campaignId} onChange={e => setCampaignId(e.target.value)} style={filterSelectStyle}>
            <option value="">Toutes les campagnes</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FilterField>
        <FilterField label="Ville">
          <select value={city} onChange={e => setCity(e.target.value)} style={filterSelectStyle}>
            <option value="">Toutes les villes</option>
            {cities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </FilterField>
        <FilterField label="Statut">
          <select value={status} onChange={e => setStatus(e.target.value)} style={filterSelectStyle}>
            <option value="">Tous les statuts</option>
            <optgroup label="Appels">
              <option value="new">Nouveau</option>
              <option value="ready_to_call">À appeler</option>
              <option value="in_outreach">Contacté</option>
              <option value="no_answer">Sans réponse</option>
              <option value="meeting_set">RDV fixé</option>
              <option value="qualified">Qualifié</option>
              <option value="rejected">Fermé</option>
              <option value="do_not_contact">DNC</option>
            </optgroup>
            <optgroup label="Pipeline enrichissement">
              <option value="needs_enrichment">Enrichissement</option>
              <option value="needs_human_review">À vérifier</option>
              <option value="phone_verified">Tél. vérifié</option>
              <option value="brave_queued">Brave…</option>
              <option value="directory_411_queued">411…</option>
              <option value="places_queued">Places…</option>
              <option value="openclaw_queued">OpenClaw…</option>
              <option value="no_contact_found">Introuvable</option>
            </optgroup>
          </select>
        </FilterField>
        {canAssign && (
          <FilterField label="Assigné à">
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} style={filterSelectStyle}>
              <option value="">Tout le monde</option>
              <option value="unassigned">Non assigné</option>
              <option value="assigned">Assigné</option>
              {users.map(u => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}
            </select>
          </FilterField>
        )}
        <FilterField label="Recherche" flex>
          <form onSubmit={e => { e.preventDefault(); setQ(qInput); }} style={{ display: "flex", gap: 4 }}>
            <input value={qInput} onChange={e => setQInput(e.target.value)}
              placeholder="Adresse, propriétaire, compagnie…"
              style={{ ...filterSelectStyle, flex: 1, minWidth: 180 }} />
            {qInput && (
              <button type="button" onClick={() => { setQInput(""); setQ(""); }}
                style={{ padding: "0 8px", color: "var(--crm-text3)", background: "none", border: "none", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>
                ×
              </button>
            )}
          </form>
        </FilterField>
        {/* Quick filters */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--crm-text2)", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={hasPhone} onChange={e => setHasPhone(e.target.checked)} />
            Avec tél.
          </label>
          <div style={{ fontSize: 12, color: "var(--crm-text3)", whiteSpace: "nowrap" }}>
            <strong style={{ color: "var(--crm-text2)" }}>{total}</strong> lead{total !== 1 ? "s" : ""}
            {phoneReady > 0 && !hasPhone && (
              <span style={{ marginLeft: 6, color: "var(--crm-green)", fontWeight: 700 }}>· {phoneReady} appelables</span>
            )}
          </div>
        </div>
      </div>

      {/* ─── Bulk action bar ─── */}
      {canAssign && selected.size > 0 && (
        <div style={{
          background: "var(--crm-gold-light)",
          border: "1px solid var(--crm-gold-border)",
          borderRadius: 12,
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          position: "sticky",
          top: 8,
          zIndex: 10,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--crm-text)" }}>{selected.size} sélectionné{selected.size > 1 ? "s" : ""}</span>
          <button onClick={selectPhoneReady} style={{ fontSize: 11, color: "var(--crm-text2)", border: "1px solid var(--crm-card-border)", background: "#fff", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>
            Avec tél. seulement
          </button>
          <select value={assignTarget} onChange={e => setAssignTarget(e.target.value)}
            style={{ ...filterSelectStyle, fontSize: 12 }}>
            <option value="">Assigner à…</option>
            {users.filter(u => u.role === "caller" || u.role === "cold_caller").map(u => (
              <option key={u.user_id} value={u.user_id}>{u.display_name}</option>
            ))}
            <option value="__unassign__">— Désassigner —</option>
          </select>
          <button onClick={bulkAssign} disabled={busy || !assignTarget}
            style={{ background: "var(--crm-gold)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: (busy || !assignTarget) ? 0.5 : 1 }}>
            {busy ? "En cours…" : "Appliquer"}
          </button>
          <span style={{ borderLeft: "1px solid var(--crm-gold-border)", height: 20 }} />
          <BatchEnrichButton
            leadIds={[...selected]}
            onDone={(enrichedIds) => {
              setSelected(new Set());
              startBatchProgress(enrichedIds);
            }}
          />
          <button onClick={() => setSelected(new Set())} style={{ fontSize: 12, color: "var(--crm-text2)", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Effacer</button>
        </div>
      )}

      {successMsg && (
        <div style={{ background: "var(--crm-green-light)", border: "1px solid #A7F3D0", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "var(--crm-green)", fontWeight: 600 }}>{successMsg}</div>
      )}
      {error && <p style={{ fontSize: 13, color: "var(--crm-red)" }}>{error}</p>}

      {/* ─── Batch enrichment progress panel ─── */}
      {batchProgress && !batchProgress.dismissed && (
        <BatchProgressPanel
          progress={batchProgress}
          onCancel={stopBatchProgress}
          onDismiss={() => setBatchProgress(null)}
        />
      )}

      {/* ─── Lead rows ─── */}
      <div className="crm-card" style={{ overflow: "hidden", padding: 0 }}>

        {/* Column headers — 5 col (admin) / 3 col (caller) */}
        <div className="crm-leads-table-header" style={{
          display: "grid",
          gridTemplateColumns: canAssign
            ? "28px minmax(0,1fr) minmax(0,160px) 150px 100px"
            : "minmax(0,1fr) 150px 100px",
          gap: 0,
          padding: "9px 16px",
          background: "var(--crm-bg-alt)",
          borderBottom: "1px solid var(--crm-card-border)",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.9px",
          textTransform: "uppercase",
          color: "var(--crm-text3)",
          alignItems: "center",
        }}>
          {canAssign && (
            <div>
              <input type="checkbox"
                checked={leads.length > 0 && selected.size === leads.length}
                ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < leads.length; }}
                onChange={toggleAll}
              />
            </div>
          )}
          <div>Propriétaire · Immeuble</div>
          {canAssign && <div>Assigné · Campagne</div>}
          <div style={{ textAlign: "right" }}>Téléphone</div>
          <div>Statut</div>
        </div>

        {loading && (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--crm-text3)", fontSize: 13 }}>
            <div style={{ marginBottom: 6, fontSize: 18, opacity: 0.4 }}>⟳</div>
            Chargement des leads…
          </div>
        )}
        {!loading && leads.length === 0 && (
          <div className="crm-empty-state">
            <span className="crm-empty-state-icon">⌖</span>
            <p className="crm-empty-state-title">Aucun lead trouvé</p>
            <p className="crm-empty-state-sub">
              Aucun lead ne correspond aux filtres actifs.
              {canAssign && <> <Link href="/import" style={{ color: "var(--crm-blue)" }}>Importer un rôle</Link> pour commencer.</>}
            </p>
          </div>
        )}

        {leads.map((l, idx) => {
          const detailHref = (canAssign ? `/leads/${l.lead_id}` : `/calls/${l.lead_id}`) as never;
          const assignedUser = users.find(u => u.user_id === l.assigned_to);
          const statusCfg = statusConfig(l.status);
          const borderClass = rowBorderClass(l.priority, l.status);
          const isSelected = selected.has(l.lead_id);

          return (
            <div
              key={l.lead_id}
              className={`crm-leads-row ${borderClass} ${isSelected ? "crm-row-selected" : ""}`}
              style={{
                display: "grid",
                gridTemplateColumns: canAssign
                  ? "28px minmax(0,1fr) minmax(0,160px) 150px 100px"
                  : "minmax(0,1fr) 150px 100px",
                gap: 0,
                padding: "13px 16px",
                borderTop: idx === 0 ? "none" : "1px solid var(--crm-card-border)",
                alignItems: "center",
                transition: "background 0.1s",
                cursor: "pointer",
              }}
              onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "var(--crm-bg)"; }}
              onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = ""; }}
            >
              {/* Col 1 (admin): checkbox */}
              {canAssign && (
                <div onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggle(l.lead_id)} />
                </div>
              )}

              {/* Col 2: Owner + Property */}
              <div className="crm-leads-col-owner" style={{ minWidth: 0 }}>
                <Link
                  href={detailHref}
                  style={{ fontWeight: 700, fontSize: 14, color: "var(--crm-text)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", lineHeight: 1.3 }}
                  onClick={e => e.stopPropagation()}
                >
                  {l.full_name ?? l.company_name ?? "—"}
                </Link>
                <div style={{ fontSize: 12, color: "var(--crm-text2)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.address}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
                  {l.city && <span style={{ fontSize: 11, color: "var(--crm-text3)", fontWeight: 500 }}>{l.city}</span>}
                  {l.num_units != null && (
                    <span className="crm-chip crm-chip-units" style={{ fontSize: 10, padding: "1px 6px" }}>{l.num_units}&thinsp;u.</span>
                  )}
                  {l.campaign_name && !canAssign && (
                    <span style={{ fontSize: 11, color: "var(--crm-text3)" }}>· {l.campaign_name}</span>
                  )}
                </div>
              </div>

              {/* Col 3 (admin): Assigned + Campaign */}
              {canAssign && (
                <div style={{ fontSize: 12, paddingLeft: 12, minWidth: 0 }}>
                  {assignedUser ? (
                    <div style={{ fontWeight: 700, color: "var(--crm-text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {assignedUser.display_name}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: "var(--crm-text3)", fontStyle: "italic" }}>non assigné</div>
                  )}
                  {l.campaign_name && (
                    <div style={{ marginTop: 2, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--crm-text3)" }}>
                      {l.campaign_name}
                    </div>
                  )}
                </div>
              )}

              {/* Col 4: Phone */}
              <div className="crm-leads-col-phone" style={{ textAlign: "right", paddingLeft: 8 }}>
                {l.best_phone ? (
                  <a
                    href={`tel:${l.best_phone.replace(/\D/g, "")}`}
                    className="crm-phone-link"
                    onClick={e => e.stopPropagation()}
                    style={{ justifyContent: "flex-end", fontSize: 13 }}
                  >
                    {formatPhone(l.best_phone)}
                  </a>
                ) : (
                  <span className="crm-no-phone">sans tél.</span>
                )}
              </div>

              {/* Col 5: Status pill */}
              <div className="crm-leads-col-status" style={{ paddingLeft: 8 }}>
                <span className={`crm-pill ${statusCfg.cls}`}>{statusCfg.label}</span>
              </div>
            </div>
          );
        })}

        {hasMore && (
          <div style={{ borderTop: "1px solid var(--crm-card-border)", padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--crm-bg-alt)", borderRadius: "0 0 10px 10px" }}>
            <span style={{ fontSize: 12, color: "var(--crm-text3)", fontWeight: 500 }}>
              <strong style={{ color: "var(--crm-text2)" }}>{leads.length}</strong> / {total} leads affichés
            </span>
            <button onClick={loadMore} disabled={loadingMore} className="crm-btn" style={{ opacity: loadingMore ? 0.5 : 1, cursor: loadingMore ? "wait" : "pointer" }}>
              {loadingMore ? "Chargement…" : `Charger la suite · ${total - leads.length} restants`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function FilterField({ label, flex, children }: { label: string; flex?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ flex: flex ? 1 : undefined, minWidth: flex ? 180 : undefined }}>
      <label style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const filterSelectStyle: React.CSSProperties = {
  border: "1px solid var(--crm-card-border)",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 12,
  background: "#fff",
  color: "var(--crm-text)",
  outline: "none",
};

const ENRICH_TYPES = ["find_phone", "verify_phone", "find_email", "find_website", "owner_identity", "property_context"] as const;

function BatchEnrichButton({ leadIds, onDone }: { leadIds: string[]; onDone: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<typeof ENRICH_TYPES[number]>("find_phone");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function fire() {
    setBusy(true); setErrMsg(null);
    setOpen(false);
    // Fire without awaiting — progress panel shows immediately
    fetch("/api/enrichment-jobs/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadIds, jobType: type, force }),
    }).then(r => r.json()).then(j => {
      if (!j.ok) setErrMsg(`Erreur : ${j.error}`);
    }).catch(() => {
      // swallow — progress panel handles status
    });
    setBusy(false);
    onDone(leadIds);
  }

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ background: "var(--crm-blue)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
        Enrichir ▾
      </button>
      {errMsg && <span style={{ fontSize: 11, color: "var(--crm-red)" }}>{errMsg}</span>}
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "#fff", border: "1px solid var(--crm-card-border)", borderRadius: 12, boxShadow: "0 8px 28px rgba(0,0,0,.10)", padding: 12, zIndex: 20, minWidth: 220 }}>
          <label style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 4 }}>Type de job</label>
          <select value={type} onChange={e => setType(e.target.value as typeof ENRICH_TYPES[number])}
            style={{ ...filterSelectStyle, width: "100%", marginBottom: 8 }}>
            {ENRICH_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--crm-text2)", marginBottom: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />
            Forcer même si job existant
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={fire} disabled={busy}
              style={{ flex: 1, background: "var(--crm-text)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontWeight: 700, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Envoi…" : `Lancer ${leadIds.length} job(s)`}
            </button>
            <button onClick={() => setOpen(false)}
              style={{ border: "1px solid var(--crm-card-border)", background: "#fff", borderRadius: 8, padding: "7px 10px", fontSize: 12, cursor: "pointer" }}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Batch progress panel ─────────────────────────────────────────────────────

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function BatchProgressPanel({
  progress,
  onCancel,
  onDismiss,
}: {
  progress: BatchProgress;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const { status, done, leadIds } = progress;
  const total = status?.total ?? leadIds.length;
  const completed = status?.by_status.completed ?? 0;
  const failed = status?.by_status.failed ?? 0;
  const finishedCount = completed + failed;
  const pct = total > 0 ? Math.round((finishedCount / total) * 100) : 0;
  const elapsed = status?.elapsed_seconds ?? null;

  if (done && status) {
    // Summary view
    return (
      <div style={{
        background: "var(--crm-green-light)",
        border: "1px solid #A7F3D0",
        borderRadius: 12,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18, color: "var(--crm-green)" }}>OK</span>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--crm-green)" }}>Enrichissement terminé</span>
          </div>
          <button onClick={onDismiss} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--crm-text3)", lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontSize: 13, color: "var(--crm-text2)", margin: 0 }}>
          <strong>{total}</strong> leads enrichis · <strong>{status.leads_with_phone}</strong> téléphones attachés · <strong>{status.needs_review_count}</strong> à réviser · <strong>{failed}</strong> échecs
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {status.needs_review_count > 0 && (
            <Link href="/phone-review" style={{ background: "var(--crm-blue)", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
              Voir les téléphones à réviser →
            </Link>
          )}
          <Link href="/leads?status=ready_to_call" style={{ background: "var(--crm-green)", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
            Voir les leads prêts à appeler →
          </Link>
          <button onClick={onDismiss} style={{ border: "1px solid var(--crm-card-border)", background: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", color: "var(--crm-text2)" }}>
            Fermer
          </button>
        </div>
      </div>
    );
  }

  // In-progress view
  return (
    <div style={{
      background: "var(--crm-card)",
      border: "1px solid var(--crm-card-border)",
      borderRadius: 12,
      padding: "14px 18px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, animation: "spin 1.2s linear infinite", display: "inline-block" }}>⟳</span>
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--crm-text)" }}>Enrichissement en cours</span>
          {elapsed !== null && (
            <span style={{ fontSize: 12, color: "var(--crm-text3)", fontVariantNumeric: "tabular-nums" }}>{fmtTime(elapsed)}</span>
          )}
        </div>
        <button onClick={onCancel} style={{ fontSize: 12, color: "var(--crm-text3)", background: "none", border: "1px solid var(--crm-card-border)", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
          Annuler
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 6, background: "var(--crm-bg-alt)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--crm-blue)", borderRadius: 99, transition: "width 0.4s ease" }} />
      </div>

      <p style={{ fontSize: 12, color: "var(--crm-text2)", margin: 0 }}>
        <strong>{finishedCount}</strong> / {total} enrichis
        {status && (
          <>
            {" · "}<strong>{status.candidates_total}</strong> candidats
            {" · "}<strong>{status.leads_with_phone}</strong> téléphones attachés
            {failed > 0 && <> · <span style={{ color: "var(--crm-red)" }}><strong>{failed}</strong> échecs</span></>}
          </>
        )}
      </p>
    </div>
  );
}
