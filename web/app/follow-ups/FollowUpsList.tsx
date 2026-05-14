"use client";
// Phase 7 orchestrator + UX upgrades:
//   • Toast feedback on complete/cancel (no more silent state changes).
//   • Per-section multi-select + bulk "Marquer tout comme complété" button.
//   • Error retry button.
// Phase 8.1 i18n is preserved — every new label routes through useLocale().

import { useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { useToast } from "@/components/toast-provider";
import FollowUpBucket from "./components/FollowUpBucket";
import FollowUpCard, { type FollowUp } from "./components/FollowUpCard";

export default function FollowUpsList() {
  const { t } = useLocale();
  const { showToast } = useToast();
  const [overdue, setOverdue] = useState<FollowUp[]>([]);
  const [today, setToday] = useState<FollowUp[]>([]);
  const [upcoming, setUpcoming] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-bucket selection sets. Tracks which follow-ups the user has ticked
  // for the bulk-complete action.
  const [selected, setSelected] = useState<Record<"overdue" | "today" | "upcoming", Set<string>>>({
    overdue: new Set(),
    today: new Set(),
    upcoming: new Set(),
  });
  const [bulkBusy, setBulkBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    const [a, b, c] = await Promise.all([
      fetch("/api/follow-ups?bucket=overdue").then(r => r.json()),
      fetch("/api/follow-ups?bucket=today").then(r => r.json()),
      fetch("/api/follow-ups?bucket=upcoming").then(r => r.json()),
    ]);
    setOverdue(a.ok ? a.data : []);
    setToday(b.ok ? b.data : []);
    setUpcoming(c.ok ? c.data : []);
    // Reset selection on refresh — IDs may no longer exist.
    setSelected({ overdue: new Set(), today: new Set(), upcoming: new Set() });
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function complete(id: string) {
    setBusyId(id); setError(null);
    const r = await fetch(`/api/follow-ups/${id}/complete`, { method: "POST" });
    const j = await r.json();
    setBusyId(null);
    if (!j.ok) {
      setError(j.error);
      showToast({ message: j.error ?? t.toasts.error, tone: "error" });
      return;
    }
    showToast({ message: t.toasts.followUpDone, tone: "success" });
    refresh();
  }

  async function cancel(id: string) {
    if (!confirm(t.followUps.cancelConfirm)) return;
    setBusyId(id); setError(null);
    const r = await fetch(`/api/follow-ups/${id}`, { method: "DELETE" });
    const j = await r.json();
    setBusyId(null);
    if (!j.ok) {
      setError(j.error);
      showToast({ message: j.error ?? t.toasts.error, tone: "error" });
      return;
    }
    showToast({ message: t.toasts.followUpCancelled, tone: "success" });
    refresh();
  }

  function toggleSelect(bucket: "overdue" | "today" | "upcoming", id: string) {
    setSelected((prev) => {
      const copy = { ...prev, [bucket]: new Set(prev[bucket]) };
      if (copy[bucket].has(id)) copy[bucket].delete(id);
      else copy[bucket].add(id);
      return copy;
    });
  }

  async function bulkComplete(bucket: "overdue" | "today" | "upcoming") {
    const ids = Array.from(selected[bucket]);
    if (ids.length === 0) return;
    setBulkBusy(true);
    // Fire requests in parallel; surface failures collectively.
    const results = await Promise.allSettled(
      ids.map((id) => fetch(`/api/follow-ups/${id}/complete`, { method: "POST" })),
    );
    setBulkBusy(false);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = ids.length - ok;
    if (ok > 0) {
      showToast({ message: t.toasts.bulkCompleted(ok), tone: "success" });
    }
    if (failed > 0) {
      showToast({ message: `${failed} ${t.toasts.error}`, tone: "error" });
    }
    refresh();
  }

  if (loading) {
    return (
      <div className="fu-loading">
        <span className="fu-loading__icon" aria-hidden="true">⟳</span>
        <p className="fu-loading__title">{t.followUps.loading}</p>
      </div>
    );
  }

  const total = overdue.length + today.length + upcoming.length;
  if (total === 0) {
    return (
      <div className="fu-empty">

        <p className="fu-empty__title">{t.followUps.emptyTitle}</p>
        <p className="fu-empty__sub">{t.followUps.emptySub}</p>
      </div>
    );
  }

  type Section = { key: "overdue" | "today" | "upcoming"; title: string; items: FollowUp[] };
  const sections: Section[] = [
    { key: "overdue",  title: t.followUps.overdue,  items: overdue },
    { key: "today",    title: t.followUps.today,    items: today },
    { key: "upcoming", title: t.followUps.upcoming, items: upcoming },
  ];

  return (
    <div className="fu-list">
      {error && (
        <div className="fu-error">
          {error}{" "}
          <button
            type="button"
            onClick={refresh}
            style={{ marginLeft: 8, textDecoration: "underline", background: "none", border: "none", color: "inherit", cursor: "pointer", minHeight: 0 }}
          >
            {t.common.errorRetry}
          </button>
        </div>
      )}
      {sections.filter((s) => s.items.length > 0).map((s) => {
        const selectedCount = selected[s.key].size;
        return (
          <FollowUpBucket key={s.key} title={s.title} bucket={s.key} count={s.items.length}>
            {selectedCount > 0 && (
              <div className="fu-bulk-bar">
                <span>{t.toasts.bulkCompleted(selectedCount).replace(/\.$/, "")} sélectionné{selectedCount !== 1 ? "s" : ""}</span>
                <button
                  type="button"
                  className="fu-bulk-bar__btn"
                  onClick={() => bulkComplete(s.key)}
                  disabled={bulkBusy}
                >
                  {bulkBusy ? "…" : t.followUps.done}
                </button>
              </div>
            )}
            {s.items.map((f) => (
              <FollowUpCard
                key={f.id}
                f={f}
                bucket={s.key}
                busy={busyId === f.id || bulkBusy}
                onComplete={() => complete(f.id)}
                onCancel={() => cancel(f.id)}
                selected={selected[s.key].has(f.id)}
                onToggleSelect={() => toggleSelect(s.key, f.id)}
              />
            ))}
          </FollowUpBucket>
        );
      })}
    </div>
  );
}
