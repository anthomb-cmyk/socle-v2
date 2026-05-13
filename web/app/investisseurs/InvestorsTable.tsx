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
  province?: string | null;
  status: string;
  capital_available_cad: number | null;
  ticket_size_min_cad: number | null;
  ticket_size_max_cad: number | null;
  preferred_geography: string | null;
  asset_class_focus: string | null;
  updated_at: string;
  deals_count: number;
  active_deals_count: number;
  negotiating_deals_count: number;
  last_call_at: string | null;
};

type InvestorSummary = {
  active_count: number;
  prospect_count: number;
  inactive_count: number;
  lost_count: number;
  total_count: number;
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
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n.toLocaleString("fr-CA")}`;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "LP";
}

function avatarClass(id: string, status: string): string {
  if (status === "inactive" || status === "lost") return "inv-avatar--muted";
  const variants = ["inv-avatar--blue", "inv-avatar--green", "inv-avatar--amber", "inv-avatar--purple"];
  const code = id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return variants[code % variants.length];
}

function splitTags(value: string | null): string[] {
  if (!value) return [];
  return value.split(/[,;|]/).map((part) => part.trim()).filter(Boolean);
}

function ticketLabel(inv: Investor): string {
  if (inv.ticket_size_min_cad && inv.ticket_size_max_cad) {
    return `${fmtMoney(inv.ticket_size_min_cad)} – ${fmtMoney(inv.ticket_size_max_cad)}`;
  }
  if (inv.ticket_size_max_cad) return `≤ ${fmtMoney(inv.ticket_size_max_cad)}`;
  if (inv.ticket_size_min_cad) return `≥ ${fmtMoney(inv.ticket_size_min_cad)}`;
  return "—";
}

function ticketFill(inv: Investor): { left: string; width: string } {
  const min = inv.ticket_size_min_cad ?? 0;
  const max = inv.ticket_size_max_cad ?? min;
  if (!min && !max) return { left: "0%", width: "0%" };
  const domain = Math.max(max, min, 1);
  const left = Math.max(0, Math.min(100, Math.round((min / domain) * 100)));
  const width = Math.max(10, Math.min(100 - left, Math.round(((max - min || max) / domain) * 100)));
  return { left: `${left}%`, width: `${width}%` };
}

export default function InvestorsTable() {
  const [items, setItems] = useState<Investor[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<InvestorSummary | null>(null);
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
    setSummary(j.data.summary);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [status]);

  return (
    <div>
      <div className="inv-filters">
        <div className="inv-search">
          <Icon name="search" />
          <form onSubmit={(e) => { e.preventDefault(); refresh(); }} style={{ display: "contents" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher par nom, firme, focus…"
            />
          </form>
        </div>
        <button type="button" className={`inv-seg-chip${status === "" ? " inv-seg-chip--active" : ""}`} onClick={() => setStatus("")}>
          Tous <span className="inv-seg-chip__c">{summary?.total_count ?? total}</span>
        </button>
        <button type="button" className={`inv-seg-chip${status === "active" ? " inv-seg-chip--active" : ""}`} onClick={() => setStatus("active")}>
          Actifs <span className="inv-seg-chip__c">{summary?.active_count ?? "—"}</span>
        </button>
        <button type="button" className={`inv-seg-chip${status === "prospect" ? " inv-seg-chip--active" : ""}`} onClick={() => setStatus("prospect")}>
          Prospects <span className="inv-seg-chip__c">{summary?.prospect_count ?? "—"}</span>
        </button>
        <button type="button" className={`inv-seg-chip${status === "inactive" ? " inv-seg-chip--active" : ""}`} onClick={() => setStatus("inactive")}>
          Inactifs <span className="inv-seg-chip__c">{summary?.inactive_count ?? "—"}</span>
        </button>
      </div>

      <div className="inv-table">
        <div className="inv-thead">
          <div>Investisseur</div>
          <div>Firme</div>
          <div>Capital dispo</div>
          <div>Ticket</div>
          <div>Focus &amp; géographie</div>
          <div>Deals</div>
          <div />
        </div>
            {loading && (
              <div className="inv-empty-row">Chargement…</div>
            )}
            {!loading && items.length === 0 && (
              <div className="inv-empty-row">Aucun investisseur.</div>
            )}
            {items.map((inv) => {
              const fill = ticketFill(inv);
              const focusTags = splitTags(inv.asset_class_focus);
              const geoTags = splitTags(inv.preferred_geography);
              return (
                <div key={inv.id} className={`inv-tr${inv.status === "inactive" || inv.status === "lost" ? " inv-tr--muted" : ""}`}>
                  <div className="inv-who">
                    <div className={`inv-avatar ${avatarClass(inv.id, inv.status)}`}>{initials(inv.full_name)}</div>
                    <div>
                      <Link href={`/investisseurs/${inv.id}` as never} className="inv-who__name">
                        {inv.full_name}
                      </Link>
                      <div className="inv-who__sub">
                        <span className={`pill ${STATUS_PILLS[inv.status] ?? "pill--cold"}`} style={{ fontSize: 10, padding: "2px 6px" }}>
                          <span className="pill__dot" />{STATUS_LABELS[inv.status] ?? inv.status}
                        </span>
                        {inv.city ?? "—"}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="inv-firm">{inv.firm_name ?? "—"}</div>
                    <div className="inv-firm__sub">{inv.email ?? inv.phone_e164 ?? "—"}</div>
                  </div>
                  <div>
                    <div className="inv-capital">{fmtMoney(inv.capital_available_cad)}</div>
                    <div className="inv-capital__sub">{inv.capital_available_cad == null ? "—" : "disponible"}</div>
                  </div>
                  <div className="inv-ticket">
                    <div className="inv-ticket__range">{ticketLabel(inv)}</div>
                    <div className="inv-ticket__bar">
                      <div className="inv-ticket__bar__fill" style={{ left: fill.left, width: fill.width }} />
                    </div>
                  </div>
                  <div className="inv-focus-tags">
                    {focusTags.length === 0 && geoTags.length === 0 ? (
                      <span className="inv-focus-tag">—</span>
                    ) : (
                      <>
                        {focusTags.map((tag) => <span key={`f-${tag}`} className="inv-focus-tag">{tag}</span>)}
                        {geoTags.map((tag) => <span key={`g-${tag}`} className="inv-focus-tag inv-focus-tag--geo">{tag}</span>)}
                      </>
                    )}
                  </div>
                  <div>
                    <span className={`inv-deals-cell${inv.deals_count === 0 ? " inv-deals-cell--empty" : ""}`}>
                      <span className="inv-deals-cell__dot" />{inv.deals_count}
                    </span>
                    <div className="inv-firm__sub">{inv.negotiating_deals_count > 0 ? `${inv.negotiating_deals_count} en négo` : inv.active_deals_count > 0 ? `${inv.active_deals_count} actif${inv.active_deals_count > 1 ? "s" : ""}` : "—"}</div>
                  </div>
                  <Link href={`/investisseurs/${inv.id}` as never} className="inv-tr__menu" aria-label={`Ouvrir ${inv.full_name}`}>
                    <Icon name="dots" />
                  </Link>
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
    dots: <><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
