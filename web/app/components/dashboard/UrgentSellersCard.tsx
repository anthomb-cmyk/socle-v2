import Link from "next/link";
import { Dict } from "@/lib/i18n";

type ReviewItem = {
  id: string;
  title: string;
  summary: string | null;
  urgency: string;
  created_at: string;
  lead_id: string | null;
};

type Props = {
  items: ReviewItem[];
  t: Dict["dashboard"];
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  const mon = d.toLocaleString("fr-CA", { month: "short" });
  const day = d.getDate();
  const hh  = String(d.getHours()).padStart(2, "0");
  const mm  = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon} ${hh}:${mm}`;
}

const URGENCY_RAIL: Record<string, string> = {
  urgent: "3px solid var(--so-danger)",
  high:   "3px solid var(--so-warn)",
  normal: "3px solid var(--so-border)",
  low:    "3px solid var(--so-border)",
};

export default function UrgentSellersCard({ items, t }: Props) {
  const urgentCount = items.filter(i => i.urgency === "urgent").length;

  return (
    <div className="dash-card dash-card--tall">
      <div className="dash-card__header">
        <div className="dash-card__header-left">
          <span className="so-eyebrow">{t.sellersTitle}</span>
          {urgentCount > 0 && (
            <span className="so-badge so-badge-danger" style={{ fontSize: 11, padding: "1px 7px", fontFamily: "var(--so-font-mono)" }}>
              {urgentCount} urgents
            </span>
          )}
        </div>
        <Link href="/review" className="dash-card__link">{t.sellersLink}</Link>
      </div>
      <div className="dash-card__body">
        {items.length === 0 ? (
          <div className="dash-empty">
            <div className="dash-empty__icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 13l4 4L19 7"/></svg>
            </div>
            <p className="dash-empty__title">{t.sellersEmpty}</p>
            <p className="dash-empty__sub">{t.sellersEmptySub}</p>
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.map(it => (
              <li key={it.id} className="dash-seller-row" style={{ borderLeft: URGENCY_RAIL[it.urgency] ?? URGENCY_RAIL.normal, paddingLeft: 15 }}>
                <div className="dash-seller-row__title">{it.title}</div>
                {it.summary && <div className="dash-seller-row__body">{it.summary}</div>}
                <div className="dash-seller-row__meta">
                  <span className="dash-seller-row__time">{fmtDate(it.created_at)}</span>
                  {it.lead_id && (
                    <Link href={`/leads/${it.lead_id}` as never} className="so-badge so-badge-gold" style={{ fontSize: 11, padding: "1px 8px", textDecoration: "none", cursor: "pointer" }}>
                      {t.openLead}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
