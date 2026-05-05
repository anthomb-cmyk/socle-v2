"use client";
import * as React from "react";
import { useLocale } from "@/components/locale-provider";
import type { Dict } from "@/lib/i18n";

type StatLead = {
  priority: number | null;
  next_action_at: string | null;
  last_contacted_at: string | null;
};

type Props = {
  /** Already-filtered queue leads (server-fetched). Stats are derived in-memory. */
  leads: StatLead[];
};

/**
 * 4-tile stat strip for the call queue. Pure client component;
 * derives all values from the props the page already fetched —
 * no new API or supabase calls.
 */
export default function CallerQueueStats({ leads }: Props) {
  const { t } = useLocale();
  const now = Date.now();

  const total = leads.length;
  const hot = leads.filter((l) => (l.priority ?? 0) >= 80).length;
  const overdue = leads.filter(
    (l) => l.next_action_at && new Date(l.next_action_at).getTime() <= now,
  ).length;

  // Most-recent contact timestamp across the queue
  let mostRecent: number | null = null;
  for (const l of leads) {
    if (l.last_contacted_at) {
      const ts = new Date(l.last_contacted_at).getTime();
      if (mostRecent == null || ts > mostRecent) mostRecent = ts;
    }
  }
  const lastCallLabel = mostRecent != null
    ? formatRelative(now - mostRecent, t)
    : "—";

  return (
    <div className="so-queue-stats" role="list" aria-label="Queue statistics">
      <Tile label={t.queue.statTotalToday}  value={String(total)} />
      <Tile label={t.queue.statHotPriority} value={String(hot)}      variant={hot > 0 ? "danger" : undefined} />
      <Tile label={t.queue.statOverdue}     value={String(overdue)}  variant={overdue > 0 ? "info" : undefined} />
      <Tile label={t.queue.statLastCall}    value={lastCallLabel} />
    </div>
  );
}

function Tile({
  label, value, variant,
}: { label: string; value: string; variant?: "danger" | "info" }) {
  return (
    <div
      role="listitem"
      className={`so-stat-tile${variant ? ` so-stat-tile--${variant}` : ""}`}
    >
      <div className="so-stat-tile__label">{label}</div>
      <div className="so-stat-tile__value">{value}</div>
    </div>
  );
}

function formatRelative(diffMs: number, t: Dict): string {
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 60) return `${mins}${t.queue.timeAgoMin}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}${t.queue.timeAgoHour}`;
  return `${Math.floor(hrs / 24)}${t.queue.timeAgoDay}`;
}
