"use client";
import { useLocale } from "@/components/locale-provider";

type Props = {
  visible: boolean;
  selectedCount: number;
  bulkProgress: { done: number; total: number } | null;
  onApprove: () => void;
  onReject: () => void;
  onKeepUnresolved: () => void;
};

/**
 * Phase 5 — bulk-action bar. Pure presentation. Consistent with the
 * Phase 4 layering pattern: on mobile this becomes position: fixed at
 * the bottom with z-index 60, layered above MobileBottomNav (z-index 50,
 * NOT removed from the DOM). On desktop it sits at the top of the
 * right rail (sticky top: 88px) when ≥1 candidate is selected.
 */
export default function PhoneReviewBulkBar({
  visible, selectedCount, bulkProgress, onApprove, onReject, onKeepUnresolved,
}: Props) {
  const { t } = useLocale();
  if (!visible) return null;

  const busy = bulkProgress !== null;

  return (
    <div className="pr-bulk-bar" role="region" aria-label="Bulk actions">
      <span className="pr-bulk-bar__count">
        {bulkProgress
          ? t.review.approving(bulkProgress.done, bulkProgress.total)
          : t.review.selected(selectedCount)}
      </span>
      <button
        type="button"
        onClick={onApprove}
        disabled={busy}
        className="pr-bulk-bar__btn pr-bulk-bar__btn--approve"
      >
        {t.review.bulkApprove}
      </button>
      <button
        type="button"
        onClick={onReject}
        disabled={busy}
        className="pr-bulk-bar__btn pr-bulk-bar__btn--reject"
      >
        {t.review.bulkReject}
      </button>
      <button
        type="button"
        onClick={onKeepUnresolved}
        disabled={busy}
        className="pr-bulk-bar__btn pr-bulk-bar__btn--keep"
      >
        {t.review.bulkKeep}
      </button>
    </div>
  );
}
