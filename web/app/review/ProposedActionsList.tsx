"use client";
import { useState } from "react";
import Link from "next/link";

type Item = {
  id: string; action_type: string; target_table: string; target_id: string | null;
  proposed_change: Record<string, unknown>; rationale: string | null; confidence: number | null;
  source: string; created_at: string;
};

export default function ProposedActionsList({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject") {
    setBusy(id); setError(null);
    const r = await fetch(`/api/proposed-actions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const j = await r.json();
    setBusy(null);
    if (!j.ok) { setError(j.error); return; }
    setItems(items.filter(i => i.id !== id));
  }

  if (items.length === 0) {
    return <div className="bg-white border border-zinc-200 rounded-2xl p-6 text-center text-zinc-500 text-sm">No proposed actions waiting.</div>;
  }

  return (
    <ul className="space-y-2">
      {error && <li className="text-sm text-red-600">{error}</li>}
      {items.map(it => (
        <li key={it.id} className="bg-white border border-zinc-200 rounded-2xl p-4">
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wide text-zinc-500 flex gap-2">
                <span className="font-medium">{it.action_type}</span>
                <span>via {it.source}</span>
                {it.confidence != null && <span>· confidence {it.confidence}</span>}
              </div>
              {it.action_type === "append_note" && (
                <div className="mt-2 bg-zinc-50 rounded p-2 text-sm whitespace-pre-wrap">
                  &ldquo;{String((it.proposed_change as { append?: string }).append ?? "")}&rdquo;
                </div>
              )}
              {it.action_type !== "append_note" && (
                <pre className="mt-2 bg-zinc-50 rounded p-2 text-xs overflow-x-auto">{JSON.stringify(it.proposed_change, null, 2)}</pre>
              )}
              {it.rationale && <div className="mt-2 text-xs text-zinc-500">{it.rationale}</div>}
              <div className="text-xs text-zinc-400 mt-2 flex gap-3">
                <span>{new Date(it.created_at).toLocaleString()}</span>
                {it.target_table === "leads" && it.target_id && (
                  <Link href={`/leads/${it.target_id}` as never} className="underline">Open lead →</Link>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <button onClick={() => act(it.id, "approve")} disabled={busy === it.id}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg px-3 py-1.5 disabled:opacity-50">
                {busy === it.id ? "…" : "Approve"}
              </button>
              <button onClick={() => act(it.id, "reject")} disabled={busy === it.id}
                className="border border-zinc-300 hover:bg-zinc-100 text-xs rounded-lg px-3 py-1.5 disabled:opacity-50">
                Reject
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
