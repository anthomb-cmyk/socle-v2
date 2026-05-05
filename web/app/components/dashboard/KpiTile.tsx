import Link from "next/link";

type Variant = "neutral" | "success" | "warn" | "danger" | "gold";

type Props = {
  href: string;
  label: string;
  value: number | string;
  caption?: string;
  captionDanger?: boolean;
  variant?: Variant;
};

export default function KpiTile({ href, label, value, caption, captionDanger, variant = "neutral" }: Props) {
  return (
    <Link href={href as never} className={`dash-tile dash-tile--${variant}`}>
      <span className="so-eyebrow">{label}</span>
      <span className="dash-tile__value">{value}</span>
      {caption && (
        <span className={`dash-tile__caption${captionDanger ? " dash-tile__caption--danger" : ""}`}>
          {caption}
        </span>
      )}
    </Link>
  );
}
