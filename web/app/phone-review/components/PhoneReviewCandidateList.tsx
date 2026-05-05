"use client";
import { useLocale } from "@/components/locale-provider";
import PhoneReviewListItem from "./PhoneReviewListItem";
import type { PhoneCandidate } from "../PhoneReviewClient";

type Props = {
  candidates: PhoneCandidate[];
  selectedIds: Set<string>;
  focusedId: string | null;
  allFilteredSelected: boolean;
  onToggleSelectAll: () => void;
  onToggleSelect: (id: string) => void;
  onSelectFocus: (id: string) => void;
};

/**
 * Phase 5 — wrapper for the compact candidate list. Master "select all"
 * checkbox + scroll container. Pure presentation; the orchestrator owns
 * the bulk-selection set and the focus.
 */
export default function PhoneReviewCandidateList({
  candidates,
  selectedIds,
  focusedId,
  allFilteredSelected,
  onToggleSelectAll,
  onToggleSelect,
  onSelectFocus,
}: Props) {
  const { t } = useLocale();

  if (candidates.length === 0) {
    return (
      <div className="pr-list-empty">{t.review.noneInFilter}</div>
    );
  }

  return (
    <div className="pr-list">
      <div className="pr-list__masterrow">
        <input
          type="checkbox"
          checked={allFilteredSelected}
          onChange={onToggleSelectAll}
          className="pr-list-item__check"
          aria-label={t.review.selectAll(candidates.length)}
        />
        <span className="pr-list__masterlabel">
          {allFilteredSelected
            ? t.review.deselectAll(candidates.length)
            : t.review.selectAll(candidates.length)}
        </span>
      </div>
      <ul className="pr-list__items">
        {candidates.map((c) => (
          <PhoneReviewListItem
            key={c.id}
            candidate={c}
            selected={selectedIds.has(c.id)}
            isFocused={focusedId === c.id}
            onToggleSelect={onToggleSelect}
            onSelect={onSelectFocus}
          />
        ))}
      </ul>
    </div>
  );
}
