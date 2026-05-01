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

  // Re-fetch when any filter changes
  useEffect(() => { refresh(); }, [city, status, campaignId, assignedTo, hasPhone, q, refresh]);

  useEffect(() => {
    if (!canAssign) return;
    fetch("/api/users").then(r => r.json()).then(j => j.ok && setUsers(j.data));
  }, [canAssign]);

  // Selection helpers
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
    setSuccessMsg(`✓ ${selected.size} leads assigned to ${assigneeName}`);
    setSelected(new Set());
    setAssignTarget("");
    refresh();
    setTimeout(() => setSuccessMsg(null), 4000);
  }

  const hasMore = leads.length < total;
  const phoneReady = leads.filter(l => l.best_phone).length;

  return (
    <div className="space-y-4">
      {/* ─── Filters ─── */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Campaign</label>
          <select value={campaignId} onChange={e => setCampaignId(e.target.value)}
            className="border border-zinc-300 rounded-lg px-3 py-2 text-sm min-w-44">
            <option value="">All campaigns</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">City</label>
          <select value={city} onChange={e => setCity(e.target.value)}
            className="border border-zinc-300 rounded-lg px-3 py-2 text-sm min-w-36">
            <option value="">All cities</option>
            {cities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="border border-zinc-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All statuses</option>
            <optgroup label="Calling">
              <option value="new">new</option>
              <option value="ready_to_call">ready_to_call</option>
              <option value="in_outreach">in_outreach</option>
              <option value="no_answer">no_answer</option>
              <option value="meeting_set">meeting_set</option>
              <option value="qualified">qualified</option>
              <option value="rejected">rejected</option>
              <option value="do_not_contact">do_not_contact</option>
            </optgroup>
            <optgroup label="Enrichment pipeline">
              <option value="needs_enrichment">needs_enrichment</option>
              <option value="needs_human_review">needs_human_review ← review phone</option>
              <option value="brave_queued">brave_queued</option>
              <option value="unresolved_after_brave">unresolved_after_brave</option>
              <option value="directory_411_queued">directory_411_queued</option>
              <option value="unresolved_after_411">unresolved_after_411</option>
              <option value="places_queued">places_queued</option>
              <option value="unresolved_after_places">unresolved_after_places</option>
              <option value="openclaw_queued">openclaw_queued</option>
              <option value="no_contact_found">no_contact_found</option>
            </optgroup>
          </select>
        </div>
        {canAssign && (
          <div>
            <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Assigned</label>
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
              className="border border-zinc-300 rounded-lg px-3 py-2 text-sm min-w-36">
              <option value="">Everyone</option>
              <option value="unassigned">Unassigned</option>
              <option value="assigned">Assigned</option>
              {users.map(u => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500 mb-1 cursor-pointer">
            <input type="checkbox" checked={hasPhone} onChange={e => setHasPhone(e.target.checked)} className="rounded" />
            Has phone
          </label>
        </div>
        <div className="flex-1 min-w-48">
          <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Search</label>
          <form onSubmit={e => { e.preventDefault(); setQ(qInput); }}>
            <div className="flex gap-1">
              <input value={qInput} onChange={e => setQInput(e.target.value)}
                placeholder="Address, owner, company…"
                className="flex-1 border border-zinc-300 rounded-lg px-3 py-2 text-sm" />
              {qInput && (
                <button type="button" onClick={() => { setQInput(""); setQ(""); }}
                  className="px-2 text-zinc-400 hover:text-zinc-700">×</button>
              )}
            </div>
          </form>
        </div>
        <div className="text-sm text-zinc-500 whitespace-nowrap">
          {total} lead{total === 1 ? "" : "s"}
          {phoneReady > 0 && !hasPhone && (
            <span className="ml-2 text-emerald-700">· {phoneReady} callable</span>
          )}
        </div>
      </div>

      {/* ─── Bulk action bar ─── */}
      {canAssign && selected.size > 0 && (
        <div className="bg-zinc-100 rounded-xl p-3 flex items-center gap-3 sticky top-2 z-10 flex-wrap shadow-sm">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <button onClick={selectPhoneReady} className="text-xs text-zinc-600 hover:underline border border-zinc-300 rounded px-2 py-1">
            Select callable only
          </button>
          <select value={assignTarget} onChange={e => setAssignTarget(e.target.value)}
            className="border border-zinc-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="">Assign to…</option>
            {users.filter(u => u.role === "caller" || u.role === "cold_caller").map(u => (
              <option key={u.user_id} value={u.user_id}>{u.display_name}</option>
            ))}
            <option value="__unassign__">— Unassign —</option>
          </select>
          <button onClick={bulkAssign} disabled={busy || !assignTarget}
            className="bg-zinc-900 text-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-50">
            {busy ? "Working…" : "Apply"}
          </button>
          <span className="border-l border-zinc-300 h-5" />
          <BatchEnrichButton leadIds={[...selected]} onDone={() => { setSelected(new Set()); refresh(); }} />
          <button onClick={() => setSelected(new Set())} className="text-sm text-zinc-600 hover:underline">Clear</button>
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2 text-sm text-emerald-800">{successMsg}</div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* ─── Table ─── */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wide">
            <tr>
              {canAssign && (
                <th className="p-3 w-10">
                  <input type="checkbox"
                    checked={leads.length > 0 && selected.size === leads.length}
                    ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < leads.length; }}
                    onChange={toggleAll} />
                </th>
              )}
              <th className="text-left p-3">Owner</th>
              <th className="text-left p-3">Property</th>
              <th className="text-left p-3">Phone</th>
              <th className="text-left p-3">Status</th>
              {canAssign && <th className="text-left p-3">Assigned</th>}
              <th className="text-left p-3">Campaign</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={canAssign ? 7 : 5} className="p-6 text-center text-zinc-400">Loading…</td></tr>
            )}
            {!loading && leads.length === 0 && (
              <tr>
                <td colSpan={canAssign ? 7 : 5} className="p-10 text-center text-zinc-400">
                  No leads match the current filters.{" "}
                  {canAssign && <Link href="/import" className="text-zinc-600 underline">Import a rôle</Link>} to get started.
                </td>
              </tr>
            )}
            {leads.map(l => {
              const detailHref = (canAssign ? `/leads/${l.lead_id}` : `/calls/${l.lead_id}`) as never;
              const assignedUser = users.find(u => u.user_id === l.assigned_to);
              return (
                <tr key={l.lead_id}
                  className={`border-t border-zinc-100 hover:bg-zinc-50 ${selected.has(l.lead_id) ? "bg-blue-50" : ""}`}>
                  {canAssign && (
                    <td className="p-3">
                      <input type="checkbox"
                        checked={selected.has(l.lead_id)}
                        onChange={() => toggle(l.lead_id)} />
                    </td>
                  )}
                  <td className="p-3">
                    <Link href={detailHref} className="font-medium hover:underline">
                      {l.full_name ?? l.company_name ?? "—"}
                    </Link>
                    <div className="text-xs text-zinc-400">{l.contact_kind}</div>
                  </td>
                  <td className="p-3">
                    <div className="max-w-48 truncate">{l.address}</div>
                    <div className="text-xs text-zinc-400">
                      {l.city ?? ""}
                      {l.num_units != null && <> · {l.num_units} units</>}
                    </div>
                  </td>
                  <td className="p-3">
                    {l.best_phone
                      ? <span className="font-mono text-xs text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded">{l.best_phone}</span>
                      : <span className="text-zinc-300 text-xs">—</span>}
                  </td>
                  <td className="p-3"><StatusPill status={l.status} /></td>
                  {canAssign && (
                    <td className="p-3 text-xs text-zinc-500">
                      {assignedUser?.display_name ?? <span className="text-zinc-300">unassigned</span>}
                    </td>
                  )}
                  <td className="p-3 text-xs text-zinc-400 max-w-36 truncate">
                    {l.campaign_name ?? <span className="text-zinc-200">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {hasMore && (
          <div className="border-t border-zinc-100 p-4 flex items-center justify-between bg-zinc-50">
            <span className="text-sm text-zinc-500">
              Showing {leads.length} of {total} leads
            </span>
            <button onClick={loadMore} disabled={loadingMore}
              className="text-sm bg-white border border-zinc-300 rounded-lg px-4 py-1.5 hover:bg-zinc-50 disabled:opacity-50">
              {loadingMore ? "Loading…" : `Load more (${total - leads.length} remaining)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    new: "bg-blue-100 text-blue-800",
    ready_to_call: "bg-emerald-100 text-emerald-800",
    in_outreach: "bg-amber-100 text-amber-800",
    meeting_set: "bg-purple-100 text-purple-800",
    qualified: "bg-emerald-200 text-emerald-900",
    no_answer: "bg-zinc-100 text-zinc-600",
    rejected: "bg-red-100 text-red-800",
    do_not_contact: "bg-red-200 text-red-900",
    // Enrichment pipeline
    needs_enrichment: "bg-sky-100 text-sky-800",
    needs_human_review: "bg-orange-100 text-orange-800",
    brave_queued: "bg-sky-50 text-sky-600",
    unresolved_after_brave: "bg-zinc-100 text-zinc-500",
    directory_411_queued: "bg-sky-50 text-sky-600",
    unresolved_after_411: "bg-zinc-100 text-zinc-500",
    places_queued: "bg-sky-50 text-sky-600",
    unresolved_after_places: "bg-zinc-100 text-zinc-500",
    openclaw_queued: "bg-violet-100 text-violet-700",
    no_contact_found: "bg-red-50 text-red-500",
  };
  const label = status.replace(/_/g, " ");
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${colors[status] ?? "bg-zinc-100 text-zinc-600"}`}>{label}</span>;
}

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
    setMsg(`✓ ${c.created} created · ${c.skipped} skipped · ${c.failed} failed`);
    setOpen(false);
    onDone();
  }

  return (
    <div className="relative inline-flex items-center gap-2">
      <button onClick={() => setOpen(o => !o)}
        className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 text-sm">
        Enrich ▾
      </button>
      {msg && <span className="text-xs text-zinc-700">{msg}</span>}
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg p-3 z-20 min-w-56">
          <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Job type</label>
          <select value={type} onChange={e => setType(e.target.value as typeof ENRICH_TYPES[number])}
            className="w-full border border-zinc-300 rounded px-2 py-1 text-sm mb-2">
            {ENRICH_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-zinc-700 mb-3">
            <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />
            Force re-queue even if job exists
          </label>
          <div className="flex gap-2">
            <button onClick={fire} disabled={busy}
              className="flex-1 bg-zinc-900 text-white rounded px-2 py-1 text-sm disabled:opacity-50">
              {busy ? "Sending…" : `Queue ${leadIds.length} job(s)`}
            </button>
            <button onClick={() => setOpen(false)}
              className="border border-zinc-300 rounded px-2 py-1 text-sm">✕</button>
          </div>
        </div>
      )}
    </div>
  );
}
