import { redirect } from "next/navigation";
import Link from "next/link";
import type { CSSProperties } from "react";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { getDict } from "@/lib/i18n";
import KpiTile           from "@/app/components/dashboard/KpiTile";
import UrgencyBanner     from "@/app/components/dashboard/UrgencyBanner";
import AutomationErrorsCard from "@/app/components/dashboard/AutomationErrorsCard";
import EnrichmentCard    from "@/app/components/dashboard/EnrichmentCard";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh", background: "var(--crm-bg)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "var(--crm-gold)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 22, fontWeight: 900, margin: "0 auto 14px" }}>S</div>
          <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "2px", color: "var(--crm-text)" }}>SOCLE</div>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1.5px", color: "var(--crm-gold)", marginBottom: 28 }}>ACQUISITIONS</div>
          <Link className="crm-btn crm-btn-dark" href="/login">Se connecter</Link>
        </div>
      </main>
    );
  }

  const role = (user.app_metadata?.role ?? "caller") as string;
  // All non-admin roles land directly in their call queue
  if (role !== "admin") redirect("/calls/queue");

  const sb = createSupabaseAdminClient();
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  const dayAgo     = new Date(now); dayAgo.setDate(dayAgo.getDate() - 1);
  const weekAgo    = new Date(now); weekAgo.setDate(weekAgo.getDate() - 6); weekAgo.setHours(0, 0, 0, 0);

  const ENRICHMENT_STATUSES = [
    "needs_enrichment","needs_human_review","brave_queued","unresolved_after_brave",
    "directory_411_queued","unresolved_after_411","places_queued","unresolved_after_places",
    "openclaw_queued","enrichment_pending","enrichment_running",
  ];
  const CALLABLE_STATUSES = ["new","ready_to_call","in_outreach","no_answer","phone_verified"];

  const [
    openReviews, urgentReviews, newLeads,
    phoneReady, unassigned, enriching,
    leadsToCall, overdueFu, todayFu,
    recentImports, recentFailures, latestCampaign,
    recentCalls, urgentItems, urgentHeroItems,
    leadRows7d, phoneRows7d, callRows7d, reviewRows7d, followRows7d,
    allLeads, allPhones, allCallsForFunnel, submissions, meetings, closedDeals,
    hotCityRows,
  ] = await Promise.all([
    sb.from("review_items").select("id", { count: "exact", head: true }).eq("status", "open"),
    sb.from("review_items").select("id", { count: "exact", head: true }).eq("status", "open").eq("urgency", "urgent"),
    sb.from("leads").select("id", { count: "exact", head: true }).eq("status", "new"),
    sb.from("leads_view").select("lead_id", { count: "exact", head: true }).eq("status", "phone_verified"),
    sb.from("leads").select("id", { count: "exact", head: true }).in("status", CALLABLE_STATUSES).is("assigned_to", null),
    sb.from("leads").select("id", { count: "exact", head: true }).in("status", ENRICHMENT_STATUSES),
    sb.from("leads").select("id", { count: "exact", head: true }).in("status", CALLABLE_STATUSES).not("assigned_to", "is", null),
    sb.from("follow_ups").select("id", { count: "exact", head: true }).eq("status", "pending").lt("due_at", todayStart.toISOString()),
    sb.from("follow_ups").select("id", { count: "exact", head: true }).eq("status", "pending").gte("due_at", todayStart.toISOString()).lt("due_at", todayEnd.toISOString()),
    sb.from("import_jobs")
      .select("id,file_name,status,properties_created,leads_created,errors_count,created_at")
      .order("created_at", { ascending: false }).limit(5),
    sb.from("automation_events")
      .select("id,source,event_type,error_message,occurred_at")
      .eq("status", "failed").gte("occurred_at", dayAgo.toISOString())
      .order("occurred_at", { ascending: false }).limit(5),
    sb.from("campaigns").select("id,name,created_at").order("created_at", { ascending: false }).limit(1),
    sb.from("call_logs")
      .select("id,lead_id,outcome,recorded_at,leads_view(full_name,company_name,address)")
      .order("recorded_at", { ascending: false }).limit(6),
    sb.from("review_items")
      .select("id,title,summary,urgency,created_at,lead_id")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(8),
    sb.from("review_items")
      .select("id,title,summary,urgency,created_at,lead_id")
      .eq("status", "open")
      .eq("urgency", "urgent")
      .order("created_at", { ascending: false })
      .limit(3),
    sb.from("leads").select("id, created_at").gte("created_at", weekAgo.toISOString()),
    sb.from("leads_view").select("lead_id, created_at, best_phone").not("best_phone", "is", null).gte("created_at", weekAgo.toISOString()),
    sb.from("call_logs").select("id, lead_id, outcome, recorded_at").gte("recorded_at", weekAgo.toISOString()),
    sb.from("review_items").select("id, created_at, urgency").eq("status", "open").gte("created_at", weekAgo.toISOString()),
    sb.from("follow_ups").select("id, due_at").eq("status", "pending").gte("due_at", weekAgo.toISOString()),
    sb.from("leads").select("id, status"),
    sb.from("leads_view").select("lead_id, best_phone").not("best_phone", "is", null),
    sb.from("call_logs").select("lead_id, outcome").not("lead_id", "is", null).limit(10000),
    sb.from("lead_submissions").select("id, lead_id, outcome, seller_interest_level, status").limit(10000),
    sb.from("leads").select("id", { count: "exact", head: true }).eq("status", "meeting_set"),
    sb.from("deals").select("id", { count: "exact", head: true }).eq("stage", "cloture"),
    sb.from("leads_view")
      .select("lead_id, city, priority")
      .gte("priority", 80)
      .order("priority", { ascending: false })
      .limit(80),
  ]);

  const c = {
    openReviews:   openReviews.count   ?? 0,
    urgentReviews: urgentReviews.count ?? 0,
    newLeads:      newLeads.count      ?? 0,
    phoneReady:    phoneReady.count    ?? 0,
    unassigned:    unassigned.count    ?? 0,
    enriching:     enriching.count     ?? 0,
    leadsToCall:   leadsToCall.count   ?? 0,
    overdueFu:     overdueFu.count     ?? 0,
    todayFu:       todayFu.count       ?? 0,
  };

  const hasUrgent = c.urgentReviews > 0 || c.overdueFu > 0;
  const campaign = ((latestCampaign.data ?? []) as Array<{ id: string; name: string }>)[0];

  type ImportJob = {
    id: string; file_name: string; status: string;
    properties_created: number; leads_created: number; errors_count: number; created_at: string;
  };
  type AutoEvent = {
    id: string; source: string; event_type: string;
    error_message: string | null; occurred_at: string;
  };
  type CallLog = {
    id: string; lead_id: string | null; outcome: string | null; recorded_at: string;
    leads_view: { full_name: string | null; company_name: string | null; address: string } | null;
  };
  type ReviewItem = {
    id: string; title: string; summary: string | null;
    urgency: string; created_at: string; lead_id: string | null;
  };

  const imports  = (recentImports.data  ?? []) as ImportJob[];
  const failures = (recentFailures.data ?? []) as AutoEvent[];
  const calls    = (recentCalls.data    ?? []) as unknown as CallLog[];
  const allItems = (urgentItems.data    ?? []) as ReviewItem[];
  const heroItems = (urgentHeroItems.data ?? []) as ReviewItem[];

  const t = getDict("fr").dashboard;
  const spark = {
    newLeads: dailyCounts((leadRows7d.data ?? []) as Array<{ created_at: string }>, "created_at", now),
    phoneReady: dailyCounts((phoneRows7d.data ?? []) as Array<{ created_at: string }>, "created_at", now),
    calls: dailyCounts((callRows7d.data ?? []) as Array<{ recorded_at: string }>, "recorded_at", now),
    reviews: dailyCounts((reviewRows7d.data ?? []) as Array<{ created_at: string }>, "created_at", now),
    followUps: dailyCounts((followRows7d.data ?? []) as Array<{ due_at: string }>, "due_at", now),
  };
  const funnel = buildFunnel({
    leads: (allLeads.data ?? []) as Array<{ id: string; status: string }>,
    phones: (allPhones.data ?? []) as Array<{ lead_id: string }>,
    calls: (allCallsForFunnel.data ?? []) as Array<{ lead_id: string | null; outcome: string | null }>,
    submissions: (submissions.data ?? []) as Array<{ lead_id: string; outcome: string; seller_interest_level: string | null }>,
    meetings: meetings.count ?? 0,
    closed: closedDeals.count ?? 0,
  });
  const activity = buildActivity({
    imports,
    calls,
    reviewItems: allItems,
    failures,
  });
  const cityDots = buildCityDots((hotCityRows.data ?? []) as Array<{ city: string | null; priority: number | null }>);

  return (
    <main className="dash-page">
      <div className="dash-content">

        {/* ── Page header ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: hasUrgent ? 16 : 20, flexWrap: "wrap" }}>
          <div>
            <h1 className="dash-page-title">{t.title}</h1>
            <p style={{ fontSize: 13, color: "var(--so-fg-4)", marginTop: 3, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {t.sub}
              {campaign && (
                <span className="dash-campaign-pill">
                  {t.activeCampaign}&nbsp;: <strong>{campaign.name}</strong>
                </span>
              )}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Link href="/import"      className="so-btn so-btn-primary">{t.btnImport}</Link>
            <Link href="/leads"       className="so-btn so-btn-outline">{t.btnLeads}</Link>
            <Link href="/calls/queue" className="so-btn so-btn-outline">{t.btnQueue}</Link>
            <Link href="/review"      className="so-btn so-btn-outline">{t.btnReview}</Link>
          </div>
        </div>

        {/* ── Urgency banner ── */}
        {hasUrgent && (
          <UrgencyBanner
            urgentReviews={c.urgentReviews}
            overdueFu={c.overdueFu}
            t={t}
          />
        )}

        <section className="dash-decision-hero">
          <div className="dash-decision-hero__head">
            <div>
              <div className="dash-decision-hero__eyebrow">Décisions à prendre</div>
              <h2 className="dash-decision-hero__t">Hot sellers prioritaires</h2>
            </div>
            <Link href="/review" className="dash-decision-hero__link">Ouvrir la revue</Link>
          </div>
          <div className="dash-decision-hero__grid">
            {heroItems.length === 0 ? (
              <div className="dash-decision-empty">—</div>
            ) : heroItems.map((item) => (
              <Link key={item.id} href="/review" className="dash-decision-card">
                <span className="pill pill--hot"><span className="pill__dot" />Urgent</span>
                <span className="dash-decision-card__t">{item.title}</span>
                <span className="dash-decision-card__sub">{item.summary ?? "—"}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── KPI tiles ── */}
        <div className="dash-kpi-row">
          <KpiTile
            href="/leads?status=new"
            label={t.kpiNewLeads}
            value={c.newLeads}
            caption={t.kpiNewLeadsSub}
            sparkline={spark.newLeads}
          />
          <KpiTile
            href="/phone-review"
            label={t.kpiPhoneReady}
            value={c.phoneReady}
            caption={t.kpiPhoneReadySub}
            variant={c.phoneReady > 0 ? "success" : "neutral"}
            sparkline={spark.phoneReady}
          />
          <KpiTile
            href="/leads?assigned=none"
            label={t.kpiUnassigned}
            value={c.unassigned}
            caption={t.kpiUnassignedSub}
            variant={c.unassigned > 0 ? "warn" : "neutral"}
            sparkline={spark.newLeads}
          />
          <KpiTile
            href="/leads"
            label={t.kpiInCalls}
            value={c.leadsToCall}
            caption={t.kpiInCallsSub}
            variant={c.leadsToCall > 0 ? "gold" : "neutral"}
            sparkline={spark.calls}
          />
          <KpiTile
            href="/review"
            label={t.kpiUrgentReviews}
            value={c.urgentReviews}
            caption={t.kpiUrgentReviewsSub(c.openReviews)}
            variant={c.urgentReviews > 0 ? "danger" : "neutral"}
            sparkline={spark.reviews}
          />
          <KpiTile
            href={"/follow-ups" as never}
            label={t.kpiFollowUps}
            value={c.todayFu}
            caption={c.overdueFu > 0 ? t.kpiOverdueSub(c.overdueFu) : t.kpiEnrichSub(c.enriching)}
            captionDanger={c.overdueFu > 0}
            variant={c.overdueFu > 0 ? "warn" : "neutral"}
            sparkline={spark.followUps}
          />
        </div>

        <div className="dash-operating-grid">
          <FunnelPanel steps={funnel} />
          <UnifiedActivity items={activity} />
          <HotLeadMap cities={cityDots} />
        </div>

        {/* ── Bottom row ── */}
        <div className="dash-bottom">
          <AutomationErrorsCard failures={failures}  t={t} />
          <EnrichmentCard       enriching={c.enriching} phoneReady={c.phoneReady} t={t} />
        </div>

      </div>
    </main>
  );
}

type FunnelStep = { label: string; value: number };
type ActivityItem = { id: string; label: string; detail: string; at: string; tone: "gold" | "green" | "red" | "neutral" };
type CityDot = { city: string; count: number; intensity: number };

function dailyCounts<T extends Record<string, string>>(rows: T[], key: keyof T, now: Date) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (6 - index));
    return date.toISOString().slice(0, 10);
  });
  return days.map((day) => rows.filter((row) => row[key]?.slice(0, 10) === day).length);
}

function buildFunnel(input: {
  leads: Array<{ id: string; status: string }>;
  phones: Array<{ lead_id: string }>;
  calls: Array<{ lead_id: string | null; outcome: string | null }>;
  submissions: Array<{ lead_id: string; outcome: string; seller_interest_level: string | null }>;
  meetings: number;
  closed: number;
}): FunnelStep[] {
  const called = new Set(input.calls.map((call) => call.lead_id).filter(Boolean));
  const reachedOutcomes = new Set(["answered", "callback", "open_to_selling", "wants_offer", "hot_seller"]);
  const reached = new Set(input.calls.filter((call) => call.lead_id && reachedOutcomes.has(call.outcome ?? "")).map((call) => call.lead_id as string));
  const hot = new Set(input.submissions
    .filter((item) => item.outcome === "hot_seller" || item.seller_interest_level === "hot" || item.seller_interest_level === "wants_offer")
    .map((item) => item.lead_id));
  return [
    { label: "Leads", value: input.leads.length },
    { label: "Tél trouvé", value: input.phones.length },
    { label: "Appelés", value: called.size },
    { label: "Joints", value: reached.size },
    { label: "Hot sellers", value: hot.size },
    { label: "RDV", value: input.meetings },
    { label: "Fermés", value: input.closed },
  ];
}

function buildActivity(input: {
  imports: Array<{ id: string; file_name: string; created_at: string; leads_created: number }>;
  calls: Array<{ id: string; outcome: string | null; recorded_at: string; leads_view: { full_name: string | null; company_name: string | null } | null }>;
  reviewItems: Array<{ id: string; title: string; created_at: string; urgency: string }>;
  failures: Array<{ id: string; source: string; event_type: string; occurred_at: string }>;
}): ActivityItem[] {
  return [
    ...input.imports.map((item) => ({ id: `import-${item.id}`, label: "Import", detail: `${item.file_name} · ${item.leads_created} leads`, at: item.created_at, tone: "gold" as const })),
    ...input.calls.map((item) => ({ id: `call-${item.id}`, label: "Appel", detail: `${item.leads_view?.full_name ?? item.leads_view?.company_name ?? "—"} · ${item.outcome ?? "—"}`, at: item.recorded_at, tone: "green" as const })),
    ...input.reviewItems.map((item) => ({ id: `review-${item.id}`, label: "Revue", detail: item.title, at: item.created_at, tone: item.urgency === "urgent" ? "red" as const : "neutral" as const })),
    ...input.failures.map((item) => ({ id: `failure-${item.id}`, label: "Erreur", detail: `${item.source} · ${item.event_type}`, at: item.occurred_at, tone: "red" as const })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 10);
}

function buildCityDots(rows: Array<{ city: string | null; priority: number | null }>): CityDot[] {
  const counts = new Map<string, { count: number; priority: number }>();
  for (const row of rows) {
    const city = row.city ?? "—";
    const current = counts.get(city) ?? { count: 0, priority: 0 };
    counts.set(city, { count: current.count + 1, priority: Math.max(current.priority, row.priority ?? 0) });
  }
  return [...counts.entries()]
    .map(([city, value]) => ({ city, count: value.count, intensity: value.priority }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

function FunnelPanel({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(...steps.map((step) => step.value), 1);
  return (
    <section className="dash-op-card">
      <div className="dash-op-card__head">
        <span className="so-eyebrow">Entonnoir d&apos;acquisition</span>
      </div>
      <div className="dash-funnel">
        {steps.map((step) => (
          <div key={step.label} className="dash-funnel__row">
            <div className="dash-funnel__meta">
              <span>{step.label}</span>
              <strong>{step.value.toLocaleString("fr-CA")}</strong>
            </div>
            <div className="dash-funnel__bar">
              <span style={{ width: `${Math.max(4, (step.value / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function UnifiedActivity({ items }: { items: ActivityItem[] }) {
  return (
    <section className="dash-op-card">
      <div className="dash-op-card__head">
        <span className="so-eyebrow">Activité chronologique</span>
      </div>
      {items.length === 0 ? <div className="dash-decision-empty">—</div> : (
        <ol className="dash-activity">
          {items.map((item) => (
            <li key={item.id} className="dash-activity__item">
              <span className={`dash-activity__dot dash-activity__dot--${item.tone}`} />
              <div>
                <div className="dash-activity__label">{item.label}</div>
                <div className="dash-activity__detail">{item.detail}</div>
              </div>
              <time>{formatShortDate(item.at)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function HotLeadMap({ cities }: { cities: CityDot[] }) {
  return (
    <section className="dash-op-card">
      <div className="dash-op-card__head">
        <span className="so-eyebrow">Carte des leads chauds</span>
      </div>
      {cities.length === 0 ? <div className="dash-decision-empty">—</div> : (
        <div className="dash-hot-map">
          {cities.map((city, index) => (
            <div key={city.city} className="dash-hot-map__dot" style={{ "--x": `${12 + (index * 23) % 76}%`, "--y": `${18 + (index * 31) % 64}%`, "--s": `${Math.min(34, 14 + city.count * 4)}px` } as CSSProperties}>
              <span>{city.count}</span>
              <em>{city.city}</em>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleString("fr-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
