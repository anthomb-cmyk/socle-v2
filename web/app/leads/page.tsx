import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import PageHeader from "@/components/page-header";
import Link from "next/link";
import NextStepBanner from "@/components/next-step-banner";
import LeadsViewToggle from "./LeadsViewToggle";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";

  const sb = createSupabaseAdminClient();
  const CALLABLE_STATUSES = ["new", "ready_to_call", "in_outreach", "no_answer", "phone_verified"];

  const params = await searchParams;
  const justEnriched = params["_just_enriched"] === "1";

  // Non-admin roles only see stats for their own assigned leads.
  // Admins see system-wide stats.
  const isCaller = role !== "admin";

  const [totalRes, callableRes, unassignedRes, noPhoneRes, readyRes, reviewRes] = await Promise.all([
    isCaller
      ? sb.from("leads").select("id", { count: "planned", head: true }).eq("assigned_to", user.id)
      : sb.from("leads").select("id", { count: "planned", head: true }),
    isCaller
      ? sb.from("leads").select("id", { count: "planned", head: true }).in("status", CALLABLE_STATUSES).eq("assigned_to", user.id)
      : sb.from("leads").select("id", { count: "planned", head: true }).in("status", CALLABLE_STATUSES),
    // Non assignés only meaningful for admins
    isCaller
      ? Promise.resolve({ count: 0 })
      : sb.from("leads").select("id", { count: "planned", head: true })
          .in("status", CALLABLE_STATUSES)
          .is("assigned_to", null),
    // Sans téléphone = callable leads with no verified phone in leads_view
    isCaller
      ? sb.from("leads_view").select("lead_id", { count: "planned", head: true })
          .in("status", CALLABLE_STATUSES)
          .eq("assigned_to", user.id)
          .is("best_phone", null)
      : sb.from("leads_view").select("lead_id", { count: "planned", head: true })
          .in("status", CALLABLE_STATUSES)
          .is("best_phone", null),
    // For banner: ready_to_call count
    sb.from("leads").select("id", { count: "planned", head: true }).eq("status", "ready_to_call"),
    // For banner: needs_anthony_review count
    sb.from("phone_candidates").select("id", { count: "planned", head: true }).eq("candidate_status", "needs_anthony_review"),
  ]);

  const stats = {
    total:      totalRes.count      ?? 0,
    callable:   callableRes.count   ?? 0,
    unassigned: unassignedRes.count ?? 0,
    noPhone:    noPhoneRes.count    ?? 0,
  };

  const bannerCounts = {
    ready:      readyRes.count  ?? 0,
    review:     reviewRes.count ?? 0,
    hotSellers: 0,
  };

  return (
    <main className="crm-page">
      {justEnriched && (
        <NextStepBanner kind="enrich_done" counts={bannerCounts} />
      )}

      <PageHeader
        title="Leads"
        subtitle={role === "admin" ? "Tous les leads du système." : "Leads qui vous sont assignés."}
      >
        {role === "admin" && (
          <Link href={"/leads/new" as never} className="crm-btn">+ Nouveau lead</Link>
        )}
        {role === "admin" && (
          <Link href="/import" className="crm-btn crm-btn-dark">Import rôle</Link>
        )}
        {role === "admin" && (
          <Link href={"/review" as never} className="crm-btn">Revue</Link>
        )}
        {role !== "admin" && (
          <Link href={"/calls/queue" as never} className="crm-btn crm-btn-dark">File d&rsquo;appels</Link>
        )}
      </PageHeader>

      {/* ── Stats summary bar — each pill links to the screen where the user
           can act on that count (queue, phone-review, etc.). ── */}
      <div className="crm-stat-bar" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="crm-stat-pill">
          <span className="crm-stat-pill-value">{stats.total}</span>
          <span className="crm-stat-pill-label">{isCaller ? "Mes leads" : "Total leads"}</span>
        </div>
        <Link
          href={"/calls/queue" as never}
          className="crm-stat-pill crm-stat-pill--blue"
          style={{ textDecoration: "none" }}
          aria-label={`${stats.callable} leads appelables — ouvrir la file d'appels`}
        >
          <span className="crm-stat-pill-value">{stats.callable}</span>
          <span className="crm-stat-pill-label">Appelables</span>
        </Link>
        {isCaller ? (
          <Link
            href={"/phone-review" as never}
            className={`crm-stat-pill${stats.noPhone > 0 ? " crm-stat-pill--red" : ""}`}
            style={{ textDecoration: "none" }}
            aria-label={`${stats.noPhone} leads sans téléphone — ouvrir la revue téléphonique`}
          >
            <span className="crm-stat-pill-value">{stats.noPhone}</span>
            <span className="crm-stat-pill-label">Sans téléphone</span>
          </Link>
        ) : (
          <Link
            href={"/calls/queue?scope=unassigned" as never}
            className={`crm-stat-pill${stats.unassigned > 0 ? " crm-stat-pill--amber" : ""}`}
            style={{ textDecoration: "none" }}
            aria-label={`${stats.unassigned} leads non assignés — ouvrir la file`}
          >
            <span className="crm-stat-pill-value">{stats.unassigned}</span>
            <span className="crm-stat-pill-label">Non assignés</span>
          </Link>
        )}
        {isCaller ? (
          <Link
            href={"/calls/queue" as never}
            className="crm-stat-pill crm-stat-pill--blue"
            style={{ textDecoration: "none" }}
            aria-label="Leads prêts à appeler — ouvrir la file"
          >
            <span className="crm-stat-pill-value">{stats.callable - stats.noPhone > 0 ? stats.callable - stats.noPhone : 0}</span>
            <span className="crm-stat-pill-label">Prêts à appeler</span>
          </Link>
        ) : (
          <Link
            href={"/phone-review" as never}
            className={`crm-stat-pill${stats.noPhone > 0 ? " crm-stat-pill--red" : ""}`}
            style={{ textDecoration: "none" }}
            aria-label={`${stats.noPhone} leads sans téléphone — ouvrir la revue téléphonique`}
          >
            <span className="crm-stat-pill-value">{stats.noPhone}</span>
            <span className="crm-stat-pill-label">Sans téléphone</span>
          </Link>
        )}
      </div>

      <LeadsViewToggle canEdit={role === "admin"} />
    </main>
  );
}
