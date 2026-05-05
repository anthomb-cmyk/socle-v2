"use client";
import { useLocale } from "@/components/locale-provider";


type Props = {
  address: string;
  city: string | null;
  units: number | null;
};

/**
 * Phase 4 — property identity card.
 * assessedValue removed: callers don't need the municipal assessment value.
 */
export default function PropertyCard({ address, city, units }: Props) {
  const { t } = useLocale();
  const fullAddress = city ? `${address}, ${city}` : address;

  type Cell = { label: string; value: string };
  const cells: Cell[] = [];
  if (units != null) cells.push({ label: t.workspace.unitsLabel, value: String(units) });

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
