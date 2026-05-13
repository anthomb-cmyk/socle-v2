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
    setBusy(id);
    setError(null);
    const r = await fetch(`/api/proposed-actions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const j = await r.json();
    setBusy(null);
    if (!j.ok) {
      setError(j.error);
      return;
    }
    setItems(items.filter((item) => item.id !== id));
  }

  if (items.length === 0) {
    return <div className="rev-empty">—</div>;
  }

  return (
    <ul className="rev-proposed">
      {error ? <li className="rev-error">{error}</li> : null}
      {items.map((item) => (
        <li key={item.id} className="rev-card">
          <div className="rev-card__head">
            <div className="rev-card__icon rev-card__icon--auto">
              <span className="mono">{Math.round((item.confidence ?? 0) * 100)}</span>
            </div>
            <div className="rev-card__body">
              <h3 className="rev-card__t">{item.action_type}</h3>
              <div className="rev-card__sub">
                <span>{item.source}</span>
                <span>{item.target_table}</span>
              </div>
            </div>
          </div>

          {item.action_type === "append_note" ? (
            <div className="rev-proposed__change">
              {String((item.proposed_change as { append?: string }).append ?? "—")}
            </div>
          ) : (
            <pre className="rev-proposed__change">{JSON.stringify(item.proposed_change, null, 2)}</pre>
          )}

          {item.rationale ? <div className="rev-card__sub">{item.rationale}</div> : null}

          <div className="rev-proposed__foot">
            <span>{new Date(item.created_at).toLocaleString("fr-CA")}</span>
            {item.target_table === "leads" && item.target_id ? (
              <Link href={`/leads/${item.target_id}` as never} className="rev-link">Ouvrir le lead</Link>
            ) : null}
          </div>

          <div className="rev-card__acts">
            <button onClick={() => act(item.id, "approve")} disabled={busy === item.id} className="btn btn--primary">
              {busy === item.id ? "…" : "Approuver"}
            </button>
            <button onClick={() => act(item.id, "reject")} disabled={busy === item.id} className="btn btn--reject">
              Rejeter
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
