"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Property = {
  id: string; address: string; city: string | null; matricule: string | null;
  num_units: number | null; year_built: number | null; evaluation_total: number | null;
  created_at: string; lead_count: number;
};

export default function PropertiesTable() {
  const [items, setItems] = useState<Property[]>([]);
  const [total, setTotal] = useState(0);
  const [city, setCity] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const params = new URLSearchParams();
    if (city) params.set("city", city);
    if (q) params.set("q", q);
    const r = await fetch(`/api/properties?${params}`);
    const j = await r.json();
    setLoading(false);
    if (!j.ok) return;
    setItems(j.data.properties);
    setTotal(j.data.total);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [city]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">City</label>
          <input value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Granby"
            className="border border-zinc-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex-1 min-w-60">
          <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Search</label>
          <form onSubmit={e => { e.preventDefault(); refresh(); }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Address or matricule"
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm" />
          </form>
        </div>
        <div className="text-sm text-zinc-500">{total} properties</div>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-600">
            <tr><th className="text-left p-2">Address</th><th className="text-left p-2">City</th><th className="text-left p-2">Matricule</th><th className="text-left p-2">Units</th><th className="text-left p-2">Year</th><th className="text-left p-2">Eval</th><th className="text-left p-2">Leads</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="p-4 text-center text-zinc-400">Loading…</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-zinc-400">No properties match.</td></tr>}
            {items.map(p => (
              <tr key={p.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                <td className="p-2"><Link href={`/properties/${p.id}` as never} className="hover:underline">{p.address}</Link></td>
                <td className="p-2">{p.city ?? <span className="text-zinc-400">—</span>}</td>
                <td className="p-2 font-mono text-xs">{p.matricule ?? "—"}</td>
                <td className="p-2">{p.num_units ?? "—"}</td>
                <td className="p-2">{p.year_built ?? "—"}</td>
                <td className="p-2">{p.evaluation_total ? `$${Math.round(p.evaluation_total / 1000)}k` : "—"}</td>
                <td className="p-2">{p.lead_count > 1 ? <span className="text-amber-700">{p.lead_count}</span> : p.lead_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
