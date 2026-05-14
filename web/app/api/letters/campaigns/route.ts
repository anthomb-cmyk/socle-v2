import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const sb = createSupabaseAdminClient();
  const { data: campaigns, error } = await sb
    .from("letter_campaigns")
    .select("id,name,city,source_file,mailed_at,letter_template,notes,created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const ids = (campaigns ?? []).map((campaign: { id: string }) => campaign.id);
  const stats: Record<string, {
    sent: number;
    called: number;
    interested: number;
    maybe: number;
    notInterested: number;
    bad: number;
    buildings: number;
    units: number;
  }> = {};

  for (const id of ids) {
    stats[id] = { sent: 0, called: 0, interested: 0, maybe: 0, notInterested: 0, bad: 0, buildings: 0, units: 0 };
  }

  if (ids.length > 0) {
    const { data: recipients } = await sb
      .from("letter_recipients")
      .select("campaign_id,status,last_outcome,property_count,total_units")
      .in("campaign_id", ids);

    for (const row of recipients ?? []) {
      const stat = stats[row.campaign_id];
      if (!stat) continue;
      stat.sent += 1;
      stat.buildings += Number(row.property_count ?? 0);
      stat.units += Number(row.total_units ?? 0);
      if (row.last_outcome || row.status !== "sent") stat.called += 1;
      if (["interested", "wants_offer", "meeting_booked", "deal_created"].includes(row.status) || ["interested", "wants_offer", "meeting_booked"].includes(row.last_outcome)) {
        stat.interested += 1;
      }
      if (row.status === "maybe_later" || row.last_outcome === "maybe_later") stat.maybe += 1;
      if (row.status === "not_interested" || row.last_outcome === "not_interested") stat.notInterested += 1;
      if (["bad_address", "wrong_person", "do_not_contact"].includes(row.status)) stat.bad += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      campaigns: (campaigns ?? []).map((campaign: { id: string }) => ({
        ...campaign,
        stats: stats[campaign.id] ?? { sent: 0, called: 0, interested: 0, maybe: 0, notInterested: 0, bad: 0, buildings: 0, units: 0 },
      })),
    },
  });
}
