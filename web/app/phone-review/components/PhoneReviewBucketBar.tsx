"use client";
import { useLocale } from "@/components/locale-provider";

export type Bucket = "all" | "ge80" | "70-79" | "60-69" | "50-59" | "lt50";

type Props = {
  buckets: ReadonlyArray<Bucket>;
  counts: Record<Bucket, number>;
  active: Bucket;
  onSelect: (b: Bucket) => void;
};

/**
 * Phase 5 — extracted confidence-bucket pill bar. Pure presentation.
 * Visual class names (.crm-bucket-pill / --active) reused from earlier
 * phases — they already match the so-* token system.
 */
export default function PhoneReviewBucketBar({ buckets, counts, active, onSelect }: Props) {
  const { t } = useLocale();

  function bucketLabel(b: Bucket, count: number): string {
    if (b === "all") return t.review.bucketAll(count);
    return `${b === "ge80" ? "≥ 80" : b === "lt50" ? "< 50" : b} (${count})`;
  }

  return (
    <div className="pr-bucket-bar">
      {buckets.map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => onSelect(b)}
          className={`crm-bucket-pill ${active === b ? "crm-bucket-pill--active" : ""}`}
        >
          {bucketLabel(b, counts[b])}
        </button>
      ))}
    </div>
  );
}
