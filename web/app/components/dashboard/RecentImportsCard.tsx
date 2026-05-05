import Link from "next/link";
import { Dict } from "@/lib/i18n";

type ImportJob = {
  id: string;
  file_name: string;
  status: string;
  properties_created: number;
  leads_created: number;
  errors_count: number;
  created_at: string;
};

type Props = {
  imports: ImportJob[];
  t: Dict["dashboard"];
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  const mon = d.toLocaleString("fr-CA", { month: "short" });
  const day = d.getDate();
  const hh  = String(d.getHours()).padStart(2, "0");
  const mm  = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon} · ${hh}:${mm}`;
}

function StatusBadge({ status, t }: { status: string; t: Dict["dashboard"] }) {
  const labels: Record<string, string> = {
    completed: t.statusCompleted,
    processing: t.statusProcessing,
    failed: t.statusFailed,
    pending: t.statusPending,
  };
  const variants: Record<string, string> = {
    completed: "so-badge so-badge-success",
    processing: "so-badge so-badge-info",
    failed: "so-badge so-badge-danger",
    pending: "so-badge so-badge-warn",
  };
  return (
    <span className={variants[status] ?? "so-badge so-badge-neutral"} style={{ fontSize: 11, padding: "1px 7px" }}>
      {labels[status] ?? status}
    </span>
  );
}

export default function RecentImportsCard({ imports, t }: Props) {
  return (
    <div className="dash-card dash-card--tall">
      <div className="dash-card__header">
        <div className="dash-card__header-left">
          <span className="so-eyebrow">{t.importsTitle}</span>
          {imports.length > 0 && (
            <span className="so-badge so-badge-neutral" style={{ fontSize: 11, padding: "1px 7px" }}>
              {imports.length}
            </span>
          )}
        </div>
        <Link href="/import" className="dash-card__link">{t.importsNew}</Link>
      </div>
      <div className="dash-card__body">
        {imports.length === 0 ? (
          <div className="dash-empty">
            <div className="dash-empty__icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
            </div>
            <p className="dash-empty__title">{t.importsEmpty}</p>
            <p className="dash-empty__sub">{t.importsEmptySub}</p>
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {imports.map(i => (
              <li key={i.id} className="dash-import-row">
                <div style={{ minWidth: 0 }}>
                  <div className="dash-import-row__name">{i.file_name}</div>
                  <div className="dash-import-row__meta">{fmtDate(i.created_at)}</div>
                </div>
                <div className="dash-import-row__chips">
                  <span className="dash-import-chip">{i.properties_created}p</span>
                  <span className="dash-import-chip">{i.leads_created}l</span>
                  {i.errors_count > 0 && (
                    <span className="dash-import-chip" style={{ background: "var(--so-danger-bg)", color: "var(--so-danger)" }}>
                      {i.errors_count} err
                    </span>
                  )}
                </div>
                <StatusBadge status={i.status} t={t} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
