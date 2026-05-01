import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

type QueueLead = {
  lead_id: string;
  full_name: string | null;
  company_name: string | null;
  address: string;
  city: string | null;
  num_units: number | null;
  best_phone: string | null;
  status: string;
  campaign_name: string | null;
  last_contacted_at: string | null;
  priority: number | null;
};

function formatPhone(phone: string | null) {
  if (!phone) return null;
  // Format +15145551234 → (514) 555-1234
  const m = phone.replace(/\D/g, "");
  if (m.length === 11 && m[0] === "1")
    return `(${m.slice(1, 4)}) ${m.slice(4, 7)}-${m.slice(7)}`;
  if (m.length === 10)
    return `(${m.slice(0, 3)}) ${m.slice(3, 6)}-${m.slice(6)}`;
  return phone;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    new: "New",
    ready_to_call: "Ready",
    in_outreach: "In outreach",
    no_answer: "No answer",
  };
  return map[s] ?? s;
}

function priorityColor(p: number | null) {
  if (p == null) return "bg-zinc-100 text-zinc-500";
  if (p >= 8) return "bg-red-100 text-red-700";
  if (p >= 5) return "bg-amber-100 text-amber-700";
  return "bg-zinc-100 text-zinc-500";
}

export default async function CallQueuePage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sb = createSupabaseAdminClient();

  // All leads assigned to this user in callable statuses
  const { data: rawLeads } = await sb
    .from("leads_view")
    .select("lead_id,full_name,company_name,address,city,num_units,best_phone,status,campaign_name,last_contacted_at,priority")
    .eq("assigned_to", user.id)
    .in("status", ["new", "ready_to_call", "in_outreach", "no_answer"])
    .order("priority", { ascending: false })
    .order("last_contacted_at", { ascending: true, nullsFirst: true });

  const leads = (rawLeads ?? []) as QueueLead[];

  // Per-lead call counts from call_logs
  const leadIds = leads.map((l) => l.lead_id);
  const callCounts: Record<string, number> = {};
  if (leadIds.length > 0) {
    const { data: counts } = await sb
      .from("call_logs")
      .select("lead_id")
      .in("lead_id", leadIds);
    (counts ?? []).forEach((row: { lead_id: string | null }) => {
      if (row.lead_id) callCounts[row.lead_id] = (callCounts[row.lead_id] ?? 0) + 1;
    });
  }

  const phoneReady = leads.filter((l) => l.best_phone).length;
  const noPhone = leads.length - phoneReady;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Call queue</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              {leads.length} lead{leads.length === 1 ? "" : "s"} assigned to you
              {phoneReady > 0 && (
                <> · <span className="text-emerald-600 font-medium">{phoneReady} with phone</span></>
              )}
              {noPhone > 0 && (
                <> · <span className="text-zinc-400">{noPhone} no phone</span></>
              )}
            </p>
          </div>
          <Link
            href="/leads"
            className="text-sm text-zinc-500 hover:text-zinc-800 border border-zinc-200 rounded-lg px-3 py-1.5"
          >
            View all leads
          </Link>
        </div>
      </header>

      {leads.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center text-zinc-500">
          You&rsquo;re all caught up. Nothing in your queue right now.
          <div className="mt-3">
            <Link href="/leads" className="text-sm text-blue-600 hover:underline">Browse all leads</Link>
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {leads.map((l) => {
            const hasPhone = !!l.best_phone;
            const callCount = callCounts[l.lead_id] ?? 0;

            return (
              <li key={l.lead_id}>
                <Link
                  href={`/calls/${l.lead_id}` as never}
                  className={[
                    "block border rounded-2xl p-4 transition",
                    hasPhone
                      ? "bg-white border-zinc-200 hover:border-zinc-400"
                      : "bg-zinc-50 border-zinc-200 opacity-70 hover:opacity-90 hover:border-zinc-300",
                  ].join(" ")}
                >
                  <div className="flex justify-between items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold truncate">
                          {l.full_name ?? l.company_name ?? "—"}
                        </span>
                        {l.priority != null && l.priority >= 5 && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${priorityColor(l.priority)}`}>
                            P{l.priority}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-zinc-600 truncate mt-0.5">
                        {l.address}{l.city ? `, ${l.city}` : ""}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-zinc-400 flex-wrap">
                        {l.num_units != null && <span>{l.num_units} units</span>}
                        {l.campaign_name && (
                          <>
                            {l.num_units != null && <span>·</span>}
                            <span>{l.campaign_name}</span>
                          </>
                        )}
                        {callCount > 0 && (
                          <>
                            <span>·</span>
                            <span>{callCount} call{callCount !== 1 ? "s" : ""}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      {hasPhone ? (
                        <div className="font-mono text-sm text-emerald-700 font-medium">
                          {formatPhone(l.best_phone)}
                        </div>
                      ) : (
                        <div className="text-xs text-zinc-400 bg-zinc-100 rounded px-2 py-1">
                          no phone
                        </div>
                      )}
                      <div className="text-xs text-zinc-400 mt-1">{statusLabel(l.status)}</div>
                      {l.last_contacted_at && (
                        <div className="text-xs text-zinc-400 mt-0.5">
                          Called {timeAgo(l.last_contacted_at)}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Quick stats footer */}
      {leads.length > 0 && (
        <div className="mt-6 text-center text-xs text-zinc-400">
          Sorted by priority · oldest contact first
        </div>
      )}
    </main>
  );
}
