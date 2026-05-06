import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import CallerAppShell from "@/components/caller/CallerAppShell";
import CallWorkspace from "./CallWorkspace";
import CallHistoryPanel from "./CallHistoryPanel";
import CallPageTabs from "./CallPageTabs";
import LeadBriefingCard from "@/components/lead-briefing-card";

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

  // Fetch preflight failure reasons if lead is unsuitable.
  let unsuitableFailures: string[] | null = null;
  if ((lead as Record<string, unknown>).status === "unsuitable_for_phone_enrichment") {
    try {
      const { data: evtData } = await sb
        .from("enrichment_events")
        .select("payload")
        .eq("lead_id", leadId)
        .in("event_type", ["preflight_failed", "lead_status_updated"])
        .order("created_at", { ascending: false })
        .limit(5);
      if (evtData) {
        for (const evt of evtData) {
          const p = (evt as Record<string, unknown>).payload as Record<string, unknown> | null;
          const f = p?.failures;
          if (Array.isArray(f) && f.length > 0) {
            unsuitableFailures = f.map(String);
            break;
          }
        }
      }
    } catch {
      // fail gracefully
    }
  }

  // Briefing columns added by migration 0017 — query separately so a missing
  // column (42703) never crashes this page before the migration is applied.
  let briefingRow: { briefing_text: string | null; briefing_generated_at: string | null } | null = null;
  try {
    const { data: briefingData, error: briefingErr } = await sb
      .from("leads")
      .select("briefing_text, briefing_generated_at")
      .eq("id", leadId)
      .single();
    if (!briefingErr && briefingData) {
      briefingRow = briefingData as { briefing_text: string | null; briefing_generated_at: string | null };
    }
  } catch {
    // Migration 0017 not yet applied — briefing card shows empty state.
  }

  return (
    <CallerAppShell width="wide">
      {unsuitableFailures && (
        <div style={{
          margin: "0 0 12px",
          padding: "12px 16px",
          background: "#FFFBEB",
          border: "1px solid #FCD34D",
          borderRadius: 12,
          fontSize: 13,
          color: "#92400E",
        }}>
          <strong>Adresse postale incomplète.</strong>{" "}
          {unsuitableFailures.length > 0
            ? `Cette adresse postale est incomplète : ${unsuitableFailures.join(", ")}. Corrigez le fichier source et réimportez.`
            : "Cette adresse postale est incomplète. Corrigez le fichier source et réimportez."}
        </div>
      )}
      <div style={{ padding: "0 0 0 0" }}>
        <LeadBriefingCard
          leadId={leadId}
          initialText={briefingRow?.briefing_text ?? null}
          initialGeneratedAt={briefingRow?.briefing_generated_at ?? null}
        />
      </div>
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
