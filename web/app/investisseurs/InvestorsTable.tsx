"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Investor = {
  id: string;
  full_name: string;
  firm_name: string | null;
  email: string | null;
  phone_e164: string | null;
  city: string | null;
  status: string;
  capital_available_cad: number | null;
  ticket_size_min_cad: number | null;
  ticket_size_max_cad: number | null;
  preferred_geography: string | null;
  asset_class_focus: string | null;
  updated_at: string;
};

const STATUS_LABELS: Record<string, string> = {
  active: "Actif",
  inactive: "Inactif",
  lost: "Perdu",
  prospect: "Prospect",
};

function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M$`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k$`;
  return `${n}$`;
}

export default function InvestorsTable() {
  const [items, setItems] = useState<Investor[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    const r = await fetch(`/api/investors?${params}`);
    const j = await r.json();
    setLoading(false);
    if (!j.ok) return;
    setItems(j.data.investors);
    setTotal(j.data.total);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [status]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Statut</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Tous</option>
            <option value="active">Actif</option>
            <option value="prospect">Prospect</option>
            <option value="inactive">Inactif</option>
            <option value="lost">Perdu</option>
          </select>
        </div>
        <div className="flex-1 min-w-60">
          <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Recherche</label>
          <form onSubmit={(e) => { e.preventDefault(); refresh(); }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nom ou firme"
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            />
          </form>
        </div>
        <div className="text-sm text-zinc-500">{total} investisseurs</div>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="text-left p-2">Nom</th>
              <th className="text-left p-2">Firme</th>
              <th className="text-left p-2">Ville</th>
              <th className="text-left p-2">Capital</th>
              <th className="text-left p-2">Ticket</th>
              <th className="text-left p-2">Focus</th>
              <th className="text-left p-2">Statut</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="p-4 text-center text-zinc-400">Chargement…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-zinc-400">
                  Aucun investisseur. Crée le premier avec le bouton en haut à droite.
                </td>
              </tr>
            )}
            {items.map((inv) => {
              const ticket =
                inv.ticket_size_min_cad && inv.ticket_size_max_cad
                  ? `${fmtMoney(inv.ticket_size_min_cad)}–${fmtMoney(inv.ticket_size_max_cad)}`
                  : inv.ticket_size_max_cad
                  ? `≤${fmtMoney(inv.ticket_size_max_cad)}`
                  : inv.ticket_size_min_cad
                  ? `≥${fmtMoney(inv.ticket_size_min_cad)}`
                  : "—";
              return (
                <tr key={inv.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                  <td className="p-2">
                    <Link href={`/investisseurs/${inv.id}` as never} className="hover:underline">
                      {inv.full_name}
                    </Link>
                  </td>
                  <td className="p-2">{inv.firm_name ?? <span className="text-zinc-400">—</span>}</td>
                  <td className="p-2">{inv.city ?? <span className="text-zinc-400">—</span>}</td>
                  <td className="p-2">{fmtMoney(inv.capital_available_cad)}</td>
                  <td className="p-2">{ticket}</td>
                  <td className="p-2 text-xs">
                    {inv.asset_class_focus ?? inv.preferred_geography ?? (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="p-2">
                    <span className="text-xs uppercase tracking-wide rounded px-1.5 py-0.5 bg-zinc-100">
                      {STATUS_LABELS[inv.status] ?? inv.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
