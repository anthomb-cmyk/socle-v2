// Read-only calendar / schedule view.
// Shows pending follow-ups grouped by day for the next 14 days, plus
// overdue (past) at the top. No editing here — go to /follow-ups for that.

import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export default async function CalendarPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as string;

  const sb = createSupabaseAdminClient();
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const horizon = new Date(todayStart); horizon.setDate(horizon.getDate() + 14);

  let q = sb.from("follow_ups")
    .select("id, due_at, note, status, priority, lead_id, sync_status")
    .eq("status", "pending")
    .lt("due_at", horizon.toISOString())
    .order("due_at", { ascending: true });
  if (role !== "admin") q = q.eq("assigned_to", user.id);

  const { data } = await q;
  const fups = (data ?? []) as Array<{ id: string; due_at: string; note: string | null; status: string; priority: number; lead_id: string | null; sync_status: string | null }>;

  // Hydrate lead info
  const leadIds = [...new Set(fups.map(f => f.lead_id).filter(Boolean) as string[])];
  let leadMap: Record<string, { full_name: string | null; company_name: string | null; address: string; city: string | null }> = {};
  if (leadIds.length > 0) {
    const { data: leads } = await sb.from("leads_view")
      .select("lead_id, full_name, company_name, address, city")
      .in("lead_id", leadIds);
    leadMap = Object.fromEntries(((leads ?? []) as Array<{ lead_id: string; full_name: string | null; company_name: string | null; address: string; city: string | null }>).map(l => [l.lead_id, l]));
  }

  // Bucket by day key (YYYY-MM-DD in local time)
  function dayKey(d: Date) { return d.toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }); }
  const buckets = new Map<string, typeof fups>();
  for (const f of fups) {
    const d = new Date(f.due_at);
    const key = d < todayStart ? "OVERDUE" : dayKey(d);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(f);
  }

  // Order keys: OVERDUE first, then chronological days
  const orderedKeys = [
    ...(buckets.has("OVERDUE") ? ["OVERDUE"] : []),
    ...[...buckets.keys()].filter(k => k !== "OVERDUE").sort(),
  ];

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Calendar</h1>
          <p className="text-sm text-zinc-500">Next 14 days · {fups.length} pending follow-up{fups.length === 1 ? "" : "s"}.</p>
        </div>
        <Link href="/follow-ups" className="border border-zinc-300 rounded-lg px-3 py-1.5 text-sm">Manage follow-ups →</Link>
      </header>

      {fups.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center text-zinc-500 text-sm">
          No follow-ups scheduled in the next 14 days. 🎉
        </div>
      ) : (
        <div className="space-y-5">
          {orderedKeys.map(key => {
            const items = buckets.get(key)!;
            const isOverdue = key === "OVERDUE";
            const headerLabel = isOverdue ? "Overdue" : new Date(key + "T12:00:00").toLocaleDateString("fr-CA", { weekday: "long", month: "long", day: "numeric" });
            return (
              <section key={key}>
                <h2 className={`text-sm uppercase tracking-wide mb-2 ${isOverdue ? "text-red-700" : "text-zinc-500"}`}>{headerLabel} ({items.length})</h2>
                <ul className="space-y-1.5">
                  {items.map(f => {
                    const d = new Date(f.due_at);
                    const time = d.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });
                    const lead = f.lead_id ? leadMap[f.lead_id] : null;
                    return (
                      <li key={f.id} className={`bg-white border rounded-xl p-3 ${isOverdue ? "border-red-200" : "border-zinc-200"}`}>
                        <div className="flex justify-between items-start gap-3">
                          <div className="flex-1">
                            <div className="text-sm">
                              <span className="font-mono text-zinc-500 mr-2">{time}</span>
                              <span className="font-medium">{lead?.full_name ?? lead?.company_name ?? "—"}</span>
                              {lead?.city && <span className="text-zinc-500"> · {lead.city}</span>}
                            </div>
                            {f.note && <div className="text-xs text-zinc-700 mt-1 whitespace-pre-wrap">{f.note}</div>}
                            <div className="text-xs text-zinc-400 mt-1 flex gap-3">
                              <span>priority {f.priority}</span>
                              {f.sync_status && f.sync_status !== "unsynced" && <span>sync: {f.sync_status}</span>}
                              {f.lead_id && <Link href={`/calls/${f.lead_id}` as never} className="underline">Open lead →</Link>}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
