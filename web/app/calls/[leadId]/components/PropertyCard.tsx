"use client";
import { useLocale } from "@/components/locale-provider";

type Props = {
  address: string;
  city: string | null;
  units: number | null;
  assessedValue: number | null;
};

/**
 * Phase 4 — property identity card. B-3: yearBuilt removed — leads_view
 * does not expose the column; cell removed and grid rebalanced to 2-up.
 * Pure presentation. Cells whose value is null are not rendered (no "—"
 * placeholder), per spec "missing-fields: collapse cells whose value is null".
 */
export default function PropertyCard({ address, city, units, assessedValue }: Props) {
  const { t, locale } = useLocale();
  const fullAddress = city ? `${address}, ${city}` : address;
  const fmtCurrency = new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  });

  type Cell = { label: string; value: string };
  const cells: Cell[] = [];
  if (units != null)         cells.push({ label: t.workspace.unitsLabel,    value: String(units) });
  if (assessedValue != null) cells.push({ label: t.workspace.assessedLabel, value: fmtCurrency.format(assessedValue) });

  return (
    <div className="cw-card cw-property-card">
      <div className="cw-property-card__address">{fullAddress}</div>
      {cells.length > 0 && (
        <div className="cw-property-card__grid">
          {cells.map((c) => (
            <div key={c.label} className="cw-property-card__cell">
              <div className="cw-property-card__cell-label">{c.label}</div>
              <div className="cw-property-card__cell-value" style={{ fontFeatureSettings: '"tnum" 1' }}>
                {c.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
