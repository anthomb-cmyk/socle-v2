import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Logged out → marketing/landing
  if (!user) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="crm-page-title mb-2">Socle CRM</h1>
        <p style={{ color: "var(--crm-text2)", marginBottom: 24, fontSize: 14 }}>Système d&rsquo;acquisition immobilier multifamilial au Québec.</p>
        <Link className="crm-btn crm-btn-dark" href="/login">Se connecter</Link>
      </main>
    );
  }

  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role === "caller") redirect("/calls/queue");

  // Admin dashboard. Server-fetch all the dashboard stats in parallel.
  const sb = createSupabaseAdminClient();
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  const dayAgo = new Date(now); dayAgo.setDate(dayAgo.getDate() - 1);

  const [openReviews, urgentReviews, newLeads, leadsToCall, overdueFu, todayFu, recentImports, recentFailures] = await Promise.all([
    sb.from("review_items").select("id", { count: "exact", head: true }).eq("status", "open"),
    sb.from("review_items").select("id", { count: "exact", head: true }).eq("status", "open").eq("urgency", "urgent"),
    sb.from("leads").select("id", { count: "exact", head: true }).eq("status", "new"),
    sb.from("leads").select("id", { count: "exact", head: true }).in("status", ["new", "ready_to_call", "in_outreach", "no_answer"]).not("assigned_to", "is", null),
    sb.from("follow_ups").select("id", { count: "exact", head: true }).eq("status", "pending").lt("due_at", todayStart.toISOString()),
    sb.from("follow_ups").select("id", { count: "exact", head: true }).eq("status", "pending").gte("due_at", todayStart.toISOString()).lt("due_at", todayEnd.toISOString()),
    sb.from("import_jobs").select("id, file_name, status, properties_created, leads_created, errors_count, created_at").order("created_at", { ascending: false }).limit(5),
    sb.from("automation_events").select("id, source, event_type, error_message, occurred_at").eq("status", "failed").gte("occurred_at", dayAgo.toISOString()).order("occurred_at", { ascending: false }).limit(5),
  ]);

  const c = {
    openReviews: openReviews.count ?? 0,
    urgentReviews: urgentReviews.count ?? 0,
    newLeads: newLeads.count ?? 0,
    leadsToCall: leadsToCall.count ?? 0,
    overdueFu: overdueFu.count ?? 0,
    todayFu: todayFu.count ?? 0,
  };

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header style={{ marginBottom: 20 }}>
        <h1 className="crm-page-title">Tableau de bord</h1>
        <p className="crm-page-sub">Bonjour, {user.email}.</p>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Tile href="/review" label="Revues urgentes" value={c.urgentReviews} sub={`${c.openReviews} total ouvert`} highlight={c.urgentReviews > 0} />
        <Tile href="/follow-ups?bucket=overdue" label="Suivis en retard" value={c.overdueFu} sub={`${c.todayFu} aujourd'hui`} highlight={c.overdueFu > 0} />
        <Tile href="/follow-ups" label="Suivis aujourd'hui" value={c.todayFu} />
        <Tile href="/leads?status=new" label="Nouveaux leads" value={c.newLeads} />
        <Tile href="/leads" label="Leads en cours" value={c.leadsToCall} sub="assignés + actifs" />
        <Tile href="/import" label="Import" value="↗" sub="ajouter un rôle" />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Imports récents" empty="Aucun import.">
          {(recentImports.data ?? []).length > 0 && (
            <ul style={{ fontSize: 13 }}>
              {((recentImports.data ?? []) as Array<{ id: string; file_name: string; status: string; properties_created: number; leads_created: number; errors_count: number; created_at: string }>).map(i => (
                <li key={i.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--crm-card-border)", display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.file_name}</div>
                    <div style={{ fontSize: 11, color: "var(--crm-text3)" }}>{new Date(i.created_at).toLocaleString("fr-CA")} · {i.status}</div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 11, color: "var(--crm-text2)", whiteSpace: "nowrap" }}>
                    {i.properties_created}p · {i.leads_created}l
                    {i.errors_count > 0 && <span style={{ color: "var(--crm-red)" }}> · {i.errors_count} err</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Erreurs récentes (24h)" empty="Aucune erreur.">
          {(recentFailures.data ?? []).length > 0 && (
            <ul style={{ fontSize: 13 }}>
              {((recentFailures.data ?? []) as Array<{ id: string; source: string; event_type: string; error_message: string | null; occurred_at: string }>).map(e => (
                <li key={e.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--crm-card-border)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-text3)" }}>{e.source} · {e.event_type}</div>
                  <div style={{ fontSize: 13, color: "var(--crm-red)" }}>{e.error_message ?? "(no message)"}</div>
                  <div style={{ fontSize: 11, color: "var(--crm-text3)" }}>{new Date(e.occurred_at).toLocaleString("fr-CA")}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </main>
  );
}

function Tile({ href, label, value, sub, highlight }: { href: string; label: string; value: number | string; sub?: string; highlight?: boolean }) {
  return (
    <Link href={href as never} className={`crm-tile${highlight ? " crm-tile-hot" : ""}`}>
      <div className="crm-tile-label">{label}</div>
      <div className="crm-tile-value">{value}</div>
      {sub && <div className="crm-tile-sub">{sub}</div>}
    </Link>
  );
}

function Panel({ title, empty, children }: { title: string; empty: string; children?: React.ReactNode }) {
  return (
    <div className="crm-card" style={{ padding: "16px 20px" }}>
      <h2 style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 12 }}>{title}</h2>
      {children ?? <p style={{ fontSize: 13, color: "var(--crm-text3)" }}>{empty}</p>}
    </div>
  );
}
