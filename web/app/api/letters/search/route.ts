import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

type SearchRow = {
  recipient_id: string;
  campaign_id: string;
  owner_name: string;
  original_owner_name: string | null;
  company_name: string | null;
  mailing_address: string | null;
  mailing_city: string | null;
  mailing_postal: string | null;
  phone_display: string | null;
  bucket: string;
  property_count: number;
  total_units: number | null;
  status: string;
  last_outcome: string | null;
  last_interaction_at: string | null;
  score: number;
};

function tokenize(q: string): string[] {
  return q
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length >= 2)
    .slice(0, 6);
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const campaignId = url.searchParams.get("campaignId")?.trim() || null;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "25", 10), 50);
  const sb = createSupabaseAdminClient();

  let recipients: SearchRow[] = [];
  const rpc = await sb.rpc("search_letter_recipients", {
    p_query: q,
    p_campaign_id: campaignId,
    p_limit: limit,
  });

  if (!rpc.error) {
    recipients = (rpc.data ?? []) as SearchRow[];
  } else {
    // Fallback for local/dev DBs before migration is applied.
    let query = sb
      .from("letter_recipients")
      .select("id,campaign_id,owner_name,original_owner_name,company_name,mailing_address,mailing_city,mailing_postal,phone_display,bucket,property_count,total_units,status,last_outcome,last_interaction_at")
      .order("last_interaction_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (campaignId) query = query.eq("campaign_id", campaignId);
    const tokens = tokenize(q);
    if (tokens.length > 0) {
      const ors = tokens.flatMap((token) => [
        `owner_name.ilike.%${token}%`,
        `company_name.ilike.%${token}%`,
        `mailing_address.ilike.%${token}%`,
        `search_blob.ilike.%${token}%`,
      ]);
      query = query.or(ors.join(","));
    }
    const { data, error } = await query;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    recipients = (data ?? []).map((row: Record<string, unknown>) => ({
      recipient_id: row.id as string,
      campaign_id: row.campaign_id as string,
      owner_name: row.owner_name as string,
      original_owner_name: row.original_owner_name as string | null,
      company_name: row.company_name as string | null,
      mailing_address: row.mailing_address as string | null,
      mailing_city: row.mailing_city as string | null,
      mailing_postal: row.mailing_postal as string | null,
      phone_display: row.phone_display as string | null,
      bucket: row.bucket as string,
      property_count: row.property_count as number,
      total_units: row.total_units as number | null,
      status: row.status as string,
      last_outcome: row.last_outcome as string | null,
      last_interaction_at: row.last_interaction_at as string | null,
      score: 0,
    }));
  }

  const ids = recipients.map((recipient) => recipient.recipient_id);
  let propertiesByRecipient: Record<string, unknown[]> = {};
  let interactionsByRecipient: Record<string, unknown[]> = {};
  let campaignsById: Record<string, unknown> = {};

  if (ids.length > 0) {
    const campaignIds = [...new Set(recipients.map((recipient) => recipient.campaign_id))];
    const [propertiesRes, interactionsRes, campaignsRes] = await Promise.all([
      sb
        .from("letter_recipient_properties")
        .select("id,recipient_id,matricule,address,city,postal_code,num_units,cadastre,property_type,evaluation_total")
        .in("recipient_id", ids)
        .order("num_units", { ascending: false, nullsFirst: false }),
      sb
        .from("letter_interactions")
        .select("id,recipient_id,outcome,notes,transcript,inbound_phone,call_started_at,source,next_action,follow_up_at,created_at")
        .in("recipient_id", ids)
        .order("created_at", { ascending: false })
        .limit(150),
      sb
        .from("letter_campaigns")
        .select("id,name,city,mailed_at")
        .in("id", campaignIds),
    ]);

    propertiesByRecipient = (propertiesRes.data ?? []).reduce((acc: Record<string, unknown[]>, row: { recipient_id: string }) => {
      acc[row.recipient_id] = [...(acc[row.recipient_id] ?? []), row];
      return acc;
    }, {});
    interactionsByRecipient = (interactionsRes.data ?? []).reduce((acc: Record<string, unknown[]>, row: { recipient_id: string }) => {
      acc[row.recipient_id] = [...(acc[row.recipient_id] ?? []), row];
      return acc;
    }, {});
    campaignsById = (campaignsRes.data ?? []).reduce((acc: Record<string, unknown>, row: { id: string }) => {
      acc[row.id] = row;
      return acc;
    }, {});
  }

  return NextResponse.json({
    ok: true,
    data: {
      recipients: recipients.map((recipient) => ({
        ...recipient,
        campaign: campaignsById[recipient.campaign_id] ?? null,
        properties: propertiesByRecipient[recipient.recipient_id] ?? [],
        interactions: interactionsByRecipient[recipient.recipient_id] ?? [],
      })),
    },
  });
}
