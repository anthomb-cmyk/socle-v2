import Link from "next/link";
import { Dict } from "@/lib/i18n";

type Props = {
  enriching: number;
  phoneReady: number;
  t: Dict["dashboard"];
};

export default function EnrichmentCard({ enriching, phoneReady, t }: Props) {
  const pct = enriching + phoneReady > 0
    ? Math.min(100, Math.round((phoneReady / (enriching + phoneReady)) * 100))
    : 0;

  return (
    <div className="dash-card dash-card--min">
      <div className="dash-card__header">
        <div className="dash-card__header-left">
          <span className="so-eyebrow">{t.enrichTitle}</span>
        </div>
        {enriching > 0 && (
          <Link href="/admin/enrichment" className="dash-card__link">{t.enrichPipeline}</Link>
        )}
      </div>
      <div className="dash-card__body">
        {enriching === 0 ? (
          <div className="dash-empty">
            <div className="dash-empty__icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </div>
            <p className="dash-empty__title">{t.enrichEmpty}</p>
            <p className="dash-empty__sub">{t.enrichEmptySub}</p>
          </div>
        ) : (
          <div style={{ padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 0 }}>
                <span className="dash-enrich-big">{enriching}</span>
                <span className="dash-enrich-caption">{t.enrichPipelineLabel}</span>
              </div>
              <span className="so-badge so-badge-success" style={{ fontSize: 11, padding: "1px 8px" }}>
                {t.enrichVerified(phoneReady)}
              </span>
            </div>
            <div className="dash-enrich-bar">
              <div className="dash-enrich-bar__fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="dash-enrich-sources">
              {["Brave", "411", "Places", "OpenClaw"].map(src => (
                <span key={src} className="so-badge so-badge-neutral" style={{ fontFamily: "var(--so-font-mono)", fontSize: 11, padding: "1px 7px" }}>
                  {src}
                </span>
              ))}
              <span style={{ fontFamily: "var(--so-font-mono)", fontSize: 11, color: "var(--so-fg-4)", fontVariantNumeric: "tabular-nums" }}>
                {enriching} en traitement
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
