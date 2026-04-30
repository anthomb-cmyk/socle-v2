"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Lead = {
  lead_id: string;
  status: string;
  priority: number;
  assigned_to: string | null;
  campaign_name: string | null;
  address: string;
  city: string | null;
  num_units: number | null;
  contact_kind: string;
  full_name: string | null;
  company_name: string | null;
  best_phone: string | null;
};

type User = { user_id: string; display_name: string; role: string };

export default function LeadsTable({ canAssign }: { canAssign: boolean }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTarget, setAssignTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (city) params.set("city", city);
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    const resp = await fetch(`/api/leads?${params}`);
    const json = await resp.json();
    setLoading(false);
    if (!json.ok) { setError(json.error); return; }
    setLeads(json.data.leads);
    setTotal(json.data.total);
    setCities(json.data.cities);
  }

  useEffect(() => { refresh(); }, [city, status]);
  useEffect(() => {
    if (!canAssign) return;
    fetch("/api/users").then(r => r.json()).then(j => j.ok && setUsers(j.data));
  }, [canAssign]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }
  function toggleAll() {
    if (selected.size === leads.length) setSelected(new Set());
    else setSelected(new Set(leads.map(l => l.lead_id)));
  }

  async function bulkAssign() {
    if (selected.size === 0 || !assignTarget) return;
    setBusy(true);
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
    setSelected(new Set());
    refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">City</label>
          <select value={city} onChange={e => setCity(e.target.value)}
            className="border border-zinc-300 rounded-lg px-3 py-2 text-sm min-w-40">
            <option value="">All cities</option>
            {cities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="border border-zinc-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All statuses</option>
            <option value="new">new</option>
            <option value="ready_to_call">ready_to_call</option>
            <option value="in_outreach">in_outreach</option>
            <option value="meeting_set">meeting_set</option>
            <option value="qualified">qualified</option>
            <option value="no_answer">no_answer</option>
            <option value="rejected">rejected</option>
            <option value="do_not_contact">do_not_contact</option>
          </select>
        </div>
        <div className="flex-1 min-w-60">
          <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Search</label>
          <form onSubmit={e => { e.preventDefault(); refresh(); }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Address, owner, company…"
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm" />
          </form>
        </div>
        <div className="text-sm text-zinc-500">{total} lead{total === 1 ? "" : "s"}</div>
      </div>

      {canAssign && selected.size > 0 && (
        <div className="bg-zinc-100 rounded-lg p-3 flex items-center gap-3 sticky top-2 flex-wrap">
          <span className="text-sm font-medium">{selected.size} selected</span>
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

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              {canAssign && <th className="p-3 w-10"><input type="checkbox" checked={leads.length > 0 && selected.size === leads.length} onChange={toggleAll} /></th>}
              <th className="text-left p-3">Owner</th>
              <th className="text-left p-3">Property</th>
              <th className="text-left p-3">City</th>
              <th className="text-left p-3">Phone</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Campaign</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="p-4 text-center text-zinc-400">Loading…</td></tr>}
            {!loading && leads.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-zinc-400">
                No leads match the current filters. {canAssign && <a href="/import" className="text-zinc-600 underline">Import a rôle</a>} to get started.
              </td></tr>
            )}
            {leads.map(l => {
              const detailHref = (canAssign ? `/leads/${l.lead_id}` : `/calls/${l.lead_id}`) as never;
              return (
              <tr key={l.lead_id} className="border-t border-zinc-100 hover:bg-zinc-50">
                {canAssign && <td className="p-3">
                  <input type="checkbox" checked={selected.has(l.lead_id)} onChange={() => toggle(l.lead_id)} />
                </td>}
                <td className="p-3">
                  <Link href={detailHref} className="font-medium hover:underline">{l.full_name ?? l.company_name ?? "—"}</Link>
                  <div className="text-xs text-zinc-400">{l.contact_kind}</div>
                </td>
                <td className="p-3">
                  <div>{l.address}</div>
                  {l.num_units != null && <div className="text-xs text-zinc-400">{l.num_units} units</div>}
                </td>
                <td className="p-3">{l.city ?? <span className="text-zinc-400">—</span>}</td>
                <td className="p-3 font-mono text-xs">{l.best_phone ?? <span className="text-zinc-300">—</span>}</td>
                <td className="p-3"><StatusPill status={l.status} /></td>
                <td className="p-3 text-zinc-500 text-xs">{l.campaign_name ?? "—"}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
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
  };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${colors[status] ?? "bg-zinc-100"}`}>{status}</span>;
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
        Send to enrichment ▾
      </button>
      {msg && <span className="text-xs text-zinc-700">{msg}</span>}
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg p-2 z-20 min-w-56">
          <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Job type</label>
          <select value={type} onChange={e => setType(e.target.value as typeof ENRICH_TYPES[number])}
            className="w-full border border-zinc-300 rounded px-2 py-1 text-sm mb-2">
            {ENRICH_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
          <label className="flex items-center gap-2 text-xs text-zinc-700 mb-2">
            <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />
            Force (re-queue even if a job already exists)
          </label>
          <div className="flex gap-2">
            <button onClick={fire} disabled={busy}
              className="flex-1 bg-zinc-900 text-white rounded px-2 py-1 text-sm disabled:opacity-50">
              {busy ? "Sending…" : `Queue ${leadIds.length} job(s)`}
            </button>
            <button onClick={() => setOpen(false)}
              className="border border-zinc-300 rounded px-2 py-1 text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
