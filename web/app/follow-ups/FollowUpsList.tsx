"use client";
// Phase 7 orchestrator. State and handler bodies are byte-identical to
// the previous implementation: refresh fans out to /api/follow-ups?bucket=…,
// complete POSTs to /api/follow-ups/{id}/complete, cancel DELETEs
// /api/follow-ups/{id}. JSX reorganized into FollowUpBucket + FollowUpCard.
// Phase 8.1: wired all display strings through useLocale().t.followUps.

import { useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import FollowUpBucket from "./components/FollowUpBucket";
import FollowUpCard, { type FollowUp } from "./components/FollowUpCard";

export default function FollowUpsList() {
  const { t } = useLocale();
  const [overdue, setOverdue] = useState<FollowUp[]>([]);
  const [today, setToday] = useState<FollowUp[]>([]);
  const [upcoming, setUpcoming] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function complete(id: string) {
    setBusyId(id); setError(null);
    const r = await fetch(`/api/follow-ups/${id}/complete`, { method: "POST" });
    const j = await r.json();
    setBusyId(null);
    if (!j.ok) { setError(j.error); return; }
    refresh();
  }

  async function cancel(id: string) {
    if (!confirm(t.followUps.cancelConfirm)) return;
    setBusyId(id); setError(null);
    const r = await fetch(`/api/follow-ups/${id}`, { method: "DELETE" });
    const j = await r.json();
    setBusyId(null);
    if (!j.ok) { setError(j.error); return; }
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
        <div className="fu-error">{error}</div>
      )}
      {sections.filter((s) => s.items.length > 0).map((s) => (
        <FollowUpBucket key={s.key} title={s.title} bucket={s.key} count={s.items.length}>
          {s.items.map((f) => (
            <FollowUpCard
              key={f.id}
              f={f}
              bucket={s.key}
              busy={busyId === f.id}
              onComplete={() => complete(f.id)}
              onCancel={() => cancel(f.id)}
            />
          ))}
        </FollowUpBucket>
      ))}
    </div>
  );
}
