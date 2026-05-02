import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import LeadsTable from "@/components/leads-table";
import PageHeader from "@/components/page-header";
import Link from "next/link";

export default async function LeadsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";

  const sb = createSupabaseAdminClient();
  const CALLABLE_STATUSES = ["new", "ready_to_call", "in_outreach", "no_answer", "phone_verified"];

  const [totalRes, callableRes, unassignedRes, noPhoneRes] = await Promise.all([
    sb.from("leads").select("id", { count: "exact", head: true }),
    sb.from("leads").select("id", { count: "exact", head: true }).in("status", CALLABLE_STATUSES),
    sb.from("leads").select("id", { count: "exact", head: true })
      .in("status", CALLABLE_STATUSES)
      .is("assigned_to", null),
    // Sans téléphone = callable leads with no verified phone in leads_view
    sb.from("leads_view").select("lead_id", { count: "exact", head: true })
      .in("status", CALLABLE_STATUSES)
      .is("best_phone", null),
  ]);

  const stats = {
    total:      totalRes.count      ?? 0,
    callable:   callableRes.count   ?? 0,
    unassigned: unassignedRes.count ?? 0,
    noPhone:    noPhoneRes.count    ?? 0,
  };

  return (
    <main className="crm-page">
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
        {role === "caller" && (
          <Link href={"/calls/queue" as never} className="crm-btn crm-btn-dark">File d&rsquo;appels</Link>
        )}
      </PageHeader>

      {/* ── Stats summary bar ── */}
      <div className="crm-stat-bar" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="crm-stat-pill">
          <span className="crm-stat-pill-value">{stats.total}</span>
          <span className="crm-stat-pill-label">Total leads</span>
        </div>
        <div className="crm-stat-pill crm-stat-pill--blue">
          <span className="crm-stat-pill-value">{stats.callable}</span>
          <span className="crm-stat-pill-label">Appelables</span>
        </div>
        <div className={`crm-stat-pill${stats.unassigned > 0 ? " crm-stat-pill--amber" : ""}`}>
          <span className="crm-stat-pill-value">{stats.unassigned}</span>
          <span className="crm-stat-pill-label">Non assignés</span>
        </div>
        <div className={`crm-stat-pill${stats.noPhone > 0 ? " crm-stat-pill--red" : ""}`}>
          <span className="crm-stat-pill-value">{stats.noPhone}</span>
          <span className="crm-stat-pill-label">Sans téléphone</span>
        </div>
      </div>

      <LeadsTable canAssign={role === "admin"} />
    </main>
  );
}
