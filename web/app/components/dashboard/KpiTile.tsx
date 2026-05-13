import Link from "next/link";

type Variant = "neutral" | "success" | "warn" | "danger" | "gold";

type Props = {
  href: string;
  label: string;
  value: number | string;
  caption?: string;
  captionDanger?: boolean;
  variant?: Variant;
  sparkline?: number[];
};

export default function KpiTile({ href, label, value, caption, captionDanger, variant = "neutral", sparkline }: Props) {
  return (
    <Link href={href as never} className={`dash-tile dash-tile--${variant}`}>
      <span className="so-eyebrow">{label}</span>
      <span className="dash-tile__value-row">
        <span className="dash-tile__value">{value}</span>
        {sparkline ? <KpiSparkline values={sparkline} /> : null}
      </span>
      {caption && (
        <span className={`dash-tile__caption${captionDanger ? " dash-tile__caption--danger" : ""}`}>
          {caption}
        </span>
      )}
    </Link>
  );
}

function KpiSparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 70;
    const y = 24 - (value / max) * 20;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg className="dash-tile__spark" viewBox="0 0 70 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
