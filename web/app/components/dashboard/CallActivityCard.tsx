import Link from "next/link";
import { Dict } from "@/lib/i18n";

type CallLog = {
  id: string;
  lead_id: string | null;
  outcome: string | null;
  recorded_at: string;
  leads_view: { full_name: string | null; company_name: string | null; address: string } | null;
};

type Props = {
  calls: CallLog[];
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

const OUTCOME_CFG: Record<string, { label: string; cls: string }> = {
  answered:    { label: "Répondu",      cls: "so-badge so-badge-success" },
  no_answer:   { label: "Sans réponse", cls: "so-badge so-badge-neutral" },
  left_vm:     { label: "Boîte voc.",   cls: "so-badge so-badge-info" },
  callback:    { label: "Rappel",       cls: "so-badge so-badge-warn" },
  not_reached: { label: "Non joint",    cls: "so-badge so-badge-neutral" },
  hot_seller:  { label: "Vendeur chaud",cls: "so-badge so-badge-danger" },
  wants_offer: { label: "Veut offre",   cls: "so-badge so-badge-gold" },
  open_to_selling: { label: "Ouvert",   cls: "so-badge so-badge-success" },
};

export default function CallActivityCard({ calls, t }: Props) {
  return (
    <div className="dash-card dash-card--tall">
      <div className="dash-card__header">
        <div className="dash-card__header-left">
          <span className="so-eyebrow">{t.callsTitle}</span>
          {calls.length > 0 && (
            <span className="so-badge so-badge-neutral" style={{ fontSize: 11, padding: "1px 7px" }}>
              {calls.length}
            </span>
          )}
        </div>
        <Link href="/calls/queue" className="dash-card__link">{t.callsLink}</Link>
      </div>
      <div className="dash-card__body">
        {calls.length === 0 ? (
          <div className="dash-empty">
            <div className="dash-empty__icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
            </div>
            <p className="dash-empty__title">{t.callsEmpty}</p>
            <p className="dash-empty__sub">{t.callsEmptySub}</p>
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {calls.map(cl => {
              const owner = cl.leads_view?.full_name ?? cl.leads_view?.company_name ?? "—";
              const oc = cl.outcome ? (OUTCOME_CFG[cl.outcome] ?? { label: cl.outcome, cls: "so-badge so-badge-neutral" }) : null;
              return (
                <li key={cl.id} className="dash-call-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="dash-call-row__owner">
                      {cl.lead_id ? (
                        <Link href={`/leads/${cl.lead_id}` as never} style={{ color: "var(--so-fg-1)", textDecoration: "none" }}>{owner}</Link>
                      ) : owner}
                    </div>
                    <div className="dash-call-row__time">{fmtDate(cl.recorded_at)}</div>
                  </div>
                  {oc && (
                    <span className={oc.cls} style={{ fontSize: 11, padding: "1px 7px", flexShrink: 0, whiteSpace: "nowrap" }}>
                      {oc.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
