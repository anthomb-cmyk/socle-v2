// /pipeline/[id] — Deal workspace

import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { normalizePhone } from "@/lib/twilio";
import DealWorkspaceClient, { type Deal, type DealDossier, type DealDocument, type DealSmsMessage } from "./DealWorkspaceClient";
import type { HistoryRow } from "@/app/calls/[leadId]/components/CallHistoryEntry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ActivityRecord = {
  leadId?: string;
  lead_id?: string;
  submissionId?: string;
  submission_id?: string;
  callLogId?: string | null;
  call_log_id?: string | null;
};
type SmsEvent = {
  id: string;
  event_type: "sms_received" | "sms_sent";
  payload: Record<string, unknown> | null;
  occurred_at: string;
};

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function idsFromActivities(activities: unknown) {
  const rows = Array.isArray(activities) ? activities as ActivityRecord[] : [];
  return {
    leadIds: uniqueStrings(rows.map((row) => row.leadId ?? row.lead_id)),
    submissionIds: uniqueStrings(rows.map((row) => row.submissionId ?? row.submission_id)),
    callLogIds: uniqueStrings(rows.map((row) => row.callLogId ?? row.call_log_id)),
  };
}

export default async function DealWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = createSupabaseAdminClient();

  const [{ data: deal }, { data: docs }, { data: callLogs }] = await Promise.all([
    sb.from("deals").select("id,title,stage,address,units,asking_price,offer_price,temperature,priority,contact_name,contact_phone,contact_email,notes_deal,notes_vendeur,ai_analysis,next_action,checklists,activities,lat,lng,created_at,updated_at").eq("id", id).single(),
    sb.from("deal_documents").select("id,name,size,mime_type,created_at").eq("deal_id", id).order("created_at", { ascending: false }),
    sb.from("call_logs")
      .select("id, outcome, notes, recorded_at, duration_sec, recording_url, transcript_status, transcript")
      .filter("raw->>deal_id", "eq", id)
      .order("recorded_at", { ascending: false })
      .limit(20),
  ]);

  if (!deal) notFound();

  const { leadIds: activityLeadIds, submissionIds: activitySubmissionIds, callLogIds: activityCallLogIds } =
    idsFromActivities((deal as { activities?: unknown }).activities);

  const submissionsById = new Map<string, DealDossier["submissions"][number]>();
  if (activitySubmissionIds.length > 0) {
    const { data: submissions } = await sb
      .from("lead_submissions")
      .select("id,lead_id,call_log_id,outcome,seller_interest_level,timeline,motivation,asking_price,property_info,condition_notes,objections,best_callback_time,caller_summary,recommended_action,status,created_at")
      .in("id", activitySubmissionIds);
    for (const row of (submissions ?? []) as DealDossier["submissions"]) {
      submissionsById.set(row.id, row);
    }
  }

  const leadIds = uniqueStrings([
    ...activityLeadIds,
    ...Array.from(submissionsById.values()).map((row) => row.lead_id),
  ]);
  const callLogIds = uniqueStrings([
    ...activityCallLogIds,
    ...Array.from(submissionsById.values()).map((row) => row.call_log_id),
  ]);

  if (leadIds.length > 0) {
    const { data: recentSubmissions } = await sb
      .from("lead_submissions")
      .select("id,lead_id,call_log_id,outcome,seller_interest_level,timeline,motivation,asking_price,property_info,condition_notes,objections,best_callback_time,caller_summary,recommended_action,status,created_at")
      .in("lead_id", leadIds)
      .order("created_at", { ascending: false })
      .limit(10);
    for (const row of (recentSubmissions ?? []) as DealDossier["submissions"]) {
      submissionsById.set(row.id, row);
    }
  }

  const refreshedLeadIds = uniqueStrings([
    ...leadIds,
    ...Array.from(submissionsById.values()).map((row) => row.lead_id),
  ]);
  const refreshedCallLogIds = uniqueStrings([
    ...callLogIds,
    ...Array.from(submissionsById.values()).map((row) => row.call_log_id),
  ]);

  const [leadRowsRes, callRowsByLeadRes, callRowsByIdRes] = await Promise.all([
    refreshedLeadIds.length > 0
      ? sb
          .from("leads_view")
          .select("lead_id,contact_id,property_id,address,city,num_units,evaluation_total,full_name,company_name,best_phone,status,priority,last_contacted_at,next_action_at")
          .in("lead_id", refreshedLeadIds)
      : Promise.resolve({ data: [], error: null }),
    refreshedLeadIds.length > 0
      ? sb
          .from("call_logs")
          .select("id,outcome,notes,summary,recorded_at,duration_sec,recording_url,transcript_status,transcript,lead_id")
          .in("lead_id", refreshedLeadIds)
          .order("recorded_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    refreshedCallLogIds.length > 0
      ? sb
          .from("call_logs")
          .select("id,outcome,notes,summary,recorded_at,duration_sec,recording_url,transcript_status,transcript,lead_id")
          .in("id", refreshedCallLogIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const callRowsById = new Map<string, DealDossier["callLogs"][number]>();
  for (const row of [
    ...((callLogs ?? []) as DealDossier["callLogs"]),
    ...((callRowsByLeadRes.data ?? []) as DealDossier["callLogs"]),
    ...((callRowsByIdRes.data ?? []) as DealDossier["callLogs"]),
  ]) {
    callRowsById.set(row.id, row);
  }

  const dossier: DealDossier = {
    leads: (leadRowsRes.data ?? []) as DealDossier["leads"],
    submissions: Array.from(submissionsById.values()).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    callLogs: Array.from(callRowsById.values())
      .sort((a, b) => Date.parse(b.recorded_at ?? "") - Date.parse(a.recorded_at ?? ""))
      .slice(0, 20),
  };

  const dealPhone = normalizePhone(String((deal as { contact_phone?: string | null }).contact_phone ?? ""));
  const { data: smsEvents } = await sb
    .from("automation_events")
    .select("id,event_type,payload,occurred_at")
    .in("event_type", ["sms_received", "sms_sent"])
    .order("occurred_at", { ascending: false })
    .limit(300);

  const smsMessages = ((smsEvents ?? []) as SmsEvent[])
    .filter((event) => smsEventBelongsToDeal(event, id, dealPhone))
    .map((event) => {
      const payload = event.payload ?? {};
      return {
        id: event.id,
        direction: event.event_type === "sms_received" ? "inbound" : "outbound",
        body: String(payload.body ?? ""),
        at: event.occurred_at,
        from: normalizePhone(String(payload.from ?? "")) || String(payload.from ?? ""),
        to: normalizePhone(String(payload.to ?? "")) || String(payload.to ?? ""),
      } satisfies DealSmsMessage;
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <DealWorkspaceClient
      deal={deal as unknown as Deal}
      documents={(docs ?? []) as unknown as DealDocument[]}
      callHistory={dossier.callLogs as unknown as HistoryRow[]}
      dossier={dossier}
      smsMessages={smsMessages}
    />
  );
}

function smsEventBelongsToDeal(event: SmsEvent, dealId: string, dealPhone: string | null) {
  const payload = event.payload ?? {};
  if (String(payload.dealId ?? payload.deal_id ?? "") === dealId) return true;
  if (!dealPhone) return false;
  const from = normalizePhone(String(payload.from ?? ""));
  const to = normalizePhone(String(payload.to ?? ""));
  return from === dealPhone || to === dealPhone;
}
