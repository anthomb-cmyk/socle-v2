import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export default async function EventsPage(
  { searchParams }: { searchParams: Promise<{ source?: string; status?: string }> }
) {
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  const sb = createSupabaseAdminClient();
  let q = sb.from("automation_events")
    .select("id, source, event_type, status, related_lead_id, error_message, payload, result, telegram_message_id, occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (sp.source) q = q.eq("source", sp.source);
  if (sp.status) q = q.eq("status", sp.status);
  const { data } = await q;
  const events = (data ?? []) as Array<{
    id: string; source: string; event_type: string; status: string;
    related_lead_id: string | null; error_message: string | null;
    payload: unknown; result: unknown; telegram_message_id: string | null;
    occurred_at: string;
  }>;

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Automation events</h1>
        <p className="text-sm text-zinc-500">Last 100 events. Every n8n / Telegram / web action lands here.</p>
        <div className="flex gap-2 mt-3 text-xs">
          <a className={pill(!sp.source && !sp.status)} href="/admin/events">All</a>
          <a className={pill(sp.source === "web_app")} href="/admin/events?source=web_app">Web</a>
          <a className={pill(sp.source === "telegram")} href="/admin/events?source=telegram">Telegram</a>
          <a className={pill(sp.source === "n8n")} href="/admin/events?source=n8n">n8n</a>
          <a className={pill(sp.status === "failed")} href="/admin/events?status=failed">Failures</a>
        </div>
      </header>

      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="text-left p-2">When</th>
              <th className="text-left p-2">Source</th>
              <th className="text-left p-2">Event</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-zinc-400">No events yet.</td></tr>}
            {events.map(e => (
              <tr key={e.id} className="border-t border-zinc-100 align-top">
                <td className="p-2 text-zinc-500 text-xs whitespace-nowrap">{new Date(e.occurred_at).toLocaleString()}</td>
                <td className="p-2"><span className="text-xs uppercase tracking-wide rounded px-1.5 py-0.5 bg-zinc-100">{e.source}</span></td>
                <td className="p-2 font-mono text-xs">{e.event_type}</td>
                <td className="p-2"><StatusPill status={e.status} /></td>
                <td className="p-2 text-xs text-zinc-700 max-w-md">
                  {e.error_message && <div className="text-red-600 mb-1">{e.error_message}</div>}
                  <details>
                    <summary className="cursor-pointer text-zinc-500">payload / result</summary>
                    <pre className="mt-1 bg-zinc-50 p-2 rounded text-[10px] overflow-x-auto">{JSON.stringify({ payload: e.payload, result: e.result }, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function pill(active: boolean) {
  return `px-2 py-1 rounded ${active ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`;
}

function StatusPill({ status }: { status: string }) {
  const c: Record<string, string> = {
    success: "bg-emerald-100 text-emerald-800",
    started: "bg-blue-100 text-blue-800",
    failed: "bg-red-100 text-red-800",
    partial: "bg-amber-100 text-amber-800",
  };
  return <span className={`text-xs uppercase tracking-wide rounded px-1.5 py-0.5 ${c[status] ?? "bg-zinc-100"}`}>{status}</span>;
}
