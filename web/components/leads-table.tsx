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

// ── Shared redesign status pills ──────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  new:                      { label: "Nouveau",        cls: "pill--new" },
  ready_to_call:            { label: "À appeler",      cls: "pill--ready" },
  in_outreach:              { label: "Contacté",       cls: "pill--review" },
  no_answer:                { label: "Sans réponse",   cls: "pill--cold" },
  meeting_set:              { label: "RDV fixé",       cls: "pill--info" },
  qualified:                { label: "Qualifié",       cls: "pill--ready" },
  rejected:                 { label: "Fermé",          cls: "pill--cold" },
  do_not_contact:           { label: "DNC",            cls: "pill--cold" },
  // Enrichment
  needs_enrichment:         { label: "Enrichissement", cls: "pill--pipeline" },
  needs_human_review:       { label: "À vérifier",    cls: "pill--review" },
  brave_queued:             { label: "Brave…",         cls: "pill--pipeline" },
  unresolved_after_brave:   { label: "Non résolu",     cls: "pill--cold" },
  directory_411_queued:     { label: "411…",           cls: "pill--pipeline" },
  unresolved_after_411:     { label: "Non résolu",     cls: "pill--cold" },
  places_queued:            { label: "Places…",        cls: "pill--pipeline" },
  unresolved_after_places:  { label: "Non résolu",     cls: "pill--cold" },
  openclaw_queued:          { label: "OpenClaw…",      cls: "pill--pipeline" },
  no_contact_found:         { label: "Introuvable",    cls: "pill--cold" },
  phone_verified:           { label: "Tél. vérifié",   cls: "pill--ready" },
  enrichment_pending:       { label: "En attente",     cls: "pill--pipeline" },
  enrichment_running:       { label: "En cours…",      cls: "pill--pipeline" },
};

function statusConfig(status: string) {
  return STATUS_CFG[status] ?? { label: status.replace(/_/g, " "), cls: "crm-pill--nouveau" };
}

// Left-border color by priority (0–100 scale) or special statuses
function rowRailClass(priority: number, status: string): string {
  if (status === "do_not_contact" || status === "rejected") return "rail-done";
  if (status === "needs_human_review" || status === "meeting_set") return "rail-warm";
  if (status === "qualified" || status === "phone_verified") return "rail-cold";
  if (priority >= 80) return "rail-hot";
  if (priority >= 50) return "rail-warm";
  return "rail-normal";
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
  const activeFilters = [
    status ? statusConfig(status).label : null,
    campaignId ? campaigns.find(c => c.id === campaignId)?.name ?? "Campagne" : null,
    assignedTo ? assignedTo === "unassigned" ? "Non assigné" : assignedTo === "assigned" ? "Assigné" : users.find(u => u.user_id === assignedTo)?.display_name ?? "Assigné" : null,
    city || null,
    hasPhone ? "Avec tél." : null,
  ].filter(Boolean) as string[];

  return (
    <section className="socle-page">
      <header className="socle-page-head">
        <div>
          <div className="socle-crumb">Pipeline appels</div>
          <h1 className="socle-title">Leads</h1>
          <p className="socle-sub">
            {total.toLocaleString("fr-CA")} leads dans la vue · {phoneReady.toLocaleString("fr-CA")} appelables
          </p>
        </div>
        <div className="socle-head-actions">
          <span className="pill pill--ready"><span className="pill__dot" />{phoneReady} prêts</span>
          <span className="pill pill--brand">{selected.size} sélectionnés</span>
        </div>
      </header>

      {/* ─── Filter bar ─── */}
      <div className="socle-filters">
        <div className="socle-search">
          <Icon name="search" size={15} />
          <form onSubmit={e => { e.preventDefault(); setQ(qInput); }} style={{ display: "contents" }}>
            <input value={qInput} onChange={e => setQInput(e.target.value)}
              placeholder="Adresse, propriétaire, compagnie…" />
          </form>
          {qInput && (
            <button type="button" onClick={() => { setQInput(""); setQ(""); }} className="btn btn--ghost btn--sm" aria-label="Effacer la recherche">
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
        <FilterField label="Campagne">
          <select value={campaignId} onChange={e => setCampaignId(e.target.value)} className="socle-select">
            <option value="">Toutes les campagnes</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FilterField>
        <FilterField label="Ville">
          <select value={city} onChange={e => setCity(e.target.value)} className="socle-select">
            <option value="">Toutes les villes</option>
            {cities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </FilterField>
        <FilterField label="Statut">
          <select value={status} onChange={e => setStatus(e.target.value)} className="socle-select">
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
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className="socle-select">
              <option value="">Tout le monde</option>
              <option value="unassigned">Non assigné</option>
              <option value="assigned">Assigné</option>
              {users.map(u => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}
            </select>
          </FilterField>
        )}
        <button type="button" onClick={() => setHasPhone(v => !v)} className={`socle-filter${hasPhone ? " socle-filter--active" : ""}`}>
          <Icon name="phone" size={12} />
          Avec tél.
        </button>
        <div style={{ display: "none" }}>
          <label>
            <input type="checkbox" checked={hasPhone} onChange={e => setHasPhone(e.target.checked)} />
          </label>
        </div>
        {activeFilters.map(f => (
          <span key={f} className="pill pill--brand">{f}</span>
        ))}
      </div>

      {/* ─── Bulk action bar ─── */}
      {canAssign && selected.size > 0 && (
        <div className="socle-bulk" style={{ position: "sticky", top: 8, zIndex: 10 }}>
          <span className="socle-bulk__count"><span className="socle-bulk__n">{selected.size}</span> sélectionné{selected.size > 1 ? "s" : ""}</span>
          <button onClick={selectPhoneReady} className="btn btn--sm">
            Avec tél. seulement
          </button>
          <select value={assignTarget} onChange={e => setAssignTarget(e.target.value)}
            className="socle-select">
            <option value="">Assigner à…</option>
            {users.filter(u => u.role === "caller" || u.role === "cold_caller").map(u => (
              <option key={u.user_id} value={u.user_id}>{u.display_name}</option>
            ))}
            <option value="__unassign__">— Désassigner —</option>
          </select>
          <button onClick={bulkAssign} disabled={busy || !assignTarget}
            className="btn btn--gold btn--sm" style={{ opacity: (busy || !assignTarget) ? 0.5 : 1 }}>
            {busy ? "En cours…" : "Appliquer"}
          </button>
          <span style={{ borderLeft: "1px solid var(--gold-border)", height: 20 }} />
          <BatchEnrichButton
            leadIds={[...selected]}
            onDone={(enrichedIds) => {
              setSelected(new Set());
              startBatchProgress(enrichedIds);
            }}
          />
          <button onClick={() => setSelected(new Set())} className="btn btn--ghost btn--sm">Effacer</button>
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
      <div className="socle-table">

        {/* Column headers — 5 col (admin) / 3 col (caller) */}
        <div className="socle-thead crm-leads-table-header" style={{
          gridTemplateColumns: canAssign
            ? "28px 1.4fr 1.2fr .8fr .5fr .8fr .9fr .8fr 56px"
            : "1.4fr 1.2fr .8fr .5fr .9fr .8fr 56px",
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
          <div>Propriétaire</div>
          <div>Immeuble</div>
          <div>Ville</div>
          <div>Portes</div>
          {canAssign && <div>Campagne</div>}
          <div>Téléphone</div>
          <div>Statut</div>
          <div />
        </div>

        {loading && (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--crm-text3)", fontSize: 13 }}>
            <Icon name="loader" size={20} />
            Chargement des leads…
          </div>
        )}
        {!loading && leads.length === 0 && (
          <div className="crm-empty-state">
            <span className="crm-empty-state-icon"><Icon name="search" size={26} /></span>
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
          const railClass = rowRailClass(l.priority, l.status);
          const isSelected = selected.has(l.lead_id);

          return (
            <div
              key={l.lead_id}
              className={`socle-tr crm-leads-row ${railClass} ${isSelected ? "socle-tr--selected" : ""}`}
              style={{
                gridTemplateColumns: canAssign
                  ? "28px 1.4fr 1.2fr .8fr .5fr .8fr .9fr .8fr 56px"
                  : "1.4fr 1.2fr .8fr .5fr .9fr .8fr 56px",
                borderTop: idx === 0 ? "none" : undefined,
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
                  className="socle-name"
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", lineHeight: 1.3 }}
                  onClick={e => e.stopPropagation()}
                >
                  {l.full_name ?? l.company_name ?? "—"}
                </Link>
                <div className="socle-subline">{assignedUser?.display_name ?? "non assigné"}</div>
              </div>
              <div className="socle-muted" style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "var(--crm-text2)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.address}
                </div>
              </div>
              <div className="socle-subline">{l.city ?? "—"}</div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{l.num_units ?? "—"}</div>
              {canAssign && (
                <div className="socle-subline" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.campaign_name ?? "—"}
                </div>
              )}

              {/* Col 4: Phone */}
              <div className="crm-leads-col-phone">
                {l.best_phone ? (
                  <a
                    href={`tel:${l.best_phone.replace(/\D/g, "")}`}
                    className="socle-phone"
                    onClick={e => e.stopPropagation()}
                  >
                    {formatPhone(l.best_phone)}
                  </a>
                ) : (
                  <span className="socle-phone--missing">sans tél.</span>
                )}
              </div>

              {/* Col 5: Status pill */}
              <div className="crm-leads-col-status">
                <span className={`pill ${statusCfg.cls}`}><span className="pill__dot" />{statusCfg.label}</span>
              </div>
              <Link href={detailHref} className="btn btn--ghost btn--sm" onClick={e => e.stopPropagation()} aria-label="Ouvrir le lead">
                <Icon name="arrowRight" size={14} />
              </Link>
            </div>
          );
        })}

        {hasMore && (
          <div className="socle-pager">
            <span style={{ fontSize: 12, color: "var(--crm-text3)", fontWeight: 500 }}>
              <strong style={{ color: "var(--crm-text2)" }}>{leads.length}</strong> / {total} leads affichés
            </span>
            <button onClick={loadMore} disabled={loadingMore} className="btn" style={{ opacity: loadingMore ? 0.5 : 1, cursor: loadingMore ? "wait" : "pointer" }}>
              {loadingMore ? "Chargement…" : `Charger la suite · ${total - leads.length} restants`}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function FilterField({ label, flex, children }: { label: string; flex?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ flex: flex ? 1 : undefined, minWidth: flex ? 180 : undefined, display: "flex", flexDirection: "column", gap: 4 }}>
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
      <button onClick={() => setOpen(o => !o)} className="btn btn--primary btn--sm">
        Enrichir <Icon name="chevronDown" size={12} />
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
              style={{ border: "1px solid var(--crm-card-border)", background: "#fff", borderRadius: 8, padding: "7px 10px", fontSize: 12, cursor: "pointer" }} aria-label="Fermer"><Icon name="x" size={14} /></button>
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
            <Icon name="check" size={18} />
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--crm-green)" }}>Enrichissement terminé</span>
          </div>
          <button onClick={onDismiss} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--crm-text3)", lineHeight: 1 }} aria-label="Fermer"><Icon name="x" size={16} /></button>
        </div>
        <p style={{ fontSize: 13, color: "var(--crm-text2)", margin: 0 }}>
          <strong>{total}</strong> leads enrichis · <strong>{status.leads_with_phone}</strong> téléphones attachés · <strong>{status.needs_review_count}</strong> à réviser · <strong>{failed}</strong> échecs
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {status.needs_review_count > 0 && (
            <Link href="/phone-review" style={{ background: "var(--crm-blue)", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
              Voir les téléphones à réviser
            </Link>
          )}
          <Link href="/leads?status=ready_to_call" style={{ background: "var(--crm-green)", color: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
            Voir les leads prêts à appeler
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
          <span style={{ animation: "spin 1.2s linear infinite", display: "inline-flex" }}><Icon name="loader" size={16} /></span>
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

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: <path d="M21 21l-4.3-4.3M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4z" />,
    x: <path d="M6 6l12 12M18 6L6 18" />,
    phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
    arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
    chevronDown: <path d="M6 9l6 6 6-6" />,
    check: <path d="M20 6L9 17l-5-5" />,
    loader: (
      <>
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {paths[name] ?? paths.search}
    </svg>
  );
}
