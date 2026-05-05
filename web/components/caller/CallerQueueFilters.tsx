"use client";
import * as React from "react";
import { useLocale } from "@/components/locale-provider";

export type QueueFilter = "all" | "hot";

type Props = {
  filter: QueueFilter;
  query: string;
  onFilterChange: (f: QueueFilter) => void;
  onQueryChange: (q: string) => void;
};

/**
 * Client-side filter controls for the queue. Filtering happens in memory
 * over the already-server-fetched leads — does NOT modify the server query.
 * Two chips today (All / Hot) + free-text search across name / address /
 * city / campaign.
 */
export default function CallerQueueFilters({
  filter, query, onFilterChange, onQueryChange,
}: Props) {
  const { t } = useLocale();

  return (
    <div className="so-queue-filters">
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={t.queue.searchPlaceholder}
        className="crm-input so-queue-filters__search"
        aria-label={t.queue.searchPlaceholder}
      />
      <div className="so-queue-filters__chips" role="group" aria-label={t.queue.filterAll}>
        <Chip active={filter === "all"} onClick={() => onFilterChange("all")}>
          {t.queue.filterAll}
        </Chip>
        <Chip active={filter === "hot"} onClick={() => onFilterChange("hot")}>
          {t.queue.filterHot}
        </Chip>
      </div>
    </div>
  );
}

function Chip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`so-queue-filter-chip${active ? " so-queue-filter-chip--active" : ""}`}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
