"use client";
// Phase 3 orchestrator. Keeps the public prop signature (leads /
// callCounts / hotSellers) so the server page does not change. Filtering
// is purely client-side over the already-fetched leads — the queue server
// query, sort order, assigned_to filter, CALLABLE_STATUSES, best_phone
// filter, future-callback exclusion and call_locks exclusion are all
// untouched in page.tsx.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/locale-provider";
import CallerQueueFilters, { type QueueFilter } from "@/components/caller/CallerQueueFilters";
import CallerQueueScopeBar, { type AdminScope } from "@/components/caller/CallerQueueScopeBar";
import CallerLeadRow from "@/components/caller/CallerLeadRow";
import CallerLeadCard from "@/components/caller/CallerLeadCard";
import type { Dict } from "@/lib/i18n";

export type QueueLead = {
  lead_id: string;
  full_name: string | null;
  company_name: string | null;
  address: string;
  city: string | null;
  num_units: number | null;
  best_phone: string | null;
  status: string;
  campaign_name: string | null;
  last_contacted_at: string | null;
  next_action_at: string | null;
  priority: number | null;
};

/**
 * Server-fetched diagnostic counts that explain *why* the queue is empty.
 * Populated only when leads.length === 0 (page.tsx). Pure UX info — no
 * routing, assignment, or business logic depends on these numbers.
 */
export type QueueEmptyDiagnostics = {
  /** Leads in CALLABLE_STATUSES with assigned_to IS NULL (admin can assign). */
  unassignedGlobal: number;
  /** My CALLABLE_STATUSES leads with a future-dated next_action_at. */
  myFutureCallbacks: number;
  /** My CALLABLE_STATUSES leads where best_phone is null. */
  myMissingPhone: number;
  /** My CALLABLE_STATUSES leads excluded because another caller holds a lock. */
  myLockedByOthers: number;
  /** Lets the empty state show admin-only actions (e.g. "Voir tous les leads"). */
  isAdmin: boolean;
};

function formatPhone(phone: string | null): string | null {
  if (!phone) return null;
  const m = phone.replace(/\D/g, "");
  if (m.length === 11 && m[0] === "1")
    return `(${m.slice(1, 4)}) ${m.slice(4, 7)}-${m.slice(7)}`;
  if (m.length === 10)
    return `(${m.slice(0, 3)}) ${m.slice(3, 6)}-${m.slice(6)}`;
  return phone;
}

function formatTimeAgo(diffMs: number, t: Dict): string {
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 60) return `${mins}${t.queue.timeAgoMin}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}${t.queue.timeAgoHour}`;
  return `${Math.floor(hrs / 24)}${t.queue.timeAgoDay}`;
}

export default function QueueLeadList({
  leads,
  callCounts,
  emptyDiagnostics,
  isAdmin = false,
  scope = "mine",
}: {
  leads: QueueLead[];
  callCounts: Record<string, number>;
  // hotSellers prop is still accepted (page.tsx passes it) but is not
  // consumed in the queue UI — kept on the type only for signature stability.
  hotSellers: number;
  /** Populated by page.tsx when leads.length === 0; null otherwise. */
  emptyDiagnostics?: QueueEmptyDiagnostics | null;
  /** True when the logged-in user is admin. Drives the scope toggle UI. */
  isAdmin?: boolean;
  /** Resolved scope from page.tsx (caller-tier always "mine" — server-enforced). */
  scope?: AdminScope;
}) {
  const { t } = useLocale();
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [query, setQuery] = useState("");

  // Pre-compute per-lead derived strings once per render
  const augmented = useMemo(
    () =>
      leads.map((lead) => {
        const overdueDiff =
          lead.next_action_at != null
            ? Date.now() - new Date(lead.next_action_at).getTime()
            : null;
        const isOverdue = overdueDiff != null && overdueDiff > 0;
        return {
          lead,
          callCount: callCounts[lead.lead_id] ?? 0,
          formattedPhone: formatPhone(lead.best_phone),
          overdueLabel:
            isOverdue && overdueDiff != null
              ? t.queue.overdueLabel(formatTimeAgo(overdueDiff, t))
              : null,
          lastContactedAgo: lead.last_contacted_at
            ? `il y a ${formatTimeAgo(Date.now() - new Date(lead.last_contacted_at).getTime(), t)}`
            : null,
        };
      }),
    [leads, callCounts, t],
  );

  const filtered = useMemo(() => {
    return augmented.filter(({ lead }) => {
      if (filter === "hot" && (lead.priority ?? 0) < 80) return false;
      const q = query.trim().toLowerCase();
      if (q) {
        const haystack = [
          lead.full_name,
          lead.company_name,
          lead.address,
          lead.city,
          lead.campaign_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [augmented, filter, query]);

  const overdueCount = augmented.filter((a) => a.overdueLabel != null).length;

  return (
    <>
      {/* Header */}
      <header className="so-queue-header">
        <div className="so-queue-header__titles">
          <h1 className="crm-page-title">{t.queue.title}</h1>
          <p className="crm-page-sub">
            {t.queue.leadCount(leads.length)}
            {overdueCount > 0 && (
              <>
                {" "}
                ·{" "}
                <span style={{ color: "var(--crm-blue)", fontWeight: 600 }}>
                  {t.queue.overdueCount(overdueCount)}
                </span>
              </>
            )}
          </p>
        </div>
        <Link href="/leads" className="crm-btn">
          {t.queue.allLeads}
        </Link>
      </header>

      {/* Admin-only scope toggle (All / Mine / Unassigned).
          Caller-tier never sees this — server forces scope="mine" regardless
          of any ?scope=… URL param. */}
      {isAdmin && <CallerQueueScopeBar scope={scope} />}

      {/* Filters: only when there's something to filter */}
      {leads.length > 0 && (
        <CallerQueueFilters
          filter={filter}
          query={query}
          onFilterChange={setFilter}
          onQueryChange={setQuery}
        />
      )}

      {/* Empty / no-results / list */}
      {leads.length === 0 ? (
        <QueueEmptyState diagnostics={emptyDiagnostics ?? null} t={t} />
      ) : filtered.length === 0 ? (
        <div className="so-queue-empty">
          <div className="so-queue-empty__sub">{t.queue.empty}</div>
        </div>
      ) : (
        <>
          {/* Desktop: tabular rows. Mobile: app-like cards. CSS picks one. */}
          <ul className="so-queue-list__rows">
            {filtered.map((item) => (
              <CallerLeadRow
                key={item.lead.lead_id}
                lead={item.lead}
                callCount={item.callCount}
                formattedPhone={item.formattedPhone}
                overdueLabel={item.overdueLabel}
                lastContactedAgo={item.lastContactedAgo}
              />
            ))}
          </ul>
          <ul className="so-queue-list__cards">
            {filtered.map((item) => (
              <CallerLeadCard
                key={item.lead.lead_id}
                lead={item.lead}
                callCount={item.callCount}
                formattedPhone={item.formattedPhone}
                overdueLabel={item.overdueLabel}
                lastContactedAgo={item.lastContactedAgo}
              />
            ))}
          </ul>
        </>
      )}

      {leads.length > 0 && <div className="so-queue-footer">{t.queue.footer}</div>}
    </>
  );
}

// ── Empty-state breakdown ───────────────────────────────────────────────────
// Renders the new Phase-3 visual when the queue is empty, explaining *why*
// (unassigned in system / future callbacks / missing phone / locked) and
// surfacing role-aware shortcuts. Read-only — no logic side effects.
function QueueEmptyState({
  diagnostics,
  t,
}: {
  diagnostics: QueueEmptyDiagnostics | null;
  t: Dict;
}) {
  const rows: React.ReactNode[] = [];

  if (diagnostics) {
    rows.push(
      <li key="assigned">{t.queue.emptyDiagAssignedNone}</li>,
    );
    if (diagnostics.unassignedGlobal > 0) {
      rows.push(
        <li key="unassigned">{t.queue.emptyDiagUnassigned(diagnostics.unassignedGlobal)}</li>,
      );
    }
    if (diagnostics.myFutureCallbacks > 0) {
      rows.push(
        <li key="future">{t.queue.emptyDiagFuture(diagnostics.myFutureCallbacks)}</li>,
      );
    }
    if (diagnostics.myMissingPhone > 0) {
      rows.push(
        <li key="phone">{t.queue.emptyDiagPhone(diagnostics.myMissingPhone)}</li>,
      );
    }
    if (diagnostics.myLockedByOthers > 0) {
      rows.push(
        <li key="locked">{t.queue.emptyDiagLocked(diagnostics.myLockedByOthers)}</li>,
      );
    }
  }

  return (
    <div className="so-queue-empty so-queue-empty--detailed">
      <div className="so-queue-empty__icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="so-queue-empty__title">{t.queue.emptyTitle}</div>
      {rows.length > 0 && (
        <ul className="so-queue-empty__breakdown">{rows}</ul>
      )}
      <div className="so-queue-empty__actions">
        <Link href="/leads" className="crm-btn">
          {t.queue.allLeads}
        </Link>
        {diagnostics?.myFutureCallbacks ? (
          <Link href="/follow-ups" className="crm-btn">
            {t.nav.followUps}
          </Link>
        ) : null}
        {diagnostics?.isAdmin && diagnostics.myMissingPhone > 0 ? (
          <Link href="/phone-review" className="crm-btn">
            {t.nav.phoneReview}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
