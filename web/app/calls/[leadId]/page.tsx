import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import CallWorkspace from "./CallWorkspace";
import CallHistoryPanel from "./CallHistoryPanel";

export default async function CallLeadPage(
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  const sb = createSupabaseAdminClient();

  // Fetch lead first so we have the contact_id for the phones query
  const { data: lead } = await sb.from("leads_view").select("*").eq("lead_id", leadId).single();
  if (!lead) return notFound();
  if (role !== "admin" && lead.assigned_to !== user.id) return notFound();

  const [phonesRes, historyRes, metaRes] = await Promise.all([
    sb.from("phones")
      .select("id, e164, display, status, source, confidence")
      .eq("contact_id", lead.contact_id)
      .order("confidence", { ascending: false }),
    sb.from("call_logs")
      .select("id, outcome, notes, recorded_at, duration_sec, recording_url, transcript_status, transcript")
      .eq("lead_id", leadId)
      .order("recorded_at", { ascending: false })
      .limit(15),
    sb.from("users_meta")
      .select("twilio_forward_to")
      .eq("user_id", user.id)
      .single(),
  ]);

  const phones  = phonesRes.data ?? [];
  const history = historyRes.data ?? [];
  const userForwardTo: string | null = metaRes.data?.twilio_forward_to?.trim() || null;

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
        phones={phones}
        userForwardTo={userForwardTo}
      />

      {history.length > 0 && (
        <CallHistoryPanel history={history} />
      )}
    </main>
  );
}
