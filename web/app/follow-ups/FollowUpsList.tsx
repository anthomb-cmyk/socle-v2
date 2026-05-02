"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type FollowUp = {
  id: string; lead_id: string | null; due_at: string; note: string;
  priority: number; status: string; source: string | null;
  lead: { full_name: string | null; company_name: string | null; address: string; city: string | null; best_phone: string | null } | null;
};

export default function FollowUpsList() {
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
    if (!confirm("Cancel this follow-up?")) return;
    setBusyId(id); setError(null);
    const r = await fetch(`/api/follow-ups/${id}`, { method: "DELETE" });
    const j = await r.json();
    setBusyId(null);
    if (!j.ok) { setError(j.error); return; }
    refresh();
  }

  if (loading) return <p className="text-zinc-500 text-sm">Loading…</p>;

  const sections = [
    { label: "Overdue", items: overdue, color: "border-red-200" },
    { label: "Today", items: today, color: "border-amber-200" },
    { label: "Upcoming", items: upcoming, color: "border-zinc-200" },
  ];

  const total = overdue.length + today.length + upcoming.length;
  if (total === 0) {
    return <p className="text-sm text-zinc-500">No follow-ups pending. 🎉</p>;
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {sections.filter(s => s.items.length > 0).map(s => (
        <section key={s.label}>
          <h2 className="text-sm uppercase tracking-wide text-zinc-500 mb-2">{s.label} ({s.items.length})</h2>
          <ul className="space-y-2">
            {s.items.map(f => (
              <li key={f.id} className={`bg-white border ${s.color} rounded-2xl p-4`}>
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1">
                    <div className="font-medium">
                      {f.lead?.full_name ?? f.lead?.company_name ?? "—"}
                      {f.lead?.city && <span className="text-zinc-500 font-normal"> · {f.lead.city}</span>}
                    </div>
                    <p className="text-sm text-zinc-700 mt-1 whitespace-pre-wrap">{f.note}</p>
                    <div className="text-xs text-zinc-500 mt-2 flex gap-3">
                      <span>📅 {new Date(f.due_at).toLocaleString("fr-CA", { dateStyle: "short", timeStyle: "short" })}</span>
                      <span>priority {f.priority}</span>
                      {f.source && <span>via {f.source}</span>}
                      {f.lead_id && <Link href={`/calls/${f.lead_id}` as never} className="underline">Open lead →</Link>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button onClick={() => complete(f.id)} disabled={busyId === f.id}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg px-3 py-1.5 disabled:opacity-50">
                      {busyId === f.id ? "…" : "✓ Done"}
                    </button>
                    <button onClick={() => cancel(f.id)} disabled={busyId === f.id}
                      className="border border-zinc-300 hover:bg-zinc-100 text-xs rounded-lg px-3 py-1.5 disabled:opacity-50">
                      Cancel
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
