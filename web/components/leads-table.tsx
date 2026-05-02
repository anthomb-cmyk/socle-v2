"use client";
import { useEffect, useState, useCallback } from "react";
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

export default function LeadsTable({ canAssign }: { canAssign: boolean }) {
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
    setSuccessMsg(`✓ ${selected.size} leads assignés à ${assigneeName}`);
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        <FilterField label="Campagne">
          <select value={campaignId} onChange={e => setCampaignId(e.target.value)}
            style={filterSelectStyle}>
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
              <option value="brave_queued">brave_queued</option>
              <option value="unresolved_after_brave">non résolu (brave)</option>
              <option value="directory_411_queued">directory_411_queued</option>
              <option value="unresolved_after_411">non résolu (411)</option>
              <option value="places_queued">places_queued</option>
              <option value="unresolved_after_places">non résolu (places)</option>
              <option value="openclaw_queued">openclaw_queued</option>
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
        <FilterField label=" ">
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--crm-text2)", fontWeight: 600, cursor: "pointer", paddingBottom: 1 }}>
            <input type="checkbox" checked={hasPhone} onChange={e => setHasPhone(e.target.checked)} />
            Avec tél.
          </label>
        </FilterField>
        <FilterField label="Recherche" flex>
          <form onSubmit={e => { e.preventDefault(); setQ(qInput); }} style={{ display: "flex", gap: 4 }}>
            <input value={qInput} onChange={e => setQInput(e.target.value)}
              placeholder="Adresse, propriétaire, compagnie…"
              style={{ ...filterSelectStyle, flex: 1, minWidth: 180 }} />
            {qInput && (
              <button type="button" onClick={() => { setQInput(""); setQ(""); }}
                style={{ padding: "0 8px", color: "var(--crm-text3)", background: "none", border: "none", cursor: "pointer", fontSize: 16 }}>×</button>
            )}
          </form>
        </FilterField>
        <div style={{ fontSize: 12, color: "var(--crm-text3)", whiteSpace: "nowrap", paddingBottom: 2 }}>
          {total} lead{total !== 1 ? "s" : ""}
          {phoneReady > 0 && !hasPhone && (
            <span style={{ marginLeft: 6, color: "var(--crm-green)", fontWeight: 700 }}>· {phoneReady} appelables</span>
          )}
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
          <BatchEnrichButton leadIds={[...selected]} onDone={() => { setSelected(new Set()); refresh(); }} />
          <button onClick={() => setSelected(new Set())} style={{ fontSize: 12, color: "var(--crm-text2)", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>Effacer</button>
        </div>
      )}

      {successMsg && (
        <div style={{ background: "var(--crm-green-light)", border: "1px solid #A7F3D0", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "var(--crm-green)", fontWeight: 600 }}>{successMsg}</div>
      )}
      {error && <p style={{ fontSize: 13, color: "var(--crm-red)" }}>{error}</p>}

      {/* ─── Lead rows ─── */}
      <div className="crm-card" style={{ overflow: "hidden", padding: 0 }}>

        {/* Column headers — 5 col (admin) / 3 col (caller) */}
        <div style={{
          display: "grid",
          gridTemplateColumns: canAssign
            ? "24px minmax(0,1fr) minmax(0,160px) 130px 90px"
            : "minmax(0,1fr) 130px 90px",
          gap: 0,
          padding: "8px 14px",
          background: "var(--crm-bg-alt)",
          borderBottom: "1px solid var(--crm-card-border)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.8px",
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
          <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--crm-text3)", fontSize: 13 }}>Chargement…</div>
        )}
        {!loading && leads.length === 0 && (
          <div style={{ padding: "48px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8, color: "var(--crm-text3)" }}>⌖</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--crm-text2)", marginBottom: 4 }}>Aucun lead</div>
            <div style={{ fontSize: 12, color: "var(--crm-text3)" }}>
              Aucun lead ne correspond aux filtres actifs.{" "}
              {canAssign && <Link href="/import" style={{ color: "var(--crm-blue)" }}>Importer un rôle</Link>} pour commencer.
            </div>
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
              className={`${borderClass} ${isSelected ? "crm-row-selected" : ""}`}
              style={{
                display: "grid",
                gridTemplateColumns: canAssign
                  ? "24px minmax(0,1fr) minmax(0,160px) 130px 90px"
                  : "minmax(0,1fr) 130px 90px",
                gap: 0,
                padding: "11px 14px",
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
              <div style={{ minWidth: 0 }}>
                <Link
                  href={detailHref}
                  style={{ fontWeight: 700, fontSize: 14, color: "var(--crm-text)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}
                  onClick={e => e.stopPropagation()}
                >
                  {l.full_name ?? l.company_name ?? "—"}
                </Link>
                <div style={{ fontSize: 12, color: "var(--crm-text2)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.address}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 1, flexWrap: "wrap" }}>
                  {l.city && <span style={{ fontSize: 11, color: "var(--crm-text3)" }}>{l.city}</span>}
                  {l.num_units != null && (
                    <span className="crm-chip crm-chip-units" style={{ fontSize: 10, padding: "1px 5px" }}>{l.num_units} u.</span>
                  )}
                  {l.campaign_name && !canAssign && (
                    <span style={{ fontSize: 11, color: "var(--crm-text3)" }}>· {l.campaign_name}</span>
                  )}
                </div>
              </div>

              {/* Col 3 (admin): Assigned + Campaign */}
              {canAssign && (
                <div style={{ fontSize: 12, color: "var(--crm-text3)", paddingLeft: 10, minWidth: 0 }}>
                  {assignedUser
                    ? <div style={{ fontWeight: 600, color: "var(--crm-text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{assignedUser.display_name}</div>
                    : <div style={{ fontStyle: "italic", color: "var(--crm-text3)" }}>non assigné</div>}
                  {l.campaign_name && (
                    <div style={{ marginTop: 1, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--crm-text3)" }}>
                      {l.campaign_name}
                    </div>
                  )}
                </div>
              )}

              {/* Col 4: Phone */}
              <div style={{ textAlign: "right", paddingLeft: 8 }}>
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
              <div style={{ paddingLeft: 8 }}>
                <span className={`crm-pill ${statusCfg.cls}`}>{statusCfg.label}</span>
              </div>
            </div>
          );
        })}

        {hasMore && (
          <div style={{ borderTop: "1px solid var(--crm-card-border)", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--crm-bg-alt)" }}>
            <span style={{ fontSize: 12, color: "var(--crm-text3)" }}>
              {leads.length} / {total} leads affichés
            </span>
            <button onClick={loadMore} disabled={loadingMore}
              style={{ fontSize: 12, background: "#fff", border: "1px solid var(--crm-card-border)", borderRadius: 8, padding: "6px 14px", cursor: loadingMore ? "wait" : "pointer", color: "var(--crm-text2)", fontWeight: 600, opacity: loadingMore ? 0.5 : 1 }}>
              {loadingMore ? "Chargement…" : `Charger la suite (${total - leads.length} restants)`}
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

function BatchEnrichButton({ leadIds, onDone }: { leadIds: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<typeof ENRICH_TYPES[number]>("find_phone");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function fire() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/enrichment-jobs/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadIds, jobType: type, force }),
    });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) { setMsg(`✗ ${j.error}`); return; }
    const c = j.data.counts;
    setMsg(`✓ ${c.created} créés · ${c.skipped} ignorés · ${c.failed} échecs`);
    setOpen(false);
    onDone();
  }

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ background: "var(--crm-blue)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
        Enrichir ▾
      </button>
      {msg && <span style={{ fontSize: 11, color: "var(--crm-text2)" }}>{msg}</span>}
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
