"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type DealMapDeal = {
  id: string;
  title: string;
  stage: string;
  address: string | null;
  units: number | null;
  asking_price: number | null;
  offer_price: number | null;
  temperature: string;
  priority: string;
  contact_name: string | null;
  lat: number | null;
  lng: number | null;
  assigned_to: string | null;
  updated_at: string;
};

const STAGE_LABELS: Record<string, string> = {
  prospection: "Prospection",
  analyse: "Analyse",
  offre: "Offre",
  due_diligence: "Due diligence",
  financement: "Financement",
  cloture: "Clôturé",
  abandonne: "Abandonné",
};

const TEMP_LABELS: Record<string, string> = {
  froid: "Froid",
  tiede: "Tiède",
  chaud: "Chaud",
};

function mapsUrl(deal: DealMapDeal) {
  if (deal.lat != null && deal.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${deal.lat},${deal.lng}`;
  }
  const q = encodeURIComponent([deal.address, "QC", "Canada"].filter(Boolean).join(", "));
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function mapEmbedSrc(deal: DealMapDeal | null) {
  if (!deal) return "https://www.google.com/maps?q=Quebec,Canada&z=6&output=embed";
  if (deal.lat != null && deal.lng != null) {
    return `https://www.google.com/maps?q=${deal.lat},${deal.lng}&z=15&output=embed`;
  }
  const q = encodeURIComponent([deal.address, "QC", "Canada"].filter(Boolean).join(", "));
  return `https://www.google.com/maps?q=${q}&z=15&output=embed`;
}

function fmtMoney(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(".0", "")}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value.toLocaleString("fr-CA")}`;
}

function relDate(iso: string): string {
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (diffDays <= 0) return "aujourd'hui";
  if (diffDays === 1) return "hier";
  return `${diffDays}j`;
}

function groupDeals(deals: DealMapDeal[]) {
  const grouped = new Map<string, DealMapDeal[]>();
  for (const deal of deals) {
    if (!grouped.has(deal.stage)) grouped.set(deal.stage, []);
    grouped.get(deal.stage)!.push(deal);
  }
  return grouped;
}

export function DealMapClient({ deals }: { deals: DealMapDeal[] }) {
  const [selectedId, setSelectedId] = useState(() => deals.find((deal) => deal.address)?.id ?? deals[0]?.id ?? null);
  const selected = deals.find((deal) => deal.id === selectedId) ?? deals[0] ?? null;
  const grouped = useMemo(() => groupDeals(deals), [deals]);
  const withCoords = deals.filter((deal) => deal.lat != null && deal.lng != null);
  const hotDeals = deals.filter((deal) => deal.temperature === "chaud");
  const totalValue = deals.reduce((sum, deal) => sum + (deal.asking_price ?? 0), 0);

  return (
    <main className="dealmap-page">
      <header className="dealmap-head">
        <div>
          <div className="dealmap-head__eyebrow">Pipeline · géographie</div>
          <h1 className="dealmap-head__title">Carte des deals</h1>
          <p className="dealmap-head__sub">
            {deals.length === 0
              ? "Aucun deal actif à afficher."
              : `${deals.length} deal${deals.length > 1 ? "s" : ""} actif${deals.length > 1 ? "s" : ""} · ${withCoords.length} géocodé${withCoords.length > 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="dealmap-head__actions">
          <Link href="/pipeline" className="btn">Pipeline deals</Link>
          <Link href="/pipeline" className="btn btn--gold">Nouveau deal</Link>
        </div>
      </header>

      <section className="dealmap-stats" aria-label="Résumé pipeline">
        <Metric label="Deals actifs" value={String(deals.length)} />
        <Metric label="Deals chauds" value={String(hotDeals.length)} tone="hot" />
        <Metric label="Géocodés" value={`${withCoords.length}/${deals.length}`} />
        <Metric label="Valeur demandée" value={fmtMoney(totalValue || null)} />
      </section>

      {deals.length === 0 ? (
        <section className="dealmap-empty">
          <h2>Aucun deal actif</h2>
          <p>Ajoute des deals dans le pipeline pour les voir ici.</p>
          <Link href="/pipeline" className="btn btn--gold">Ouvrir le pipeline</Link>
        </section>
      ) : (
        <div className="dealmap-layout">
          <section className="dealmap-canvas" aria-label="Carte Google du deal sélectionné">
            <div className="dealmap-map-frame">
              <iframe
                key={selected?.id ?? "empty"}
                className="dealmap-iframe"
                title={selected ? `Carte de ${selected.title}` : "Carte des deals"}
                src={mapEmbedSrc(selected)}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
              <div className="dealmap-canvas__legend">
                <span><span className="dealmap-dot dealmap-dot--hot" />Chaud</span>
                <span><span className="dealmap-dot dealmap-dot--warm" />Tiède/froid</span>
                <span><span className="dealmap-dot dealmap-dot--missing" />Sans GPS</span>
              </div>
              {selected && (
                <div className="dealmap-selected">
                  <div>
                    <div className="dealmap-selected__label">Deal sélectionné</div>
                    <h2>{selected.title}</h2>
                    <p>{selected.address ?? "Adresse non renseignée"}</p>
                  </div>
                  <div className="dealmap-selected__actions">
                    <Link href={`/pipeline/${selected.id}` as never} className="dealmap-card__open">Fiche</Link>
                    {(selected.address || (selected.lat != null && selected.lng != null)) && (
                      <a href={mapsUrl(selected)} target="_blank" rel="noopener noreferrer" className="dealmap-card__maps">
                        Google Maps
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="dealmap-list" aria-label="Deals par stade">
            {Array.from(grouped.entries()).map(([stage, items]) => (
              <div key={stage} className="dealmap-stage">
                <div className="dealmap-stage__head">
                  <h2>{STAGE_LABELS[stage] ?? stage}</h2>
                  <span>{items.length}</span>
                </div>
                <div className="dealmap-stage__items">
                  {items.map((deal) => {
                    const isSelected = deal.id === selected?.id;
                    return (
                      <article
                        key={deal.id}
                        className={`dealmap-card dealmap-card--${deal.temperature}${isSelected ? " dealmap-card--selected" : ""}`}
                      >
                        <button
                          type="button"
                          className="dealmap-card__select"
                          onClick={() => setSelectedId(deal.id)}
                          aria-pressed={isSelected}
                        >
                          <span className="dealmap-card__title">{deal.title}</span>
                          <span className="dealmap-card__addr">{deal.address ?? "—"}</span>
                          <span className="dealmap-card__meta">
                            <span>{deal.units != null ? `${deal.units} log.` : "—"}</span>
                            <span>{fmtMoney(deal.asking_price)}</span>
                            <span>{TEMP_LABELS[deal.temperature] ?? deal.temperature}</span>
                            <span>maj {relDate(deal.updated_at)}</span>
                          </span>
                        </button>
                        <div className="dealmap-card__actions">
                          <Link href={`/pipeline/${deal.id}` as never} className="dealmap-card__open">Fiche</Link>
                          {(deal.address || (deal.lat != null && deal.lng != null)) && (
                            <a href={mapsUrl(deal)} target="_blank" rel="noopener noreferrer" className="dealmap-card__maps">
                              Maps
                            </a>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        </div>
      )}
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "hot" }) {
  return (
    <div className={`dealmap-metric${tone ? ` dealmap-metric--${tone}` : ""}`}>
      <div className="dealmap-metric__label">{label}</div>
      <div className="dealmap-metric__value">{value}</div>
    </div>
  );
}
