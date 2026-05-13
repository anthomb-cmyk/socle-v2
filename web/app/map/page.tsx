import { redirect } from "next/navigation";
import Link from "next/link";
import type { CSSProperties } from "react";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DealRow = {
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

function mapsUrl(address: string | null) {
  const q = encodeURIComponent([address, "QC", "Canada"].filter(Boolean).join(", "));
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
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

function stageOrder(stage: string): number {
  return ["prospection", "analyse", "offre", "due_diligence", "financement", "cloture", "abandonne"].indexOf(stage);
}

export default async function MapPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";

  const sb = createSupabaseAdminClient();
  let query = sb
    .from("deals")
    .select("id,title,stage,address,units,asking_price,offer_price,temperature,priority,contact_name,lat,lng,assigned_to,updated_at")
    .not("stage", "in", '("cloture","abandonne")')
    .order("updated_at", { ascending: false })
    .limit(500);

  if (role !== "admin") query = query.eq("assigned_to", user.id);

  const { data } = await query;
  const deals = ((data ?? []) as unknown as DealRow[])
    .sort((a, b) => {
      const stageDiff = stageOrder(a.stage) - stageOrder(b.stage);
      if (stageDiff !== 0) return stageDiff;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

  const withCoords = deals.filter((deal) => deal.lat != null && deal.lng != null);
  const hotDeals = deals.filter((deal) => deal.temperature === "chaud");
  const totalValue = deals.reduce((sum, deal) => sum + (deal.asking_price ?? 0), 0);
  const grouped = new Map<string, DealRow[]>();
  for (const deal of deals) {
    if (!grouped.has(deal.stage)) grouped.set(deal.stage, []);
    grouped.get(deal.stage)!.push(deal);
  }

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
          <section className="dealmap-canvas" aria-label="Aperçu géographique des deals">
            <div className="dealmap-canvas__legend">
              <span><span className="dealmap-dot dealmap-dot--hot" />Chaud</span>
              <span><span className="dealmap-dot dealmap-dot--warm" />Tiède/froid</span>
              <span><span className="dealmap-dot dealmap-dot--missing" />Sans GPS</span>
            </div>
            {deals.map((deal, index) => {
              const hasCoords = deal.lat != null && deal.lng != null;
              const x = hasCoords ? 12 + ((Number(deal.lng) + 80) * 9) % 76 : 10 + (index % 5) * 17;
              const y = hasCoords ? 14 + ((Number(deal.lat) - 44) * 28) % 72 : 82;
              return (
                <Link
                  key={deal.id}
                  href={`/pipeline/${deal.id}` as never}
                  className={`dealmap-pin dealmap-pin--${deal.temperature === "chaud" ? "hot" : hasCoords ? "warm" : "missing"}`}
                  style={{ "--x": `${x}%`, "--y": `${y}%` } as CSSProperties}
                  title={deal.title}
                >
                  <span>{deal.units ?? "—"}</span>
                </Link>
              );
            })}
          </section>

          <section className="dealmap-list" aria-label="Deals par stade">
            {Array.from(grouped.entries()).map(([stage, items]) => (
              <div key={stage} className="dealmap-stage">
                <div className="dealmap-stage__head">
                  <h2>{STAGE_LABELS[stage] ?? stage}</h2>
                  <span>{items.length}</span>
                </div>
                <div className="dealmap-stage__items">
                  {items.map((deal) => (
                    <article key={deal.id} className={`dealmap-card dealmap-card--${deal.temperature}`}>
                      <div className="dealmap-card__main">
                        <Link href={`/pipeline/${deal.id}` as never} className="dealmap-card__title">
                          {deal.title}
                        </Link>
                        <div className="dealmap-card__addr">{deal.address ?? "—"}</div>
                        <div className="dealmap-card__meta">
                          <span>{deal.units != null ? `${deal.units} log.` : "—"}</span>
                          <span>{fmtMoney(deal.asking_price)}</span>
                          <span>{TEMP_LABELS[deal.temperature] ?? deal.temperature}</span>
                          <span>maj {relDate(deal.updated_at)}</span>
                        </div>
                      </div>
                      <div className="dealmap-card__actions">
                        <Link href={`/pipeline/${deal.id}` as never} className="dealmap-card__open">Fiche</Link>
                        {deal.address && (
                          <a href={mapsUrl(deal.address)} target="_blank" rel="noopener noreferrer" className="dealmap-card__maps">
                            Maps
                          </a>
                        )}
                      </div>
                    </article>
                  ))}
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
