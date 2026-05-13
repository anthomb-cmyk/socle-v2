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
  return STATUS_CFG[status] ?? { label: status.replace(/_/g, " "), cls: "pill--cold" };
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

// Grid templates — kept in sync between thead and rows.
const ADMIN_GRID  = "28px 1.4fr 1.2fr .8fr .5fr .8fr .9fr .8fr 56px";
const CALLER_GRID = "1.4fr 1.2fr .8fr .5fr .9fr .8fr 56px";

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

  const gridTemplate = canAssign ? ADMIN_GRID : CALLER_GRID;

  return (
    <section className="lt-page">
      <header className="lt-head">
        <div>
          <div className="lt-head__crumb">CRM · Leads</div>
          <h1 className="lt-head__t">Leads</h1>
          <p className="lt-head__sub">
            <span className="mono">{total.toLocaleString("fr-CA")}</span> au total · <span className="mono">{phoneReady.toLocaleString("fr-CA")}</span> avec téléphone
          </p>
        </div>
        <div className="lt-head__act">
          <span className="pill pill--ready"><span className="pill__dot" /><span className="mono">{phoneReady}</span> prêts</span>
          {selected.size > 0 && (
            <span className="pill pill--brand"><span className="mono">{selected.size}</span> sélectionnés</span>
          )}
        </div>
      </header>

      {/* ─── Filter bar ─── */}
      <div className="lt-filters">
        <div className="lt-search">
          <Icon name="search" size={15} />
          <form onSubmit={e => { e.preventDefault(); setQ(qInput); }} style={{ display: "contents" }}>
            <input value={qInput} onChange={e => setQInput(e.target.value)}
              placeholder="Adresse, propriétaire, compagnie…" />
          </form>
          {qInput && (
            <button type="button" onClick={() => { setQInput(""); setQ(""); }} className="lt-menu" aria-label="Effacer la recherche">
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        <select value={campaignId} onChange={e => setCampaignId(e.target.value)} className="lt-select" aria-label="Campagne">
          <option value="">Toutes les campagnes</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <select value={city} onChange={e => setCity(e.target.value)} className="lt-select" aria-label="Ville">
          <option value="">Toutes les villes</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <select value={status} onChange={e => setStatus(e.target.value)} className="lt-select" aria-label="Statut">
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

        {canAssign && (
          <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className="lt-select" aria-label="Assigné à">
            <option value="">Tout le monde</option>
            <option value="unassigned">Non assigné</option>
            <option value="assigned">Assigné</option>
            {users.map(u => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}
          </select>
        )}

        <button
          type="button"
          onClick={() => setHasPhone(v => !v)}
          className={`lt-filter${hasPhone ? " lt-filter--active" : ""}`}
        >
          Avec tél.
        </button>

        {activeFilters.map(f => (
          <span key={f} className="pill pill--brand">{f}</span>
        ))}
      </div>

      {/* ─── Bulk action bar ─── */}
      {canAssign && selected.size > 0 && (
        <div className="lt-bulk" style={{ position: "sticky", top: 8, zIndex: 10 }}>
          <span className="lt-bulk__count">
            <span className="lt-bulk__n">{selected.size}</span>
            sélectionné{selected.size > 1 ? "s" : ""}
          </span>
          <button onClick={selectPhoneReady} className="btn btn--sm">
            Avec tél. seulement
          </button>
          <select value={assignTarget} onChange={e => setAssignTarget(e.target.value)} className="lt-select">
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
          <button onClick={() => setSelected(new Set())} className="btn btn--ghost btn--sm" style={{ marginLeft: "auto" }}>Effacer</button>
        </div>
      )}

      {successMsg && (
        <div style={{ background: "var(--green-soft)", border: "1px solid var(--green-border)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "oklch(0.34 0.10 150)", fontWeight: 600, marginBottom: 14 }}>{successMsg}</div>
      )}
      {error && <p style={{ fontSize: 13, color: "var(--red)", marginBottom: 14 }}>{error}</p>}

      {/* ─── Batch enrichment progress panel ─── */}
      {batchProgress && !batchProgress.dismissed && (
        <BatchProgressPanel
          progress={batchProgress}
          onCancel={stopBatchProgress}
          onDismiss={() => setBatchProgress(null)}
        />
      )}

      {/* ─── Lead rows ─── */}
      <div className="lt-table">

        <div className="lt-thead" style={{ gridTemplateColumns: gridTemplate }}>
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
          <div>Adresse</div>
          <div>Ville</div>
          <div>Log.</div>
          {canAssign && <div>Campagne</div>}
          <div>Téléphone</div>
          <div>Statut</div>
          <div />
        </div>

        {loading && (
          <div className="lt-empty">
            <span className="lt-empty__icon"><Icon name="loader" size={20} /></span>
            <p className="lt-empty__title">Chargement des leads…</p>
          </div>
        )}
        {!loading && leads.length === 0 && (
          <div className="lt-empty">
            <span className="lt-empty__icon"><Icon name="search" size={20} /></span>
            <p className="lt-empty__title">Aucun lead trouvé</p>
            <p className="lt-empty__sub">
              Aucun lead ne correspond aux filtres actifs.
              {canAssign && <> <Link href="/import" style={{ color: "var(--gold-deep)", fontWeight: 600 }}>Importer un rôle</Link> pour commencer.</>}
            </p>
          </div>
        )}

        {leads.map((l) => {
          const detailHref = (canAssign ? `/leads/${l.lead_id}` : `/calls/${l.lead_id}`) as never;
          const assignedUser = users.find(u => u.user_id === l.assigned_to);
          const statusCfg = statusConfig(l.status);
          const railClass = rowRailClass(l.priority, l.status);
          const isSelected = selected.has(l.lead_id);
          const ownerName = l.full_name ?? l.company_name ?? "—";
          const subline = canAssign
            ? (assignedUser?.display_name ?? "non assigné")
            : (l.contact_kind === "company" ? "Société" : "Particulier");

          return (
            <div
              key={l.lead_id}
              className={`lt-tr ${railClass}${isSelected ? " lt-tr--selected" : ""}`}
              style={{ gridTemplateColumns: gridTemplate }}
              onClick={() => router.push(detailHref)}
            >
              {canAssign && (
                <div onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(l.lead_id)}
                    aria-label={`Sélectionner ${ownerName}`}
                  />
                </div>
              )}

              {/* Propriétaire */}
              <div style={{ minWidth: 0 }}>
                <Link href={detailHref} className="lt-name" onClick={e => e.stopPropagation()}>
                  {ownerName}
                </Link>
                <div className="lt-name__sub">{subline}</div>
              </div>

              {/* Adresse */}
              <div style={{ minWidth: 0 }}>
                <div className="lt-addr">{l.address}</div>
              </div>

              {/* Ville */}
              <div className="lt-addr__city">{l.city ?? "—"}</div>

              {/* Logements */}
              <div className="lt-units">{l.num_units ?? "—"}</div>

              {/* Campagne (admin only) */}
              {canAssign && (
                <div className="lt-campaign">{l.campaign_name ?? "—"}</div>
              )}

              {/* Téléphone */}
              <div>
                {l.best_phone ? (
                  <a
                    href={`tel:${l.best_phone.replace(/\D/g, "")}`}
                    className="lt-phone"
                    onClick={e => e.stopPropagation()}
                  >
                    {formatPhone(l.best_phone)}
                  </a>
                ) : (
                  <span className="lt-phone--missing">— sans tél.</span>
                )}
              </div>

              {/* Statut */}
              <div>
                <span className={`pill ${statusCfg.cls}`}><span className="pill__dot" />{statusCfg.label}</span>
              </div>

              {/* Ouvrir */}
              <Link href={detailHref} className="lt-menu" onClick={e => e.stopPropagation()} aria-label="Ouvrir le lead">
                <Icon name="arrowRight" size={14} />
              </Link>
            </div>
          );
        })}

        {hasMore && (
          <div className="lt-pager">
            <span>
              <span className="mono">{leads.length}</span> / <span className="mono">{total}</span> leads affichés
            </span>
            <button onClick={loadMore} disabled={loadingMore} className="btn btn--sm" style={{ opacity: loadingMore ? 0.5 : 1, cursor: loadingMore ? "wait" : "pointer" }}>
              {loadingMore ? "Chargement…" : `Charger la suite · ${total - leads.length} restants`}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

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
      <button onClick={() => setOpen(o => !o)} className="btn btn--sm">
        Enrichir <Icon name="chevronDown" size={12} />
      </button>
      {errMsg && <span style={{ fontSize: 11, color: "var(--red)" }}>{errMsg}</span>}
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 12, boxShadow: "var(--sh-2)", padding: 12, zIndex: 20, minWidth: 220 }}>
          <label style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 4 }}>Type de job</label>
          <select value={type} onChange={e => setType(e.target.value as typeof ENRICH_TYPES[number])}
            className="lt-select" style={{ width: "100%", marginBottom: 8 }}>
            {ENRICH_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)", marginBottom: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />
            Forcer même si job existant
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={fire} disabled={busy} className="btn btn--gold btn--sm" style={{ flex: 1, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Envoi…" : `Lancer ${leadIds.length} job(s)`}
            </button>
            <button onClick={() => setOpen(false)} className="btn btn--ghost btn--sm" aria-label="Fermer"><Icon name="x" size={14} /></button>
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
    return (
      <div style={{
        background: "var(--green-soft)",
        border: "1px solid var(--green-border)",
        borderRadius: 12,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        marginBottom: 14,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="check" size={18} />
            <span style={{ fontWeight: 700, fontSize: 14, color: "oklch(0.34 0.10 150)" }}>Enrichissement terminé</span>
          </div>
          <button onClick={onDismiss} className="lt-menu" aria-label="Fermer"><Icon name="x" size={16} /></button>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-2)", margin: 0 }}>
          <strong className="mono">{total}</strong> leads enrichis · <strong className="mono">{status.leads_with_phone}</strong> téléphones attachés · <strong className="mono">{status.needs_review_count}</strong> à réviser · <strong className="mono">{failed}</strong> échecs
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {status.needs_review_count > 0 && (
            <Link href="/phone-review" className="btn btn--sm">
              Voir les téléphones à réviser
            </Link>
          )}
          <Link href="/leads?status=ready_to_call" className="btn btn--gold btn--sm">
            Voir les leads prêts à appeler
          </Link>
          <button onClick={onDismiss} className="btn btn--ghost btn--sm">
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border-soft)",
      borderRadius: 12,
      padding: "14px 18px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      marginBottom: 14,
      boxShadow: "var(--sh-1)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ animation: "spin 1.2s linear infinite", display: "inline-flex" }}><Icon name="loader" size={16} /></span>
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>Enrichissement en cours</span>
          {elapsed !== null && (
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>{fmtTime(elapsed)}</span>
          )}
        </div>
        <button onClick={onCancel} className="btn btn--ghost btn--sm">
          Annuler
        </button>
      </div>

      <div style={{ height: 6, background: "var(--bg-alt)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--gold)", borderRadius: 99, transition: "width 0.4s ease" }} />
      </div>

      <p style={{ fontSize: 12, color: "var(--ink-2)", margin: 0 }}>
        <strong className="mono">{finishedCount}</strong> / <span className="mono">{total}</span> enrichis
        {status && (
          <>
            {" · "}<strong className="mono">{status.candidates_total}</strong> candidats
            {" · "}<strong className="mono">{status.leads_with_phone}</strong> téléphones attachés
            {failed > 0 && <> · <span style={{ color: "var(--red)" }}><strong className="mono">{failed}</strong> échecs</span></>}
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
