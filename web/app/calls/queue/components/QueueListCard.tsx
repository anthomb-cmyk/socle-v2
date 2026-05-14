"use client";
import Link from "next/link";
import type { AugmentedLead, QueueEmptyDiagnostics } from "../QueueLeadList";
import type { AdminScope } from "@/components/caller/CallerQueueScopeBar";
import type { Dict } from "@/lib/i18n";
import QueueRow from "./QueueRow";

export type QueueFilter = "all" | "hot" | "verified";

type Props = {
  items: AugmentedLead[];
  query: string;
  filter: QueueFilter;
  onQueryChange: (q: string) => void;
  onFilterChange: (f: QueueFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  isAdmin: boolean;
  scope: AdminScope;
  t: Dict;
  emptyDiagnostics?: QueueEmptyDiagnostics | null;
};

export default function QueueListCard({
  items,
  query,
  filter,
  onQueryChange,
  onFilterChange,
  selectedId,
  onSelect,
  onOpen,
  isAdmin,
  scope,
  t,
  emptyDiagnostics,
}: Props) {
  return (
    <div className="queue-list-card">
      {/* Search / filter bar */}
      <div className="queue-list-bar">
        <div className="queue-list-bar__search">
          <svg
            className="queue-list-bar__search-icon"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e: { target: { value: string } }) => onQueryChange(e.target.value)}
            placeholder={t.queue.search}
            className="queue-list-bar__input"
            aria-label={t.queue.search}
          />
        </div>

        <div className="queue-list-bar__pills">
          <button
            type="button"
            className={`queue-pill queue-pill--hot${filter === "hot" ? " queue-pill--active" : ""}`}
            aria-pressed={filter === "hot"}
            onClick={() => onFilterChange(filter === "hot" ? "all" : "hot")}
          >
            {t.queue.priorityHot}
          </button>
          <button
            type="button"
            className={`queue-pill queue-pill--verified${filter === "verified" ? " queue-pill--active" : ""}`}
            aria-pressed={filter === "verified"}
            onClick={() => onFilterChange(filter === "verified" ? "all" : "verified")}
          >
            {t.queue.phoneVerified}
          </button>
        </div>

        {/* Admin scope segmented control */}
        {isAdmin && (
          <div className="queue-scope-seg" role="group" aria-label="Admin queue scope">
            <ScopeBtn target="all" current={scope} text={t.queue.assignAll} />
            <ScopeBtn target="mine" current={scope} text={t.queue.assignMine} />
            <ScopeBtn target="unassigned" current={scope} text={t.queue.assignNone} />
          </div>
        )}
      </div>

      {/* Column header strip */}
      <div className="queue-col-head" role="rowgroup" aria-hidden="true">
        <div className="queue-col-head__cell">{t.queue.colOwner}</div>
        <div className="queue-col-head__cell">{t.queue.colCampaign}</div>
        <div className="queue-col-head__cell">{t.queue.colUnits}</div>
        <div className="queue-col-head__cell">{t.queue.colNumber}</div>
        <div className="queue-col-head__cell queue-col-head__cell--right">{t.queue.colOutcome}</div>
      </div>

      {/* Row list or empty state */}
      {items.length === 0 ? (
        <QueueEmptyInner t={t} emptyDiagnostics={emptyDiagnostics ?? null} />
      ) : (
        <ul className="queue-rows" role="rowgroup">
          {items.map((item) => (
            <QueueRow
              key={item.lead.lead_id}
              item={item}
              selected={item.lead.lead_id === selectedId}
              onSelect={() => onSelect(item.lead.lead_id)}
              onOpen={() => onOpen(item.lead.lead_id)}
              t={t}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ScopeBtn({
  target,
  current,
  text,
}: {
  target: AdminScope;
  current: AdminScope;
  text: string;
}) {
  const active = current === target;
  return (
    <Link
      href={`/calls/queue?scope=${target}` as never}
      className={`queue-scope-seg__btn${active ? " queue-scope-seg__btn--active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      {text}
    </Link>
  );
}

function QueueEmptyInner({
  t,
  emptyDiagnostics,
}: {
  t: Dict;
  emptyDiagnostics: QueueEmptyDiagnostics | null;
}) {
  // Build a list of actionable diagnostics — each row tells the user *why*
  // their queue is empty and links to the screen where they can fix it.
  type Action = { label: string; count: number; href: string };
  const actions: Action[] = [];
  if (emptyDiagnostics) {
    if (emptyDiagnostics.isAdmin && emptyDiagnostics.unassignedGlobal > 0) {
      actions.push({
        label: t.queueEmptyActions.browseUnassigned,
        count: emptyDiagnostics.unassignedGlobal,
        href: "/calls/queue?scope=unassigned",
      });
    }
    if (emptyDiagnostics.myFutureCallbacks > 0) {
      actions.push({
        label: t.queueEmptyActions.browseFuture,
        count: emptyDiagnostics.myFutureCallbacks,
        href: "/follow-ups",
      });
    }
    if (emptyDiagnostics.myMissingPhone > 0) {
      actions.push({
        label: t.queueEmptyActions.fixPhones,
        count: emptyDiagnostics.myMissingPhone,
        href: "/phone-review",
      });
    }
    // Always offer the "all leads" escape hatch.
    actions.push({
      label: t.queueEmptyActions.browseAll,
      count: 0,
      href: "/leads",
    });
  }

  return (
    <div className="queue-empty-inner">
      <div className="queue-empty-inner__icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <p className="queue-empty-inner__title">{t.queue.emptyTitle}</p>
      <p className="queue-empty-inner__sub">
        {emptyDiagnostics ? t.queue.emptyDiagAssignedNone : t.queue.empty}
      </p>
      {emptyDiagnostics && (
        <>
          <ul className="queue-diag-list" style={{ listStyle: "none", padding: 0, margin: "10px 0 4px", fontSize: 12, color: "var(--crm-text2, #4B5563)" }}>
            {emptyDiagnostics.myFutureCallbacks > 0 && <li>{t.queue.emptyDiagFuture(emptyDiagnostics.myFutureCallbacks)}</li>}
            {emptyDiagnostics.myMissingPhone   > 0 && <li>{t.queue.emptyDiagPhone(emptyDiagnostics.myMissingPhone)}</li>}
            {emptyDiagnostics.myLockedByOthers > 0 && <li>{t.queue.emptyDiagLocked(emptyDiagnostics.myLockedByOthers)}</li>}
            {emptyDiagnostics.isAdmin && emptyDiagnostics.unassignedGlobal > 0 && (
              <li>{t.queue.emptyDiagUnassigned(emptyDiagnostics.unassignedGlobal)}</li>
            )}
          </ul>
          {actions.length > 0 && (
            <div className="queue-empty-actions">
              {actions.map((a) => (
                <Link key={a.href} href={a.href as never} className="queue-empty-action">
                  <span>{a.label}</span>
                  {a.count > 0 && <span className="queue-empty-action__count">{a.count}</span>}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
