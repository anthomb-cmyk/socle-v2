"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

export type ReviewMeta = {
  timeline: string | null;
  units: number | null;
  motivation: string | null;
  askingPrice: number | null;
};

export type ReviewItemVm = {
  id: string;
  title: string;
  summary: string | null;
  urgency: string;
  created_at: string;
  lead_id: string | null;
  meta: ReviewMeta;
};

export type ReviewVelocity = {
  medianHours: number | null;
  sparkline: number[];
};

type Props = {
  initialItems: ReviewItemVm[];
  proposedCount: number;
  velocity: ReviewVelocity;
};

type Action = "approve" | "defer" | "reject";

export default function ReviewInbox({ initialItems, proposedCount, velocity }: Props) {
  const [items, setItems] = useState(initialItems);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = items[selectedIndex] ?? items[0] ?? null;
  const urgentCount = items.filter((item) => item.urgency === "urgent").length;
  const highCount = items.filter((item) => item.urgency === "high").length;

  const act = useCallback(async (item: ReviewItemVm, action: Action) => {
    setBusy(item.id);
    setError(null);
    const res = await fetch(`/api/review-items/${item.id}/${action}`, { method: "POST" });
    const json = await res.json();
    setBusy(null);
    if (!json.ok) {
      setError(json.error ?? "Erreur");
      return;
    }
    setItems((prev) => prev.filter((candidate) => candidate.id !== item.id));
    setSelectedIndex((prev) => Math.max(0, Math.min(prev, items.length - 2)));
  }, [items.length]);

  const openSelected = useCallback(() => {
    if (selected?.lead_id) window.location.href = `/leads/${selected.lead_id}`;
  }, [selected]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a")) return;
      if (!selected) return;

      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        act(selected, "approve");
      } else if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        act(selected, "defer");
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        act(selected, "reject");
      } else if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        setSelectedIndex((idx) => Math.min(items.length - 1, idx + 1));
      } else if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSelectedIndex((idx) => Math.max(0, idx - 1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        openSelected();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [act, items.length, openSelected, selected]);

  return (
    <>
      <div className="rev-tabs">
        <button type="button" className={`rev-tab rev-tab--active ${urgentCount > 0 ? "rev-tab--alert" : ""}`}>
          Hot sellers <span className="rev-tab__c">{items.length}</span>
        </button>
        <button type="button" className="rev-tab">
          Actions proposées <span className="rev-tab__c">{proposedCount}</span>
        </button>
        <button type="button" className="rev-tab">
          Urgents <span className="rev-tab__c">{urgentCount}</span>
        </button>
        <button type="button" className="rev-tab">
          Élevés <span className="rev-tab__c">{highCount}</span>
        </button>
      </div>

      <div className="rev-grid">
        <section>
          <div className="rev-section-head">
            <span className="rev-section-title">Éléments à traiter</span>
            {items.length > 0 ? <span className="pill pill--brand">{items.length}</span> : null}
          </div>

          {error ? <div className="rev-error">{error}</div> : null}
          {items.length === 0 ? (
            <div className="rev-empty">
              <p className="rev-empty__t">Boîte vide</p>
              <p className="rev-empty__sub">Aucun vendeur à traiter en ce moment.</p>
            </div>
          ) : (
            <ul className="rev-list">
              {items.map((item, index) => (
                <li
                  key={item.id}
                  className={`rev-card ${item.urgency === "urgent" ? "rev-card--hot" : ""} ${index === selectedIndex ? "rev-card--selected" : ""}`}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="rev-card__head">
                    <div className={`rev-card__icon ${item.urgency === "urgent" ? "rev-card__icon--hot" : "rev-card__icon--auto"}`}>
                      <Icon name={item.urgency === "urgent" ? "flame" : "alert"} size={20} />
                    </div>
                    <div className="rev-card__body">
                      <h3 className="rev-card__t">{item.title}</h3>
                      <div className="rev-card__sub">
                        <UrgencyPill urgency={item.urgency} />
                        {item.lead_id ? <span>Lead lié</span> : <span>Lead —</span>}
                      </div>
                    </div>
                    <span className="rev-card__age">{formatDate(item.created_at)}</span>
                  </div>

                  <div className="rev-quote">{item.summary ?? "—"}</div>
                  <MetaChips meta={item.meta} />

                  <div className="rev-card__acts">
                    <button type="button" onClick={() => act(item, "approve")} disabled={busy === item.id} className="btn btn--primary">
                      {busy === item.id ? "…" : "Approuver"}
                    </button>
                    {item.lead_id ? (
                      <Link href={`/leads/${item.lead_id}` as never} className="btn">Voir le lead</Link>
                    ) : (
                      <span className="btn">Voir le lead —</span>
                    )}
                    <button type="button" onClick={() => act(item, "defer")} disabled={busy === item.id} className="btn">Plus tard</button>
                    <button type="button" onClick={() => act(item, "reject")} disabled={busy === item.id} className="btn btn--reject">Rejeter</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="rev-aside">
          <div className="rev-aside__card">
            <div className="rev-aside__t">Vue d&apos;ensemble</div>
            <div className="rev-breakdown">
              <BreakdownRow label="Urgents" value={urgentCount} dot="red" />
              <BreakdownRow label="Élevés" value={highCount} dot="amber" />
              <BreakdownRow label="Actions proposées" value={proposedCount} dot="purple" />
              <BreakdownRow label="Total en attente" value={items.length + proposedCount} total />
            </div>
          </div>

          <div className="rev-aside__card">
            <div className="rev-aside__t">Vélocité · 7 j</div>
            <div className="rev-velocity">
              <span className="rev-velocity__value">{velocity.medianHours == null ? "—" : formatHours(velocity.medianHours)}</span>
              <span className="rev-velocity__label">médiane à l&apos;approbation</span>
            </div>
            <Sparkline values={velocity.sparkline} />
          </div>

          <div className="rev-aside__card">
            <div className="rev-aside__t">Raccourcis</div>
            <Shortcut label="Approuver" value="A" />
            <Shortcut label="Plus tard" value="L" />
            <Shortcut label="Rejeter" value="R" />
            <Shortcut label="Suivant" value="J" />
            <Shortcut label="Précédent" value="K" />
            <Shortcut label="Ouvrir le lead" value="Enter" />
          </div>
        </aside>
      </div>
    </>
  );
}

function MetaChips({ meta }: { meta: ReviewMeta }) {
  const chips = [
    ["Échéance", meta.timeline],
    ["Logements", meta.units == null ? null : `${meta.units}`],
    ["Motivation", meta.motivation],
    ["Prix attendu", meta.askingPrice == null ? null : formatMoney(meta.askingPrice)],
  ];
  return (
    <div className="rev-meta">
      {chips.map(([label, value]) => (
        <span key={label} className="rev-chip">
          {label} <span className="mono">{value ?? "—"}</span>
        </span>
      ))}
    </div>
  );
}

function BreakdownRow({ label, value, dot, total }: { label: string; value: number; dot?: "red" | "amber" | "purple"; total?: boolean }) {
  return (
    <div className={`rev-br-row ${total ? "rev-br-row--total" : ""}`}>
      <div className="rev-br-row__l">
        {!total ? <span className={`rev-br-row__dot ${dot ? `rev-br-row__dot--${dot}` : ""}`} /> : null}
        {label}
      </div>
      <span className="rev-br-row__v">{value}</span>
    </div>
  );
}

function Shortcut({ label, value }: { label: string; value: string }) {
  return (
    <div className="rev-kbd-row">
      <span className="rev-kbd-row__t">{label}</span>
      <span className="rev-kbd">{value}</span>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const points = useMemo(() => {
    const max = Math.max(...values, 1);
    return values.map((value, index) => {
      const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 200;
      const y = 38 - (value / max) * 30;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }, [values]);
  return (
    <svg className="rev-spark" viewBox="0 0 200 42" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UrgencyPill({ urgency }: { urgency: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    urgent: { label: "Urgent", cls: "pill--hot" },
    high: { label: "Élevé", cls: "pill--review" },
    normal: { label: "Normal", cls: "pill--ready" },
    low: { label: "Faible", cls: "pill--cold" },
  };
  const item = cfg[urgency] ?? { label: urgency, cls: "pill--cold" };
  return <span className={`pill ${item.cls}`}><span className="pill__dot" />{item.label}</span>;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("fr-CA", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHours(value: number) {
  const hours = Math.floor(value);
  const minutes = Math.round((value - hours) * 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function formatMoney(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value}`;
}

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
    alert: <path d="M12 9v4M12 17h.01M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0z" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
