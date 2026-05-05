"use client";
import type { Dict } from "@/lib/i18n";

type Props = {
  callable: number;
  overdue: number;
  verified: number;
  review: number;
  t: Dict;
};

export default function QueueStatTiles({ callable, overdue, verified, review, t }: Props) {
  return (
    <div className="queue-tiles" role="list" aria-label="Queue statistics">
      <Tile label={t.queue.callable} value={callable} />
      <Tile label={t.queue.overdueLabel2} value={overdue} variant={overdue > 0 ? "danger" : undefined} />
      <Tile label={t.queue.verified} value={verified} variant={verified > 0 ? "success" : undefined} />
      <Tile label={t.queue.review} value={review} variant={review > 0 ? "warn" : undefined} />
    </div>
  );
}

function Tile({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant?: "danger" | "success" | "warn";
}) {
  return (
    <div role="listitem" className="queue-tile">
      <p className="queue-tile__label">{label}</p>
      <p className={`queue-tile__value${variant ? ` queue-tile__value--${variant}` : ""}`}>
        {value}
      </p>
    </div>
  );
}
