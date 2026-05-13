import Link from "next/link";

type Variant = "neutral" | "success" | "warn" | "danger" | "gold";

type Props = {
  href: string;
  label: string;
  value: number | string;
  caption?: string;
  unit?: string;
  delta?: string;
  captionDanger?: boolean;
  variant?: Variant;
  sparkline?: number[];
  sparkTone?: "gold" | "red";
};

export default function KpiTile({ href, label, value, caption, unit, delta, captionDanger, variant = "neutral", sparkline, sparkTone = "gold" }: Props) {
  return (
    <Link href={href as never} className={`dash-tile dash-tile--${variant}`}>
      <span className="so-eyebrow">{label}</span>
      <span className="dash-tile__value-row">
        <span>
          <span className="dash-tile__value">{value}</span>
          {unit ? <span className="dash-tile__unit">{unit}</span> : null}
        </span>
        {delta ? <span className={`dash-tile__delta${sparkTone === "red" ? " dash-tile__delta--down" : ""}`}>{delta}</span> : null}
      </span>
      {sparkline ? <KpiSparkline values={sparkline} tone={sparkTone} /> : null}
      {caption && (
        <span className={`dash-tile__caption${captionDanger ? " dash-tile__caption--danger" : ""}`}>
          {caption}
        </span>
      )}
    </Link>
  );
}

function KpiSparkline({ values, tone }: { values: number[]; tone: "gold" | "red" }) {
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = 24 - (value / max) * 20;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const area = `${points} 100,28 0,28`;

  return (
    <svg className={`dash-tile__spark dash-tile__spark--${tone}`} viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={area} fill="currentColor" opacity={tone === "red" ? "0.08" : "0.12"} stroke="none" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
