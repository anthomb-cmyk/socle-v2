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
const STATUS_PILLS: Record<string, string> = {
  active: "pill--ready",
  inactive: "pill--cold",
  lost: "pill--hot",
  prospect: "pill--review",
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
    <div>
      <div className="socle-filters">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label className="label">Statut</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="socle-select"
          >
            <option value="">Tous</option>
            <option value="active">Actif</option>
            <option value="prospect">Prospect</option>
            <option value="inactive">Inactif</option>
            <option value="lost">Perdu</option>
          </select>
        </div>
        <div className="socle-search">
          <Icon name="search" />
          <form onSubmit={(e) => { e.preventDefault(); refresh(); }} style={{ display: "contents" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nom ou firme"
            />
          </form>
        </div>
        <span className="pill pill--brand">{total} investisseurs</span>
      </div>

      <div className="socle-table">
        <div className="socle-thead" style={{ gridTemplateColumns: "1.3fr 1fr .8fr .8fr .9fr 1.2fr .7fr .5fr" }}>
          <div>Nom</div>
          <div>Firme</div>
          <div>Ville</div>
          <div>Capital</div>
          <div>Ticket</div>
          <div>Focus</div>
          <div>Statut</div>
          <div>Deals</div>
        </div>
            {loading && (
              <div className="crm-empty-state">Chargement…</div>
            )}
            {!loading && items.length === 0 && (
              <div className="crm-empty-state">
                <p className="crm-empty-state-title">Aucun investisseur</p>
                <p className="crm-empty-state-sub">Crée le premier avec le bouton en haut à droite.</p>
              </div>
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
                <div key={inv.id} className="socle-tr rail-normal" style={{ gridTemplateColumns: "1.3fr 1fr .8fr .8fr .9fr 1.2fr .7fr .5fr" }}>
                  <div>
                    <Link href={`/investisseurs/${inv.id}` as never} className="socle-name">
                      {inv.full_name}
                    </Link>
                    <div className="socle-subline">{inv.email ?? inv.phone_e164 ?? "—"}</div>
                  </div>
                  <div className="socle-muted">{inv.firm_name ?? "—"}</div>
                  <div className="socle-muted">{inv.city ?? "—"}</div>
                  <div className="mono">{fmtMoney(inv.capital_available_cad)}</div>
                  <div className="mono">{ticket}</div>
                  <div className="socle-muted" style={{ fontSize: 12 }}>{inv.asset_class_focus ?? inv.preferred_geography ?? "—"}</div>
                  <div><span className={`pill ${STATUS_PILLS[inv.status] ?? "pill--cold"}`}><span className="pill__dot" />{STATUS_LABELS[inv.status] ?? inv.status}</span></div>
                  <div><span className="deals-cell"><span className="deals-cell__dot" />0</span></div>
                </div>
              );
            })}
      </div>
    </div>
  );
}

function Icon({ name, size = 15 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: <path d="M21 21l-4.3-4.3M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4z" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
