"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Contact = {
  id: string; kind: string;
  full_name: string | null; company_name: string | null;
  primary_email: string | null; primary_phone: string | null;
  mailing_city: string | null; created_at: string;
  phone_count: number; lead_count: number;
};

export default function ContactsTable() {
  const [items, setItems] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (q) params.set("q", q);
    const r = await fetch(`/api/contacts?${params}`);
    const j = await r.json();
    setLoading(false);
    if (!j.ok) return;
    setItems(j.data.contacts);
    setTotal(j.data.total);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [kind]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Kind</label>
          <select value={kind} onChange={e => setKind(e.target.value)}
            className="border border-zinc-300 rounded-lg px-3 py-2 text-sm">
            <option value="">All</option>
            <option value="person">Person</option>
            <option value="company">Company</option>
            <option value="numbered_co">Numbered Co.</option>
            <option value="trust">Trust</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div className="flex-1 min-w-60">
          <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Search</label>
          <form onSubmit={e => { e.preventDefault(); refresh(); }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Name or company"
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm" />
          </form>
        </div>
        <div className="text-sm text-zinc-500">{total} contacts</div>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-600">
            <tr><th className="text-left p-2">Name</th><th className="text-left p-2">Kind</th><th className="text-left p-2">City</th><th className="text-left p-2">Email</th><th className="text-left p-2">Phones</th><th className="text-left p-2">Leads</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="p-4 text-center text-zinc-400">Loading…</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-zinc-400">No contacts match.</td></tr>}
            {items.map(c => (
              <tr key={c.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                <td className="p-2"><Link href={`/contacts/${c.id}` as never} className="hover:underline">{c.full_name ?? c.company_name ?? "—"}</Link></td>
                <td className="p-2"><span className="text-xs uppercase tracking-wide rounded px-1.5 py-0.5 bg-zinc-100">{c.kind}</span></td>
                <td className="p-2">{c.mailing_city ?? <span className="text-zinc-400">—</span>}</td>
                <td className="p-2 text-xs">{c.primary_email ?? <span className="text-zinc-400">—</span>}</td>
                <td className="p-2">{c.phone_count}</td>
                <td className="p-2">{c.lead_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
