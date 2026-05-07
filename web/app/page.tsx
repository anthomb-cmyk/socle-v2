import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { getDict } from "@/lib/i18n";
import KpiTile           from "@/app/components/dashboard/KpiTile";
import UrgencyBanner     from "@/app/components/dashboard/UrgencyBanner";
import RecentImportsCard from "@/app/components/dashboard/RecentImportsCard";
import CallActivityCard  from "@/app/components/dashboard/CallActivityCard";
import UrgentSellersCard from "@/app/components/dashboard/UrgentSellersCard";
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
    recentCalls, urgentItems,
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

  // Sort review items urgency-first
  const urgencyOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const hotItems = [...allItems]
    .sort((a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9))
    .slice(0, 5);

  const t = getDict("fr").dashboard;

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

        {/* ── KPI tiles ── */}
        <div className="dash-kpi-row">
          <KpiTile
            href="/leads?status=new"
            label={t.kpiNewLeads}
            value={c.newLeads}
            caption={t.kpiNewLeadsSub}
          />
          <KpiTile
            href="/phone-review"
            label={t.kpiPhoneReady}
            value={c.phoneReady}
            caption={t.kpiPhoneReadySub}
            variant={c.phoneReady > 0 ? "success" : "neutral"}
          />
          <KpiTile
            href="/leads?assigned=none"
            label={t.kpiUnassigned}
            value={c.unassigned}
            caption={t.kpiUnassignedSub}
            variant={c.unassigned > 0 ? "warn" : "neutral"}
          />
          <KpiTile
            href="/leads"
            label={t.kpiInCalls}
            value={c.leadsToCall}
            caption={t.kpiInCallsSub}
            variant={c.leadsToCall > 0 ? "gold" : "neutral"}
          />
          <KpiTile
            href="/review"
            label={t.kpiUrgentReviews}
            value={c.urgentReviews}
            caption={t.kpiUrgentReviewsSub(c.openReviews)}
            variant={c.urgentReviews > 0 ? "danger" : "neutral"}
          />
          <KpiTile
            href={"/follow-ups" as never}
            label={t.kpiFollowUps}
            value={c.todayFu}
            caption={c.overdueFu > 0 ? t.kpiOverdueSub(c.overdueFu) : t.kpiEnrichSub(c.enriching)}
            captionDanger={c.overdueFu > 0}
            variant={c.overdueFu > 0 ? "warn" : "neutral"}
          />
        </div>

        {/* ── Three-column panels ── */}
        <div className="dash-panels">
          <RecentImportsCard imports={imports} t={t} />
          <CallActivityCard  calls={calls}    t={t} />
          <UrgentSellersCard items={hotItems} t={t} />
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
