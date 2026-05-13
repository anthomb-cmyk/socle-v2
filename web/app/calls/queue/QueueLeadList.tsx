"use client";
// Phase 9 orchestrator. Keeps the public prop signature (leads /
// callCounts / hotSellers) so the server page does not change. Filtering
// is purely client-side over the already-fetched leads — the queue server
// query, sort order, assigned_to filter, CALLABLE_STATUSES, best_phone
// filter, future-callback exclusion and call_locks exclusion are all
// untouched in page.tsx.

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/locale-provider";
import type { AdminScope } from "@/components/caller/CallerQueueScopeBar";
import type { Dict } from "@/lib/i18n";
import type { QueueFilter } from "./components/QueueListCard";
import QueueHeader from "./components/QueueHeader";
import QueueStatTiles from "./components/QueueStatTiles";
import QueueListCard from "./components/QueueListCard";
import QueuePreviewCard from "./components/QueuePreviewCard";
import KeyboardHints from "./components/KeyboardHints";

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
  // fit_score is on leads.* but not exposed by leads_view, so the queue
  // doesn't fetch it. Optional so the cast in page.tsx still works.
  fit_score?: number | null;
};

export type AugmentedLead = {
  lead: QueueLead;
  callCount: number;
  formattedPhone: string | null;
  overdueLabel: string | null;
  lastContactedAgo: string | null;
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
  hotSellers,
}: {
  leads: QueueLead[];
  callCounts: Record<string, number>;
  // hotSellers prop is still accepted (page.tsx passes it) — drives the "À réviser" stat tile.
  hotSellers: number;
  /** Populated by page.tsx when leads.length === 0; null otherwise. */
  emptyDiagnostics?: QueueEmptyDiagnostics | null;
  /** True when the logged-in user is admin. Drives the scope toggle UI. */
  isAdmin?: boolean;
  /** Resolved scope from page.tsx (caller-tier always "mine" — server-enforced). */
  scope?: AdminScope;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Pre-compute per-lead derived strings once per render
  const augmented = useMemo<AugmentedLead[]>(
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

  const filtered = useMemo<AugmentedLead[]>(() => {
    return augmented.filter((item: AugmentedLead) => {
      const { lead } = item;
      if (filter === "hot" && (lead.priority ?? 0) < 80) return false;
      if (filter === "verified" && lead.status !== "phone_verified") return false;
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

  // Stat counts derived from the full (unfiltered) lead list
  const now = Date.now();
  const statCallable = leads.length;
  const statOverdue = leads.filter(
    (l) => l.next_action_at && new Date(l.next_action_at).getTime() <= now,
  ).length;
  const statVerified = leads.filter((l) => l.status === "phone_verified").length;

  // Auto-select first item when the filtered list changes and nothing is selected
  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    const stillPresent = filtered.some((a: AugmentedLead) => a.lead.lead_id === selectedId);
    if (!stillPresent) setSelectedId(filtered[0].lead.lead_id);
  }, [filtered, selectedId]);

  const selectedItem = useMemo<AugmentedLead | null>(
    () => filtered.find((a: AugmentedLead) => a.lead.lead_id === selectedId) ?? null,
    [filtered, selectedId],
  );

  // Keyboard navigation (bound on the outer wrapper; skip when input focused)
  const handleKeyDown = useCallback(
    (e: { key: string; target: EventTarget | null; preventDefault(): void }) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;

      const idx = filtered.findIndex((a: AugmentedLead) => a.lead.lead_id === selectedId);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (idx < filtered.length - 1) setSelectedId(filtered[idx + 1].lead.lead_id);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (idx > 0) setSelectedId(filtered[idx - 1].lead.lead_id);
      } else if (e.key === "Enter" && selectedId) {
        e.preventDefault();
        router.push(`/calls/${selectedId}` as never);
      } else if (e.key === "/" || e.key === "s") {
        const input = wrapRef.current?.querySelector<HTMLInputElement>(".queue-list-bar__input");
        if (input) { e.preventDefault(); input.focus(); }
      } else if (e.key === "c" && selectedId) {
        e.preventDefault();
        router.push(`/calls/${selectedId}` as never);
      }
    },
    [filtered, selectedId, router],
  );

  // Eyebrow: "<n> leads à appeler · <campaign>"
  const campaignName = leads[0]?.campaign_name ?? null;
  const eyebrow = `${leads.length} lead${leads.length !== 1 ? "s" : ""} à appeler${campaignName ? ` · ${campaignName}` : ""}`;

  return (
    <div
      className="queue-wrap"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      ref={wrapRef}
    >
      <QueueHeader eyebrow={eyebrow} t={t} />

      <QueueStatTiles
        callable={statCallable}
        overdue={statOverdue}
        verified={statVerified}
        review={hotSellers}
        t={t}
      />

      {selectedItem && (
        <button
          type="button"
          className="queue-focus-banner"
          onClick={() => router.push(`/calls/${selectedItem.lead.lead_id}` as never)}
        >
          <span className="queue-focus-banner__icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="queue-focus-banner__body">
            <span className="queue-focus-banner__k">Prochain appel</span>
            <span className="queue-focus-banner__t">
              {selectedItem.lead.full_name ?? selectedItem.lead.company_name ?? "—"}
              {selectedItem.lead.city ? ` · ${selectedItem.lead.city}` : ""}
              {selectedItem.lead.num_units != null ? ` · ${selectedItem.lead.num_units} log.` : ""}
            </span>
          </span>
          <span className="queue-focus-banner__meta">
            {selectedItem.formattedPhone ?? "—"}
          </span>
        </button>
      )}

      <div className="queue-body">
        <QueueListCard
          items={filtered}
          query={query}
          filter={filter}
          onQueryChange={setQuery}
          onFilterChange={setFilter}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          onOpen={(id) => router.push(`/calls/${id}` as never)}
          isAdmin={isAdmin}
          scope={scope}
          t={t}
          emptyDiagnostics={emptyDiagnostics}
        />

        <QueuePreviewCard item={selectedItem} t={t} />
      </div>

      <KeyboardHints t={t} />
    </div>
  );
}
