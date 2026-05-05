"use client";
import { useLocale } from "@/components/locale-provider";
import CallHistoryEntry, { type HistoryRow } from "./CallHistoryEntry";

type Props = {
  rows: HistoryRow[];
};

/**
 * Phase 6 — vertical timeline shell. Renders the section heading and a
 * <ul> of CallHistoryEntry items connected by a charcoal vertical rail.
 * Pure presentation — receives the rows in their fetched order.
 *
 * The "current" highlight is reserved for a future feature (an active
 * call that the workspace is actively viewing); for now no row is
 * highlighted as current — Phase 6 is timeline plumbing.
 */
export default function CallHistoryTimeline({ rows }: Props) {
  const { t } = useLocale();

  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="ch-section">
      <h2 className="ch-section__title">{t.history.title(rows.length)}</h2>
      <ul className="ch-timeline">
        {rows.map((r) => (
          <CallHistoryEntry key={r.id} row={r} isCurrent={false} />
        ))}
      </ul>
    </section>
  );
}
