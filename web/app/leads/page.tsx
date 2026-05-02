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
    // Total leads
    sb.from("leads").select("id", { count: "exact", head: true }),
    // Appelables: callable statuses
    sb.from("leads").select("id", { count: "exact", head: true }).in("status", CALLABLE_STATUSES),
    // Non assignés: callable but no caller assigned
    sb.from("leads").select("id", { count: "exact", head: true })
      .in("status", CALLABLE_STATUSES)
      .is("assigned_to", null),
    // Sans téléphone: no phone_verified lead in leads_view (use status not phone_verified and not enriching)
    sb.from("leads").select("id", { count: "exact", head: true })
      .not("status", "in", `(${["phone_verified", "do_not_contact", "rejected", "deal_closed", "deal_lost"].join(",")})`)
      .is("assigned_to", null),
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
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 10,
        marginBottom: 20,
      }}>
        <StatPill label="Total leads" value={stats.total} />
        <StatPill label="Appelables" value={stats.callable} accent="blue" />
        <StatPill label="Non assignés" value={stats.unassigned} accent={stats.unassigned > 0 ? "amber" : undefined} />
        <StatPill label="Sans téléphone" value={stats.noPhone} accent={stats.noPhone > 0 ? "red" : undefined} />
      </div>

      <LeadsTable canAssign={role === "admin"} />
    </main>
  );
}

type Accent = "blue" | "amber" | "red";

function StatPill({ label, value, accent }: { label: string; value: number; accent?: Accent }) {
  const accentColor: Record<Accent, string> = {
    blue:  "var(--crm-blue)",
    amber: "var(--crm-amber)",
    red:   "var(--crm-red)",
  };
  const color = accent ? accentColor[accent] : "var(--crm-text)";

  return (
    <div style={{
      background: "var(--crm-card)",
      border: "1px solid var(--crm-card-border)",
      borderRadius: 10,
      padding: "11px 16px",
      display: "flex",
      alignItems: "center",
      gap: 12,
    }}>
      <span style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--crm-text2)", lineHeight: 1.3 }}>{label}</span>
    </div>
  );
}
