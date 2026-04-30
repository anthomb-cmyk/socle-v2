import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export default async function CallQueuePage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Use admin client to read leads_view; we filter by assigned_to manually
  // because the view doesn't carry RLS through.
  const sb = createSupabaseAdminClient();
  const { data: leads } = await sb.from("leads_view")
    .select("*")
    .eq("assigned_to", user.id)
    .in("status", ["new", "ready_to_call", "in_outreach", "no_answer"])
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Call queue</h1>
        <p className="text-sm text-zinc-500">
          {leads?.length ?? 0} lead{leads?.length === 1 ? "" : "s"} assigned to you ready to call.
        </p>
      </header>

      {(!leads || leads.length === 0) ? (
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center text-zinc-500">
          You&rsquo;re all caught up. Nothing in your queue right now.
        </div>
      ) : (
        <ul className="space-y-2">
          {(leads as Array<Record<string, unknown>>).map((row) => {
            const l = row as {
              lead_id: string; full_name: string | null; company_name: string | null;
              address: string; city: string | null; num_units: number | null;
              best_phone: string | null; status: string; campaign_name: string | null;
            };
            return (
            <li key={l.lead_id}>
              <Link href={`/calls/${l.lead_id}` as never} className="block bg-white border border-zinc-200 rounded-2xl p-4 hover:border-zinc-400 transition">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold">{l.full_name ?? l.company_name ?? "—"}</div>
                    <div className="text-sm text-zinc-600">{l.address}{l.city ? `, ${l.city}` : ""}</div>
                    {l.num_units != null && <div className="text-xs text-zinc-500 mt-1">{l.num_units} units</div>}
                  </div>
                  <div className="text-right">
                    {l.best_phone ? <div className="font-mono text-sm">{l.best_phone}</div>
                      : <div className="text-xs text-zinc-400">no phone</div>}
                    <div className="text-xs text-zinc-400 mt-1">{l.status}</div>
                  </div>
                </div>
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
