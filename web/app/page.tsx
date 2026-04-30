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
        <h1 className="text-2xl font-semibold mb-2">Socle CRM</h1>
        <p className="text-zinc-600 mb-6">Québec multifamily acquisition operating system.</p>
        <Link className="inline-block bg-zinc-900 text-white rounded-lg px-4 py-2 text-sm font-medium" href="/login">Sign in</Link>
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
      <header>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-zinc-500">Bonjour, {user.email}.</p>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Tile href="/review" label="Urgent reviews" value={c.urgentReviews} sub={`${c.openReviews} total open`} highlight={c.urgentReviews > 0} />
        <Tile href="/follow-ups?bucket=overdue" label="Overdue follow-ups" value={c.overdueFu} sub={`${c.todayFu} due today`} highlight={c.overdueFu > 0} />
        <Tile href="/follow-ups" label="Today's follow-ups" value={c.todayFu} />
        <Tile href="/leads?status=new" label="New leads" value={c.newLeads} />
        <Tile href="/leads" label="Leads in motion" value={c.leadsToCall} sub="assigned + active" />
        <Tile href="/import" label="Import" value="↗" sub="add a rôle" />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Recent imports" empty="No imports yet.">
          {(recentImports.data ?? []).length > 0 && (
            <ul className="text-sm divide-y divide-zinc-100">
              {((recentImports.data ?? []) as Array<{ id: string; file_name: string; status: string; properties_created: number; leads_created: number; errors_count: number; created_at: string }>).map(i => (
                <li key={i.id} className="py-2 flex justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{i.file_name}</div>
                    <div className="text-xs text-zinc-500">{new Date(i.created_at).toLocaleString()} · {i.status}</div>
                  </div>
                  <div className="text-right text-xs text-zinc-600 whitespace-nowrap">
                    {i.properties_created}p · {i.leads_created}l
                    {i.errors_count > 0 && <span className="text-red-600"> · {i.errors_count} err</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent failures (24h)" empty="Nothing failing.">
          {(recentFailures.data ?? []).length > 0 && (
            <ul className="text-sm divide-y divide-zinc-100">
              {((recentFailures.data ?? []) as Array<{ id: string; source: string; event_type: string; error_message: string | null; occurred_at: string }>).map(e => (
                <li key={e.id} className="py-2">
                  <div className="text-xs uppercase tracking-wide text-zinc-500">{e.source} · {e.event_type}</div>
                  <div className="text-sm text-red-700">{e.error_message ?? "(no message)"}</div>
                  <div className="text-xs text-zinc-400">{new Date(e.occurred_at).toLocaleString()}</div>
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
    <Link href={href as never} className={`block bg-white rounded-2xl border p-4 hover:border-zinc-400 transition ${highlight ? "border-amber-300 bg-amber-50" : "border-zinc-200"}`}>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-3xl font-semibold mt-1 ${highlight ? "text-amber-900" : "text-zinc-900"}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </Link>
  );
}

function Panel({ title, empty, children }: { title: string; empty: string; children?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 p-4">
      <h2 className="text-sm font-semibold text-zinc-700 mb-2">{title}</h2>
      {children ?? <p className="text-sm text-zinc-400">{empty}</p>}
    </div>
  );
}
