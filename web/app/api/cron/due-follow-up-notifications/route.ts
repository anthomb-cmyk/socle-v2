import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { notifyDueFollowUps } from "@/lib/notifications/phone";

export const runtime = "nodejs";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret && process.env.NODE_ENV !== "production") return true;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  const querySecret = new URL(request.url).searchParams.get("secret")?.trim() ?? "";
  return bearer === secret || querySecret === secret;
}

type FollowUpRow = {
  id: string;
  lead_id: string | null;
  due_at: string;
  note: string | null;
};

type SentEventRow = {
  payload: { followUpId?: string } | null;
};

type LeadViewRow = {
  lead_id: string;
  full_name: string | null;
  company_name: string | null;
  address: string | null;
  city: string | null;
};

function labelForFollowUp(row: FollowUpRow, lead?: LeadViewRow) {
  const owner = [lead?.full_name, lead?.company_name].filter(Boolean).join(" - ");
  const property = [lead?.address, lead?.city].filter(Boolean).join(", ");
  return owner || property || row.note || "Suivi";
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const sb = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: dueRows, error: dueError } = await sb
    .from("follow_ups")
    .select("id,lead_id,due_at,note")
    .eq("status", "pending")
    .lte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(200);

  if (dueError) return NextResponse.json({ ok: false, error: dueError.message }, { status: 500 });

  const followUps = (dueRows ?? []) as FollowUpRow[];
  if (followUps.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no_due_follow_ups" });
  }

  const { data: sentRows } = await sb
    .from("automation_events")
    .select("payload")
    .eq("event_type", "follow_up_due_push_sent")
    .gte("occurred_at", new Date(Date.now() - 36 * 3600 * 1000).toISOString())
    .limit(1000);

  const sentIds = new Set(
    ((sentRows ?? []) as SentEventRow[])
      .map((row) => row.payload?.followUpId)
      .filter((id): id is string => Boolean(id)),
  );
  const unsent = followUps.filter((row) => !sentIds.has(row.id));
  if (unsent.length === 0) {
    return NextResponse.json({ ok: true, skipped: "already_notified", dueCount: followUps.length });
  }

  const leadIds = [...new Set(unsent.map((row) => row.lead_id).filter((id): id is string => Boolean(id)))];
  const { data: leads } = leadIds.length > 0
    ? await sb
        .from("leads_view")
        .select("lead_id,full_name,company_name,address,city")
        .in("lead_id", leadIds)
    : { data: [] };
  const leadsById = new Map(((leads ?? []) as LeadViewRow[]).map((lead) => [lead.lead_id, lead]));
  const first = unsent[0];

  const notification = await notifyDueFollowUps({
    count: unsent.length,
    firstLabel: labelForFollowUp(first, first.lead_id ? leadsById.get(first.lead_id) : undefined),
    firstDueAt: first.due_at,
  });

  await sb.from("automation_events").insert(unsent.map((row) => ({
    source: "system",
    event_type: "follow_up_due_push_sent",
    status: notification.ok ? "success" : "failed",
    related_lead_id: row.lead_id,
    payload: { followUpId: row.id, dueAt: row.due_at, batchSize: unsent.length },
    result: notification,
  })));

  return NextResponse.json({
    ok: notification.ok,
    dueCount: followUps.length,
    notifiedCount: unsent.length,
    notification,
  });
}
