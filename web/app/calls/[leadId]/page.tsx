import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import CallWorkspace from "./CallWorkspace";

export default async function CallLeadPage(
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  const sb = createSupabaseAdminClient();

  const { data: lead } = await sb.from("leads_view").select("*").eq("lead_id", leadId).single();
  if (!lead) return notFound();
  if (role !== "admin" && lead.assigned_to !== user.id) return notFound();

  // Fetch all phones for this contact so the caller can pick which one was dialed
  const { data: phones } = await sb.from("phones")
    .select("id, e164, display, status, source, confidence")
    .eq("contact_id", lead.contact_id)
    .order("confidence", { ascending: false });

  // Recent call history on this lead
  const { data: history } = await sb.from("call_logs")
    .select("id, outcome, notes, recorded_at, duration_sec")
    .eq("lead_id", leadId)
    .order("recorded_at", { ascending: false })
    .limit(10);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link href="/calls/queue" className="text-sm text-zinc-500 hover:underline">← Back to queue</Link>

      <header className="mt-3 mb-6">
        <h1 className="text-2xl font-semibold">{lead.full_name ?? lead.company_name ?? "—"}</h1>
        <p className="text-zinc-600">{lead.address}{lead.city ? `, ${lead.city}` : ""}</p>
        <p className="text-sm text-zinc-500 mt-1">
          {lead.num_units != null && <>{lead.num_units} units · </>}
          {lead.contact_kind} · status: <span className="font-medium">{lead.status}</span>
          {lead.campaign_name && <> · {lead.campaign_name}</>}
        </p>
      </header>

      <CallWorkspace
        leadId={leadId}
        phones={phones ?? []}
      />

      {(history && history.length > 0) && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-2">Recent calls on this lead</h2>
          <ul className="space-y-2">
            {history.map((h: { id: string; outcome: string | null; notes: string | null; recorded_at: string | null }) => (
              <li key={h.id} className="text-sm border-l-2 border-zinc-200 pl-3">
                <div><span className="font-medium">{h.outcome ?? "—"}</span> · {h.recorded_at ? new Date(h.recorded_at).toLocaleString() : ""}</div>
                {h.notes && <div className="text-zinc-600">{h.notes}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
