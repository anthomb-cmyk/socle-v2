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

  const hasUrgent = c.urgentReviews > 0 || c.overdueFu > 0;

  return (
    <main style={{ padding: "28px 32px", maxWidth: 1200 }}>
      {/* ── Page header ── */}
      <div style={{ marginBottom: 24 }}>
        <h1 className="crm-page-title">Tableau de bord</h1>
        <p className="crm-page-sub">Bonjour — voici votre état du jour.</p>
      </div>

      {/* ── À faire aujourd'hui — urgent banner ── */}
      {hasUrgent && (
        <div className="crm-card" style={{
          borderLeft: "4px solid var(--crm-red)",
          marginBottom: 20,
          padding: "16px 20px",
          background: "var(--crm-red-light)",
          borderColor: "var(--crm-red)",
          display: "flex",
          alignItems: "center",
          gap: 20,
          flexWrap: "wrap",
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-red)", marginBottom: 4 }}>À faire aujourd&rsquo;hui</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--crm-text)" }}>
              {c.urgentReviews > 0 && <span>{c.urgentReviews} revue{c.urgentReviews > 1 ? "s urgentes" : " urgente"}</span>}
              {c.urgentReviews > 0 && c.overdueFu > 0 && <span style={{ color: "var(--crm-text3)", margin: "0 8px" }}>·</span>}
              {c.overdueFu > 0 && <span>{c.overdueFu} suivi{c.overdueFu > 1 ? "s en retard" : " en retard"}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {c.urgentReviews > 0 && <Link href="/review" className="crm-btn" style={{ borderColor: "var(--crm-red)", color: "var(--crm-red)" }}>Aller à la revue →</Link>}
            {c.overdueFu > 0 && <Link href={"/follow-ups?bucket=overdue" as never} className="crm-btn">Suivis en retard →</Link>}
          </div>
        </div>
      )}

      {/* ── Stat tiles ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 20 }} className="sm:grid-cols-3 lg:grid-cols-6">
        <Tile href="/review" label="Revues urgentes" value={c.urgentReviews} sub={`${c.openReviews} ouvertes`} highlight={c.urgentReviews > 0} />
        <Tile href="/follow-ups?bucket=overdue" label="Suivis en retard" value={c.overdueFu} sub={`${c.todayFu} aujourd'hui`} highlight={c.overdueFu > 0} />
        <Tile href="/follow-ups" label="Suivis aujourd'hui" value={c.todayFu} />
        <Tile href="/leads?status=new" label="Nouveaux leads" value={c.newLeads} />
        <Tile href="/leads" label="Leads en cours" value={c.leadsToCall} sub="assignés + actifs" />
        <Tile href="/import" label="Import" value="↗" sub="ajouter un rôle" />
      </div>

      {/* ── Two-column activity section ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="lg:grid-cols-2">
        <Panel title="Imports récents" empty="Aucun import pour l'instant.">
          {(recentImports.data ?? []).length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {((recentImports.data ?? []) as Array<{ id: string; file_name: string; status: string; properties_created: number; leads_created: number; errors_count: number; created_at: string }>).map(i => (
                <li key={i.id} style={{ padding: "9px 0", borderBottom: "1px solid var(--crm-card-border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--crm-text)" }}>{i.file_name}</div>
                    <div style={{ fontSize: 11, color: "var(--crm-text3)", marginTop: 2 }}>{new Date(i.created_at).toLocaleString("fr-CA")} · <StatusDot status={i.status} /></div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 11, color: "var(--crm-text2)", whiteSpace: "nowrap", flexShrink: 0 }}>
                    <span className="crm-chip crm-chip-units">{i.properties_created}p</span>{" "}
                    <span className="crm-chip crm-chip-year">{i.leads_created}l</span>
                    {i.errors_count > 0 && <span style={{ color: "var(--crm-red)", marginLeft: 4 }}>{i.errors_count} err</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Erreurs d'automation (24h)" empty="Aucune erreur récente.">
          {(recentFailures.data ?? []).length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {((recentFailures.data ?? []) as Array<{ id: string; source: string; event_type: string; error_message: string | null; occurred_at: string }>).map(e => (
                <li key={e.id} style={{ padding: "9px 0", borderBottom: "1px solid var(--crm-card-border)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.7px", textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 2 }}>{e.source} · {e.event_type}</div>
                  <div style={{ fontSize: 13, color: "var(--crm-red)", fontWeight: 500 }}>{e.error_message ?? "(no message)"}</div>
                  <div style={{ fontSize: 11, color: "var(--crm-text3)", marginTop: 2 }}>{new Date(e.occurred_at).toLocaleString("fr-CA")}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </main>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "var(--crm-green)",
    processing: "var(--crm-blue)",
    failed: "var(--crm-red)",
    pending: "var(--crm-amber)",
  };
  return (
    <span style={{ color: colors[status] ?? "var(--crm-text3)", fontWeight: 600 }}>{status}</span>
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
    <div className="crm-card" style={{ padding: "18px 20px" }}>
      <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 12 }}>{title}</h2>
      {children ?? <p style={{ fontSize: 13, color: "var(--crm-text3)" }}>{empty}</p>}
    </div>
  );
}
