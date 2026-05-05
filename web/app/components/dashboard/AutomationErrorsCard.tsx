import { Dict } from "@/lib/i18n";

type AutoEvent = {
  id: string;
  source: string;
  event_type: string;
  error_message: string | null;
  occurred_at: string;
};

type Props = {
  failures: AutoEvent[];
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

export default function AutomationErrorsCard({ failures, t }: Props) {
  return (
    <div className="dash-card dash-card--min">
      <div className="dash-card__header">
        <div className="dash-card__header-left">
          <span className="so-eyebrow">{t.errorsTitle}</span>
          {failures.length === 0 ? (
            <span className="so-badge so-badge-success" style={{ fontSize: 11, padding: "1px 7px" }}>0</span>
          ) : (
            <span className="so-badge so-badge-danger" style={{ fontSize: 11, padding: "1px 7px" }}>{failures.length}</span>
          )}
        </div>
      </div>
      <div className="dash-card__body">
        {failures.length === 0 ? (
          <div className="dash-empty">
            <div className="dash-empty__icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 13l4 4L19 7"/></svg>
            </div>
            <p className="dash-empty__title">{t.errorsEmpty}</p>
            <p className="dash-empty__sub">{t.errorsEmptySub}</p>
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {failures.map(e => (
              <li key={e.id} style={{ padding: "10px 18px", borderBottom: "1px solid var(--so-border-faint)" }}>
                <div style={{ fontFamily: "var(--so-font-mono)", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--so-fg-4)", marginBottom: 3 }}>
                  {e.source} · {e.event_type}
                </div>
                <div style={{ fontFamily: "var(--so-font-body)", fontSize: 12.5, color: "var(--so-danger)", fontWeight: 600, lineHeight: 1.4 }}>
                  {e.error_message ?? "(no message)"}
                </div>
                <div style={{ fontFamily: "var(--so-font-mono)", fontSize: 11, color: "var(--so-fg-5)", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                  {fmtDate(e.occurred_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
