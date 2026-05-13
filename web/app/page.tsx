import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import KpiTile           from "@/app/components/dashboard/KpiTile";

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
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

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
    allLeadsCount, allPhonesCount, allCallsCount, reachedCallsCount, hotSubmissionsCount, meetings, closedDeals,
    dashboardDeals, userMeta, costRowsMonth, costRows7d, monthHotSubmissions,
    teamUsers, teamCallRows, teamSubmissionRows,
  ] = await Promise.all([
    sb.from("review_items").select("id", { count: "planned", head: true }).eq("status", "open"),
    sb.from("review_items").select("id", { count: "planned", head: true }).eq("status", "open").eq("urgency", "urgent"),
    sb.from("leads").select("id", { count: "planned", head: true }).eq("status", "new"),
    sb.from("leads_view").select("lead_id", { count: "planned", head: true }).eq("status", "phone_verified"),
    sb.from("leads").select("id", { count: "planned", head: true }).in("status", CALLABLE_STATUSES).is("assigned_to", null),
    sb.from("leads").select("id", { count: "planned", head: true }).in("status", ENRICHMENT_STATUSES),
    sb.from("leads").select("id", { count: "planned", head: true }).in("status", CALLABLE_STATUSES).not("assigned_to", "is", null),
    sb.from("follow_ups").select("id", { count: "planned", head: true }).eq("status", "pending").lt("due_at", todayStart.toISOString()),
    sb.from("follow_ups").select("id", { count: "planned", head: true }).eq("status", "pending").gte("due_at", todayStart.toISOString()).lt("due_at", todayEnd.toISOString()),
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
    sb.from("leads").select("id", { count: "planned", head: true }),
    sb.from("leads_view").select("lead_id", { count: "planned", head: true }).not("best_phone", "is", null),
    sb.from("call_logs").select("id", { count: "planned", head: true }).not("lead_id", "is", null),
    sb.from("call_logs")
      .select("id", { count: "planned", head: true })
      .not("lead_id", "is", null)
      .in("outcome", ["answered", "callback", "open_to_selling", "wants_offer", "hot_seller"]),
    sb.from("lead_submissions")
      .select("id", { count: "planned", head: true })
      .or("outcome.eq.hot_seller,seller_interest_level.in.(hot,wants_offer)"),
    sb.from("leads").select("id", { count: "planned", head: true }).eq("status", "meeting_set"),
    sb.from("deals").select("id", { count: "planned", head: true }).eq("stage", "cloture"),
    sb.from("deals")
      .select("id,title,stage,address,units,asking_price,temperature,updated_at")
      .not("stage", "in", '("cloture","abandonne")')
      .order("updated_at", { ascending: false })
      .limit(80),
    sb.from("users_meta")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle(),
    sb.from("llm_usage_log")
      .select("created_at,cost_usd")
      .gte("created_at", monthStart.toISOString()),
    sb.from("llm_usage_log")
      .select("created_at,cost_usd")
      .gte("created_at", weekAgo.toISOString()),
    sb.from("lead_submissions")
      .select("id,created_at")
      .or("outcome.eq.hot_seller,seller_interest_level.in.(hot,wants_offer)")
      .gte("created_at", monthStart.toISOString()),
    sb.from("users_meta")
      .select("user_id,display_name,role")
      .in("role", ["caller", "cold_caller", "admin"]),
    sb.from("call_logs")
      .select("id,user_id,outcome,recorded_at")
      .gte("recorded_at", weekAgo.toISOString())
      .not("user_id", "is", null)
      .limit(2500),
    sb.from("lead_submissions")
      .select("id,submitted_by,seller_interest_level,outcome,created_at")
      .or("outcome.eq.hot_seller,seller_interest_level.in.(hot,wants_offer)")
      .gte("created_at", weekAgo.toISOString())
      .limit(1000),
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
  type UsageRow = { created_at: string; cost_usd: number | string | null };
  type TeamUser = { user_id: string; display_name: string | null; role: string | null };
  type TeamCall = { id: string; user_id: string | null; outcome: string | null; recorded_at: string };
  type TeamSubmission = { id: string; submitted_by: string | null; seller_interest_level: string | null; outcome: string | null; created_at: string };
  type DashboardDeal = {
    id: string;
    title: string;
    stage: string;
    address: string | null;
    units: number | null;
    asking_price: number | null;
    temperature: string | null;
    updated_at: string;
  };

  const imports  = (recentImports.data  ?? []) as ImportJob[];
  const failures = (recentFailures.data ?? []) as AutoEvent[];
  const calls    = (recentCalls.data    ?? []) as unknown as CallLog[];
  const allItems = (urgentItems.data    ?? []) as ReviewItem[];
  const heroItems = (urgentHeroItems.data ?? []) as ReviewItem[];

  const displayName = firstName((userMeta.data?.display_name as string | null | undefined) ?? user.user_metadata?.display_name as string | undefined ?? user.email ?? "Anthony");
  const monthHotRows = (monthHotSubmissions.data ?? []) as Array<{ id: string; created_at: string }>;
  const costMonthRows = (costRowsMonth.data ?? []) as UsageRow[];
  const costWeekRows = (costRows7d.data ?? []) as UsageRow[];
  const monthApiCost = costMonthRows.reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0);
  const readyToCall = c.phoneReady || c.leadsToCall;
  const spark = {
    newLeads: dailyCounts((leadRows7d.data ?? []) as Array<{ created_at: string }>, "created_at", now),
    phoneReady: dailyCounts((phoneRows7d.data ?? []) as Array<{ created_at: string }>, "created_at", now),
    calls: dailyCounts((callRows7d.data ?? []) as Array<{ recorded_at: string }>, "recorded_at", now),
    reviews: dailyCounts((reviewRows7d.data ?? []) as Array<{ created_at: string }>, "created_at", now),
    followUps: dailyCounts((followRows7d.data ?? []) as Array<{ due_at: string }>, "due_at", now),
    hotMonth: dailyCounts(monthHotRows, "created_at", now),
    cost: dailyCostCounts(costWeekRows, now),
  };
  const funnel = buildFunnel({
    leads: allLeadsCount.count ?? 0,
    phones: allPhonesCount.count ?? 0,
    calls: allCallsCount.count ?? 0,
    reached: reachedCallsCount.count ?? 0,
    hot: hotSubmissionsCount.count ?? 0,
    meetings: meetings.count ?? 0,
    closed: closedDeals.count ?? 0,
  });
  const activity = buildActivity({
    imports,
    calls,
    reviewItems: allItems,
    failures,
  });
  const geoSummary = buildGeoSummary((dashboardDeals.data ?? []) as DashboardDeal[]);
  const team = buildTeamRows({
    users: (teamUsers.data ?? []) as TeamUser[],
    calls: (teamCallRows.data ?? []) as TeamCall[],
    submissions: (teamSubmissionRows.data ?? []) as TeamSubmission[],
    currentUserId: user.id,
  });
  const pageDate = now.toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <main className="dash-page">
      <div className="dash-content">

        {/* ── Page header ── */}
        <div className="dash-main-head">
          <div>
            <div className="dash-main-head__crumb">{capitalize(pageDate)}</div>
            <h1 className="dash-main-head__title">Bonjour, {displayName}</h1>
            <p className="dash-main-head__sub">
              {heroItems.length} décisions prioritaires · {c.openReviews} hot sellers en attente · {readyToCall.toLocaleString("fr-CA")} leads prêts.
              {campaign ? <span className="dash-campaign-pill">Campagne active&nbsp;: <strong>{campaign.name}</strong></span> : null}
            </p>
          </div>
          <div className="dash-main-head__act">
            <Link href="/admin/users" className="btn">
              <Icon name="telegram" /> Telegram
            </Link>
            <Link href="/pipeline" className="btn btn--gold">
              <Icon name="plus" /> Nouveau deal
            </Link>
          </div>
        </div>

        <section className="dash-decision-hero">
          <div className="dash-decision-hero__head">
            <div>
              <div className="dash-decision-hero__eyebrow">Aujourd&apos;hui · décisions</div>
              <h2 className="dash-decision-hero__t">{heroHeadline(heroItems.length)}</h2>
            </div>
            <Link href="/review" className="dash-decision-hero__link">Ouvrir la revue</Link>
          </div>
          <div className="dash-decision-hero__grid">
            {heroItems.length === 0 ? (
              <div className="dash-decision-empty">—</div>
            ) : heroItems.map((item) => (
              <Link key={item.id} href="/review" className="dash-decision-card">
                <span className="dash-decision-card__h"><Icon name="flame" /> Hot · {formatRelative(item.created_at)}</span>
                <span className="dash-decision-card__t">{item.title}</span>
                <span className="dash-decision-card__sub">{item.summary ?? "—"}</span>
                <span className="dash-decision-card__a">Approuver <Icon name="arrow" /></span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── KPI tiles ── */}
        <div className="dash-kpi-row">
          <KpiTile
            href="/calls/queue"
            label="Appels · 7 j"
            value={(callRows7d.data ?? []).length}
            delta={formatDelta(spark.calls)}
            sparkline={spark.calls}
          />
          <KpiTile
            href="/review"
            label="Hot sellers · mois"
            value={monthHotRows.length}
            delta={formatDelta(spark.hotMonth, { signedNumber: true })}
            sparkline={spark.hotMonth}
          />
          <KpiTile
            href="/calls/queue"
            label="Prêts à appeler"
            value={readyToCall}
            delta={formatDelta(spark.phoneReady, { signedNumber: true })}
            sparkline={spark.phoneReady}
          />
          <KpiTile
            href="/admin/costs"
            label="Coût API · mois"
            value={formatMoney(monthApiCost)}
            unit="/ $250"
            delta={formatDelta(spark.cost)}
            variant="danger"
            sparkline={spark.cost}
            sparkTone="red"
          />
        </div>

        <div className="dash-grid">
          <div className="dash-stack">
            <FunnelPanel steps={funnel} />
            <TeamPanel rows={team} />
          </div>
          <div className="dash-stack">
            <PipelineGeoPanel geo={geoSummary} />
            <UnifiedActivity items={activity} />
          </div>
        </div>

      </div>
    </main>
  );
}

type FunnelStep = { label: string; value: number };
type ActivityItem = { id: string; label: string; detail: string; at: string; tone: "gold" | "green" | "red" | "neutral" };
type TeamRow = { id: string; initials: string; name: string; role: string; calls: number; reached: number; hot: number; self: boolean };
type GeoDeal = {
  id: string;
  title: string;
  stage: string;
  address: string | null;
  units: number | null;
  asking_price: number | null;
  temperature: string | null;
  updated_at: string;
};
type GeoCity = { city: string; count: number; value: number; hot: number };
type GeoSummary = { total: number; addressed: number; totalValue: number; cities: GeoCity[]; deals: GeoDeal[] };

function dailyCounts<T extends Record<string, string>>(rows: T[], key: keyof T, now: Date) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (6 - index));
    return date.toISOString().slice(0, 10);
  });
  return days.map((day) => rows.filter((row) => row[key]?.slice(0, 10) === day).length);
}

function dailyCostCounts(rows: Array<{ created_at: string; cost_usd: number | string | null }>, now: Date) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (6 - index));
    return date.toISOString().slice(0, 10);
  });
  return days.map((day) => rows
    .filter((row) => row.created_at?.slice(0, 10) === day)
    .reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0));
}

function buildFunnel(input: {
  leads: number;
  phones: number;
  calls: number;
  reached: number;
  hot: number;
  meetings: number;
  closed: number;
}): FunnelStep[] {
  return [
    { label: "Leads", value: input.leads },
    { label: "Tél trouvé", value: input.phones },
    { label: "Appelés", value: input.calls },
    { label: "Joints", value: input.reached },
    { label: "Hot sellers", value: input.hot },
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

function buildTeamRows(input: {
  users: Array<{ user_id: string; display_name: string | null; role: string | null }>;
  calls: Array<{ id: string; user_id: string | null; outcome: string | null }>;
  submissions: Array<{ id: string; submitted_by: string | null; seller_interest_level: string | null; outcome: string | null }>;
  currentUserId: string;
}): TeamRow[] {
  const reachedOutcomes = new Set(["answered", "callback", "open_to_selling", "wants_offer", "hot_seller"]);
  const byUser = new Map<string, TeamRow>();
  for (const userRow of input.users) {
    byUser.set(userRow.user_id, {
      id: userRow.user_id,
      initials: initials(userRow.display_name ?? "—"),
      name: userRow.display_name ?? "—",
      role: userRow.user_id === input.currentUserId ? "Admin · RDV / négo" : roleLabel(userRow.role),
      calls: 0,
      reached: 0,
      hot: 0,
      self: userRow.user_id === input.currentUserId,
    });
  }
  for (const call of input.calls) {
    if (!call.user_id) continue;
    const row = byUser.get(call.user_id);
    if (!row) continue;
    row.calls += 1;
    if (reachedOutcomes.has(call.outcome ?? "")) row.reached += 1;
  }
  for (const submission of input.submissions) {
    if (!submission.submitted_by) continue;
    const row = byUser.get(submission.submitted_by);
    if (!row) continue;
    row.hot += 1;
  }
  return [...byUser.values()]
    .filter((row) => row.calls > 0 || row.hot > 0 || row.self)
    .sort((a, b) => (b.hot - a.hot) || (b.calls - a.calls))
    .slice(0, 4);
}

function buildGeoSummary(deals: GeoDeal[]): GeoSummary {
  const active = deals.filter((deal) => deal.stage !== "cloture" && deal.stage !== "abandonne");
  const cityMap = new Map<string, GeoCity>();
  for (const deal of active) {
    if (!deal.address) continue;
    const city = extractCity(deal.address);
    const row = cityMap.get(city) ?? { city, count: 0, value: 0, hot: 0 };
    row.count += 1;
    row.value += deal.asking_price ?? 0;
    if (deal.temperature === "chaud") row.hot += 1;
    cityMap.set(city, row);
  }

  return {
    total: active.length,
    addressed: active.filter((deal) => Boolean(deal.address)).length,
    totalValue: active.reduce((sum, deal) => sum + (deal.asking_price ?? 0), 0),
    cities: [...cityMap.values()]
      .sort((a, b) => (b.value - a.value) || (b.count - a.count))
      .slice(0, 4),
    deals: active
      .filter((deal) => Boolean(deal.address))
      .sort((a, b) => {
        const hotDiff = Number(b.temperature === "chaud") - Number(a.temperature === "chaud");
        if (hotDiff !== 0) return hotDiff;
        return (b.asking_price ?? 0) - (a.asking_price ?? 0);
      })
      .slice(0, 3),
  };
}

function extractCity(address: string): string {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2].replace(/\s+Québec$/i, "");
  return parts[0] ?? "—";
}

function FunnelPanel({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(...steps.map((step) => step.value), 1);
  return (
    <section className="dash-ref-card">
      <div className="dash-ref-card__h">
        <div className="dash-ref-card__t">Entonnoir d&apos;acquisition</div>
        <div className="dash-filter-group" aria-label="Période">
          <span className="filter filter--active">30 j</span>
          <span className="filter">90 j</span>
          <span className="filter">Année</span>
        </div>
      </div>
      <div className="dash-funnel">
        {steps.map((step, index) => {
          const pct = max > 0 ? (step.value / max) * 100 : 0;
          return (
            <div key={step.label} className={`dash-funnel__row${index >= 4 && index < 6 ? " dash-funnel__row--gold" : ""}${index === 6 ? " dash-funnel__row--green" : ""}`}>
              <span className="dash-funnel__l">{step.label}</span>
              <div className="dash-funnel__bar">
                <div className="dash-funnel__fill" style={{ width: `${Math.max(3, pct)}%` }}>{step.value.toLocaleString("fr-CA")}</div>
              </div>
              <span className="dash-funnel__v">{formatPercent(pct)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function UnifiedActivity({ items }: { items: ActivityItem[] }) {
  return (
    <section className="dash-ref-card">
      <div className="dash-ref-card__h">
        <div className="dash-ref-card__t">Flux d&apos;événements</div>
        <Link href="/admin/events" className="dash-ref-card__link">Journal <Icon name="arrow" /></Link>
      </div>
      {items.length === 0 ? <div className="dash-decision-empty">—</div> : (
        <ol className="dash-act-list">
          {items.map((item) => (
            <li key={item.id} className="dash-act">
              <span className={`dash-act__icon dash-act__icon--${item.tone}`}><Icon name={item.tone === "green" ? "phone" : item.tone === "red" ? "flame" : item.tone === "gold" ? "import" : "bolt"} /></span>
              <div className="dash-act__body">
                <div className="dash-act__t">{item.label}</div>
                <div className="dash-act__sub">{item.detail}</div>
              </div>
              <time className="dash-act__time">{formatRelative(item.at)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PipelineGeoPanel({ geo }: { geo: GeoSummary }) {
  return (
    <section className="dash-ref-card">
      <div className="dash-ref-card__h">
        <div className="dash-ref-card__t">Géographie · pipeline</div>
        <Link href="/map" className="dash-ref-card__link">Carte complète <Icon name="arrow" /></Link>
      </div>
      {geo.total === 0 ? <div className="dash-decision-empty">—</div> : (
        <div className="dash-geo-panel">
          <div className="dash-geo-panel__stats">
            <div>
              <span>Deals actifs</span>
              <strong>{geo.total}</strong>
            </div>
            <div>
              <span>Avec adresse</span>
              <strong>{geo.addressed}/{geo.total}</strong>
            </div>
            <div>
              <span>Valeur</span>
              <strong>{formatMoney(geo.totalValue)}</strong>
            </div>
          </div>

          <div className="dash-geo-panel__cities">
            {geo.cities.length === 0 ? (
              <div className="dash-geo-panel__empty">Aucune adresse renseignée</div>
            ) : geo.cities.map((city) => (
              <div key={city.city} className="dash-geo-city">
                <div>
                  <strong>{city.city}</strong>
                  <span>{city.count} deal{city.count > 1 ? "s" : ""}{city.hot > 0 ? ` · ${city.hot} chaud${city.hot > 1 ? "s" : ""}` : ""}</span>
                </div>
                <em>{formatMoney(city.value)}</em>
              </div>
            ))}
          </div>

          <div className="dash-geo-panel__deals">
            {geo.deals.map((deal) => (
              <Link key={deal.id} href={`/pipeline/${deal.id}` as never} className="dash-geo-deal">
                <span className={`dash-geo-deal__dot dash-geo-deal__dot--${deal.temperature === "chaud" ? "hot" : "warm"}`} />
                <span>
                  <strong>{deal.title}</strong>
                  <small>{deal.address ?? "—"}</small>
                </span>
                <em>{deal.units != null ? `${deal.units} log.` : "—"}</em>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function TeamPanel({ rows }: { rows: TeamRow[] }) {
  return (
    <section className="dash-ref-card">
      <div className="dash-ref-card__h">
        <div className="dash-ref-card__t">Équipe · cette semaine</div>
        <Link href="/admin/users" className="dash-ref-card__link">Détails <Icon name="arrow" /></Link>
      </div>
      {rows.length === 0 ? <div className="dash-decision-empty">—</div> : (
        <div>
          {rows.map((row) => (
            <div key={row.id} className="dash-caller-row">
              <div className={`avatar dash-caller-row__a${row.self ? " dash-caller-row__a--self" : ""}`}>{row.initials}</div>
              <div>
                <div className="dash-caller-row__n">{row.name}{row.self ? " (vous)" : ""}</div>
                <div className="dash-caller-row__sub">{row.role}</div>
              </div>
              <div className="dash-caller-row__stats">
                <div><div className="dash-caller-row__stats__l">Appels</div><div className="dash-caller-row__stats__v">{row.calls}</div></div>
                <div><div className="dash-caller-row__stats__l">Joints</div><div className="dash-caller-row__stats__v">{row.reached}</div></div>
                <div><div className="dash-caller-row__stats__l">Hot</div><div className="dash-caller-row__stats__v dash-caller-row__stats__v--hot">{row.hot}</div></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Icon({ name }: { name: "telegram" | "plus" | "flame" | "arrow" | "phone" | "import" | "bolt" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg className="i--sm" viewBox="0 0 24 24" aria-hidden="true">
      {name === "telegram" ? <><path {...common} d="M21.5 4.5 3.5 11.8c-.9.36-.86 1.65.06 1.94l4.7 1.48 1.78 4.42c.35.88 1.55.99 2.05.18l2.44-3.93 4.66 3.42c.76.56 1.84.14 2.02-.78L23 5.63c.15-.82-.73-1.45-1.5-1.13Z" /><path {...common} d="m8.3 15.2 6.46-5.35" /></> : null}
      {name === "plus" ? <><path {...common} d="M12 5v14" /><path {...common} d="M5 12h14" /></> : null}
      {name === "flame" ? <path {...common} d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z" /> : null}
      {name === "arrow" ? <><path {...common} d="M5 12h14" /><path {...common} d="m13 6 6 6-6 6" /></> : null}
      {name === "phone" ? <path {...common} d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" /> : null}
      {name === "import" ? <><path {...common} d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path {...common} d="m7 10 5 5 5-5" /><path {...common} d="M12 15V3" /></> : null}
      {name === "bolt" ? <path {...common} d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" /> : null}
    </svg>
  );
}

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "Anthony";
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "—";
}

function roleLabel(role: string | null) {
  if (role === "admin") return "Admin";
  if (role === "cold_caller" || role === "caller") return "Caller";
  return role ?? "—";
}

function heroHeadline(count: number) {
  if (count <= 0) return "Aucune décision urgente en attente.";
  if (count === 1) return <>Un <span>vendeur chaud</span> attend votre approbation.</>;
  if (count === 2) return <>Deux <span>vendeurs chauds</span> attendent votre approbation.</>;
  return <>Trois <span>vendeurs chauds</span> attendent votre approbation.</>;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number) {
  if (value < 1 && value > 0) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
}

function formatDelta(values: number[], options?: { signedNumber?: boolean }) {
  const last = values.at(-1) ?? 0;
  const prev = values.at(-2) ?? 0;
  const diff = last - prev;
  if (options?.signedNumber) return `${diff >= 0 ? "+" : ""}${diff}`;
  if (prev === 0) return last > 0 ? "+100%" : "0%";
  const pct = Math.round((diff / prev) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function formatRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "hier";
  return `${days} j`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
