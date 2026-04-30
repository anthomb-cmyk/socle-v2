// POST /api/submissions — caller submits a hot/qualified lead to Anthony.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { sendTelegramAlert } from "@/lib/telegram";

const Body = z.object({
  leadId: z.string().uuid(),
  callLogId: z.string().uuid().nullable().optional(),
  outcome: z.enum([
    "no_answer", "voicemail_left", "wrong_number", "bad_number",
    "not_interested", "maybe_later", "already_sold",
    "wants_more_info", "open_to_selling", "wants_offer",
    "hot_seller", "follow_up_booked", "do_not_contact",
  ]),
  sellerInterestLevel: z.enum(["cold", "warm", "hot", "wants_offer"]).optional(),
  timeline: z.enum(["immediate", "3_months", "6_months", "no_rush", "unknown"]).optional(),
  motivation: z.string().nullable().optional(),
  askingPrice: z.number().nullable().optional(),
  propertyInfo: z.string().nullable().optional(),
  conditionNotes: z.string().nullable().optional(),
  objections: z.string().nullable().optional(),
  bestCallbackTime: z.string().nullable().optional(),
  callerSummary: z.string().min(5),
  recommendedAction: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  let body;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ ok: false, error: "Bad input", errors: (err as z.ZodError).issues }, { status: 400 });
  }

  const sb = createSupabaseAdminClient();

  // Verify lead access
  const { data: lead } = await sb.from("leads").select("id, assigned_to, contact_id, property_id").eq("id", body.leadId).single();
  if (!lead) return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });
  if (auth.role !== "admin" && lead.assigned_to !== user.id) {
    return NextResponse.json({ ok: false, error: "Not your lead" }, { status: 403 });
  }

  // Lead snapshot for the alert
  const { data: snap } = await sb.from("leads_view").select("address, city, full_name, company_name, num_units, best_phone, campaign_name").eq("lead_id", body.leadId).single();

  // Insert submission
  const { data: sub, error: subErr } = await sb.from("lead_submissions").insert({
    lead_id: body.leadId,
    call_log_id: body.callLogId ?? null,
    submitted_by: user.id,
    outcome: body.outcome,
    seller_interest_level: body.sellerInterestLevel ?? null,
    timeline: body.timeline ?? null,
    motivation: body.motivation ?? null,
    asking_price: body.askingPrice ?? null,
    property_info: body.propertyInfo ?? null,
    condition_notes: body.conditionNotes ?? null,
    objections: body.objections ?? null,
    best_callback_time: body.bestCallbackTime ?? null,
    caller_summary: body.callerSummary,
    recommended_action: body.recommendedAction ?? null,
    status: "pending",
  }).select("id").single();
  if (subErr) return NextResponse.json({ ok: false, error: subErr.message }, { status: 500 });

  // Decide urgency
  const urgency =
    body.sellerInterestLevel === "wants_offer" || body.outcome === "wants_offer" ? "urgent" :
    body.sellerInterestLevel === "hot" || body.outcome === "hot_seller" ? "urgent" :
    body.outcome === "open_to_selling" || body.outcome === "follow_up_booked" ? "high" : "normal";

  // Submitter display name
  const { data: submitterMeta } = await sb.from("users_meta").select("display_name").eq("user_id", user.id).single();
  const submitterName = submitterMeta?.display_name ?? user.email ?? "Unknown";

  const title = `${submitterName} → ${snap?.full_name ?? snap?.company_name ?? "lead"}`;
  const summary = body.callerSummary.slice(0, 200);

  // Create review_item for Anthony's inbox
  await sb.from("review_items").insert({
    source_kind: "lead_submission",
    source_id: sub!.id,
    lead_id: body.leadId,
    contact_id: lead.contact_id,
    property_id: lead.property_id,
    title,
    summary,
    urgency,
    status: "open",
  });

  // Audit + Telegram for urgent submissions
  let telegramMessageId: string | null = null;
  let telegramError: string | null = null;
  if (urgency === "urgent" || urgency === "high") {
    const alertTitle = urgency === "urgent" ? "HOT SELLER SUBMITTED" : "PROMISING LEAD SUBMITTED";
    const owner   = snap?.full_name ?? snap?.company_name ?? "Unknown";
    const address = snap?.address ?? "Unknown";
    const city    = snap?.city ?? "Unknown";
    const appUrl  = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:8985";

    const lines: string[] = [
      "🚨🚨 NEW LEAD!! 🚨🚨",
      alertTitle,
      "",
      `Caller: ${submitterName}`,
      `Owner: ${owner}`,
      `Property: ${address}`,
    ];
    if (snap?.num_units)        lines.push(`Units: ${snap.num_units}`);
    lines.push(`City: ${city}`);
    if (snap?.best_phone)       lines.push(`Phone: ${snap.best_phone}`);
    lines.push(`Outcome: ${body.sellerInterestLevel ?? body.outcome}`);
    if (body.timeline)          lines.push(`Timeline: ${body.timeline}`);
    if (body.askingPrice != null) lines.push(`Asking: $${body.askingPrice.toLocaleString()}`);
    lines.push("", `Summary:\n${summary}`);
    lines.push("", `Open in CRM:\n${appUrl}/review`);

    const text = lines.join("\n");
    const tg = await sendTelegramAlert(text);
    if (tg.ok) {
      telegramMessageId = tg.message_id;
    } else {
      telegramError = tg.error;
      console.error("[submissions] Telegram alert failed:", tg.error);
    }
  }

  await sb.from("automation_events").insert({
    source: "web_app",
    event_type: "lead_submission_created",
    status: "success",
    related_lead_id: body.leadId,
    related_contact_id: lead.contact_id,
    related_property_id: lead.property_id,
    triggered_by: user.id,
    telegram_message_id: telegramMessageId,
    error_message: telegramError,
    payload: { submissionId: sub!.id, outcome: body.outcome, urgency },
    result: { telegramSent: !!telegramMessageId, telegramError },
  });

  return NextResponse.json({ ok: true, data: { submissionId: sub!.id, urgency, telegramSent: !!telegramMessageId } });
}
