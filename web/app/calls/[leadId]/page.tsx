import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import CallerAppShell from "@/components/caller/CallerAppShell";
import CallWorkspace from "./CallWorkspace";
import CallHistoryPanel from "./CallHistoryPanel";
import CallPageTabs from "./CallPageTabs";

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
    <CallerAppShell width="wide">
      <CallPageTabs historyCount={history.length}>
        <CallWorkspace
          leadId={leadId}
          phones={phones}
          userForwardTo={userForwardTo}
          lead={lead as Parameters<typeof CallWorkspace>[0]["lead"]}
          callCount={history.length}
        />
        <CallHistoryPanel history={history} />
      </CallPageTabs>
    </CallerAppShell>
  );
}
