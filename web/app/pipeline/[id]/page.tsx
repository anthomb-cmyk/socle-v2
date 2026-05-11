// /pipeline/[id] — Deal workspace

import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import DealWorkspaceClient, { type Deal, type DealDocument } from "./DealWorkspaceClient";
import type { HistoryRow } from "@/app/calls/[leadId]/components/CallHistoryEntry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  return (
    <DealWorkspaceClient
      deal={deal as unknown as Deal}
      documents={(docs ?? []) as unknown as DealDocument[]}
      callHistory={(callLogs ?? []) as unknown as HistoryRow[]}
    />
  );
}
