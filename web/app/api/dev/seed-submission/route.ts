// POST /api/dev/seed-submission — admin-only. Creates a fake hot-seller submission
// end-to-end (campaign → property → contact → phone → lead → call_log →
// lead_submission → review_item → automation_events → optional Telegram alert).
//
// Use to test the slice without going through XLSX import + caller workspace.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { sendTelegramAlert } from "@/lib/telegram";

export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const sb = createSupabaseAdminClient();
  const stamp = Date.now();

  // 1. Campaign
  const { data: camp, error: campErr } = await sb.from("campaigns")
    .insert({ name: `Seed test ${stamp}`, city: "Granby", source: "dev_seed", created_by: user.id })
    .select("id").single();
  if (campErr) return NextResponse.json({ ok: false, error: `campaign: ${campErr.message}` }, { status: 500 });

  // 2. Property
  const { data: prop } = await sb.from("properties").insert({
    address: `${stamp} rue Notre-Dame`,
    city: "Granby",
    province: "QC",
    postal_code: "J2G 1M3",
    matricule: `seed-${stamp}`,
    num_units: 8,
    year_built: 1985,
    evaluation_total: 1450000,
    evaluation_year: 2025,
    source: "dev_seed",
  }).select("id").single();

  // 3. Contact (company)
  const { data: contact } = await sb.from("contacts").insert({
    kind: "company",
    company_name: "Gestion CML inc.",
    full_name: "Gestion CML inc.",
    primary_email: null,
    mailing_address: "999 boulevard Industriel",
    mailing_city: "Granby",
    source: "dev_seed",
  }).select("id").single();

  // 4. property_contacts link
  await sb.from("property_contacts").insert({
    property_id: prop!.id, contact_id: contact!.id, relationship: "owner", share_pct: 100,
  });

  // 5. Phone
  const { data: phone } = await sb.from("phones").insert({
    contact_id: contact!.id,
    e164: "+14505550142",
    display: "(450) 555-0142",
    status: "unverified",
    source: "manual",
    confidence: 80,
    evidence: "seed",
  }).select("id").single();

  // 6. Lead — assign to caller (this user as fallback if no caller exists)
  const { data: lead } = await sb.from("leads").insert({
    campaign_id: camp!.id,
    property_id: prop!.id,
    contact_id: contact!.id,
    status: "in_outreach",
    priority: 80,
    assigned_to: user.id,
    source: "dev_seed",
  }).select("id").single();

  // 7. Call log
  const { data: call } = await sb.from("call_logs").insert({
    lead_id: lead!.id,
    contact_id: contact!.id,
    phone_id: phone!.id,
    user_id: user.id,
    direction: "outbound",
    duration_sec: 320,
    outcome: "hot_seller",
    notes: "Owner is open to selling, mentioned mortgage maturity in 3 months. Wants to see a number before meeting.",
    recorded_at: new Date().toISOString(),
  }).select("id").single();

  // 8. Lead submission
  const { data: sub } = await sb.from("lead_submissions").insert({
    lead_id: lead!.id,
    call_log_id: call!.id,
    submitted_by: user.id,
    outcome: "hot_seller",
    seller_interest_level: "hot",
    timeline: "3_months",
    motivation: "Mortgage maturity coming up. Considering retirement.",
    asking_price: 1600000,
    property_info: "8 units, 7 occupied, recent roof replacement",
    condition_notes: "Average condition, kitchens dated",
    objections: "Wants to see a number first before committing time",
    best_callback_time: "weekdays 10-15h",
    caller_summary: "Open to selling — wants offer in next 30 days. Mortgage maturity is the trigger. Talkative, will engage if Anthony presents a number.",
    recommended_action: "Anthony to call within 48h with a soft preliminary range",
    status: "pending",
  }).select("id").single();

  // 9. Review item
  await sb.from("review_items").insert({
    source_kind: "lead_submission",
    source_id: sub!.id,
    lead_id: lead!.id,
    contact_id: contact!.id,
    property_id: prop!.id,
    title: "Seed test → Gestion CML inc.",
    summary: "Open to selling — wants offer in next 30 days. Mortgage maturity is the trigger.",
    urgency: "urgent",
    status: "open",
  });

  // 10. Telegram alert (only fires if TELEGRAM_ANTHONY_CHAT_ID is set)
  const tg = await sendTelegramAlert(
`🔥 *Hot seller* — seed test

*Owner:* Gestion CML inc.
*Property:* ${stamp} rue Notre-Dame, Granby — 8 units, eval $1.45M
*Interest:* hot · timeline: 3 months · asking $1.6M

Open to selling — wants offer in next 30 days. Mortgage maturity is the trigger.`
  );

  // 11. Automation event
  await sb.from("automation_events").insert({
    source: "system",
    event_type: "dev_seed_submission",
    status: "success",
    related_lead_id: lead!.id,
    related_contact_id: contact!.id,
    related_property_id: prop!.id,
    triggered_by: user.id,
    payload: { stamp, campaignId: camp!.id, submissionId: sub!.id },
    result: { telegramSent: !!tg, telegramMessageId: tg?.message_id ?? null },
    telegram_message_id: tg?.message_id ?? null,
  });

  return NextResponse.json({
    ok: true,
    data: {
      campaignId: camp!.id, propertyId: prop!.id, contactId: contact!.id,
      leadId: lead!.id, callLogId: call!.id, submissionId: sub!.id,
      telegramSent: !!tg,
      hint: "Visit /review to see the seeded submission.",
    },
  });
}
