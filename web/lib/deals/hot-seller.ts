import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDefaultChecklists } from "@/lib/deals/defaults";

type ReviewItemForDeal = {
  id: string;
  source_kind: string;
  source_id: string | null;
  lead_id: string | null;
  contact_id: string | null;
  property_id: string | null;
  title: string;
  summary: string | null;
  urgency: string;
};

type LeadSubmissionRow = {
  id: string;
  lead_id: string;
  call_log_id: string | null;
  outcome: string;
  seller_interest_level: string | null;
  timeline: string | null;
  motivation: string | null;
  asking_price: number | null;
  property_info: string | null;
  condition_notes: string | null;
  objections: string | null;
  best_callback_time: string | null;
  caller_summary: string;
  recommended_action: string | null;
  created_at: string;
};

type LeadSnapshotRow = {
  lead_id: string;
  contact_id: string | null;
  property_id: string | null;
  address: string | null;
  city: string | null;
  num_units: number | null;
  evaluation_total: number | null;
  full_name: string | null;
  company_name: string | null;
  best_phone: string | null;
};

type CallLogSnapshotRow = {
  id: string;
  outcome: string | null;
  notes: string | null;
  summary: string | null;
  transcript: string | null;
  recorded_at: string | null;
};

export type HotSellerDealAutomation = {
  dealId: string | null;
  followUpId: string | null;
  skippedReason?: string;
};

function textBlock(title: string, lines: Array<string | null | undefined>) {
  const body = lines
    .map((line) => line?.trim())
    .filter((line): line is string => Boolean(line));
  if (body.length === 0) return null;
  return `## ${title}\n${body.map((line) => `- ${line}`).join("\n")}`;
}

function compactText(text: string | null | undefined, max = 800) {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function timelineLabel(value: string | null) {
  const labels: Record<string, string> = {
    immediate: "immédiat",
    "3_months": "3 mois",
    "6_months": "6 mois",
    no_rush: "pas pressé",
    unknown: "inconnu",
  };
  return value ? labels[value] ?? value : null;
}

function buildTitle(item: ReviewItemForDeal, lead: LeadSnapshotRow | null) {
  const location = [lead?.address, lead?.city].filter(Boolean).join(", ");
  return location || item.title;
}

function buildAddress(lead: LeadSnapshotRow | null) {
  if (!lead?.address && !lead?.city) return null;
  return [lead.address, lead.city, lead.city ? "Québec" : null].filter(Boolean).join(", ");
}

function nextHotSellerDueAt() {
  const due = new Date();
  due.setHours(due.getHours() + 2);
  return due.toISOString();
}

export async function createHotSellerDealFromReview(
  sb: SupabaseClient,
  item: ReviewItemForDeal,
  approvedBy: string,
): Promise<HotSellerDealAutomation> {
  if (item.source_kind !== "lead_submission" || !item.source_id || !item.lead_id) {
    return { dealId: null, followUpId: null, skippedReason: "not_lead_submission" };
  }

  const { data: submission, error: submissionErr } = await sb
    .from("lead_submissions")
    .select("id,lead_id,call_log_id,outcome,seller_interest_level,timeline,motivation,asking_price,property_info,condition_notes,objections,best_callback_time,caller_summary,recommended_action,created_at")
    .eq("id", item.source_id)
    .maybeSingle();
  if (submissionErr) throw new Error(submissionErr.message);
  if (!submission) return { dealId: null, followUpId: null, skippedReason: "submission_missing" };

  const typedSubmission = submission as LeadSubmissionRow;

  const [leadRes, linkedCallRes, latestCallRes] = await Promise.all([
    sb
      .from("leads_view")
      .select("lead_id,contact_id,property_id,address,city,num_units,evaluation_total,full_name,company_name,best_phone")
      .eq("lead_id", item.lead_id)
      .maybeSingle(),
    typedSubmission.call_log_id
      ? sb
          .from("call_logs")
          .select("id,outcome,notes,summary,transcript,recorded_at")
          .eq("id", typedSubmission.call_log_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    sb
      .from("call_logs")
      .select("id,outcome,notes,summary,transcript,recorded_at")
      .eq("lead_id", item.lead_id)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (leadRes.error) throw new Error(leadRes.error.message);
  if (linkedCallRes.error) throw new Error(linkedCallRes.error.message);
  if (latestCallRes.error) throw new Error(latestCallRes.error.message);

  const lead = (leadRes.data ?? null) as LeadSnapshotRow | null;
  const callLog = ((linkedCallRes.data ?? latestCallRes.data) ?? null) as CallLogSnapshotRow | null;
  const now = new Date().toISOString();
  const ownerName = lead?.full_name ?? lead?.company_name ?? null;
  const temperature =
    item.urgency === "urgent" || typedSubmission.seller_interest_level === "hot" || typedSubmission.seller_interest_level === "wants_offer"
      ? "chaud"
      : "tiede";

  const notesDeal = [
    textBlock("Source revue", [
      item.summary ? `Résumé revue: ${item.summary}` : null,
      `Outcome caller: ${typedSubmission.outcome}`,
      typedSubmission.seller_interest_level ? `Intérêt vendeur: ${typedSubmission.seller_interest_level}` : null,
    ]),
    textBlock("Bâtiment", [
      lead?.address ? `Adresse: ${buildAddress(lead)}` : null,
      lead?.num_units != null ? `Unités: ${lead.num_units}` : null,
      lead?.evaluation_total != null ? `Évaluation municipale: ${lead.evaluation_total}` : null,
      typedSubmission.asking_price != null ? `Prix demandé mentionné: ${typedSubmission.asking_price}` : null,
      typedSubmission.property_info ? `Infos propriété: ${typedSubmission.property_info}` : null,
      typedSubmission.condition_notes ? `État/condition: ${typedSubmission.condition_notes}` : null,
    ]),
    textBlock("Notes caller", [
      typedSubmission.caller_summary,
      callLog?.notes ? `Notes appel: ${callLog.notes}` : null,
      callLog?.summary ? `Résumé transcript: ${callLog.summary}` : null,
    ]),
  ].filter(Boolean).join("\n\n");

  const notesVendeur = [
    textBlock("Motivation et timing", [
      ownerName ? `Vendeur: ${ownerName}` : null,
      typedSubmission.motivation ? `Motivation: ${typedSubmission.motivation}` : null,
      timelineLabel(typedSubmission.timeline) ? `Délai: ${timelineLabel(typedSubmission.timeline)}` : null,
      typedSubmission.best_callback_time ? `Meilleur moment rappel: ${typedSubmission.best_callback_time}` : null,
      typedSubmission.objections ? `Objections: ${typedSubmission.objections}` : null,
    ]),
    callLog?.transcript ? `## Transcript\n${compactText(callLog.transcript, 1400)}` : null,
  ].filter(Boolean).join("\n\n");

  const aiAnalysis = [
    textBlock("Synthèse vérifiable", [
      typedSubmission.recommended_action ? `Action recommandée par le caller: ${typedSubmission.recommended_action}` : null,
      callLog?.summary ? `Résumé appel: ${callLog.summary}` : null,
      callLog?.transcript ? "Transcript lié au dossier: oui" : "Transcript lié au dossier: non",
    ]),
  ].filter(Boolean).join("\n\n");

  const activities = [{
    id: crypto.randomUUID(),
    text: "Deal créé depuis hot seller approuvé",
    time: now,
    by: approvedBy,
    source: "review_item",
    reviewItemId: item.id,
    submissionId: typedSubmission.id,
    leadId: item.lead_id,
    callLogId: callLog?.id ?? typedSubmission.call_log_id,
  }];

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .insert({
      title: buildTitle(item, lead),
      stage: "analyse",
      address: buildAddress(lead),
      units: lead?.num_units ?? null,
      asking_price: typedSubmission.asking_price ?? null,
      temperature,
      priority: item.urgency === "urgent" ? "high" : "medium",
      contact_name: ownerName,
      contact_phone: lead?.best_phone ?? null,
      notes_deal: notesDeal || null,
      notes_vendeur: notesVendeur || null,
      ai_analysis: aiAnalysis || null,
      next_action: typedSubmission.recommended_action ?? "Confirmer prix, revenus, dépenses et motivation du vendeur.",
      checklists: buildDefaultChecklists("analyse"),
      activities,
      assigned_to: approvedBy,
    })
    .select("id")
    .single();

  if (dealErr) throw new Error(dealErr.message);
  const dealId = (deal as { id: string }).id;

  const { data: followUp } = await sb
    .from("follow_ups")
    .insert({
      lead_id: item.lead_id,
      contact_id: item.contact_id ?? lead?.contact_id ?? null,
      due_at: nextHotSellerDueAt(),
      note: `Appeler le vendeur pour le deal ${buildTitle(item, lead)}.`,
      priority: item.urgency === "urgent" ? 90 : 70,
      status: "pending",
      assigned_to: approvedBy,
      created_by: approvedBy,
      source: "review_approval",
      sync_status: "disabled",
      sync_target: "none",
    })
    .select("id")
    .maybeSingle();

  await sb
    .from("lead_submissions")
    .update({
      status: "accepted",
      reviewed_by: approvedBy,
      reviewed_at: now,
      review_notes: `Deal créé: ${dealId}`,
    })
    .eq("id", typedSubmission.id);

  return {
    dealId,
    followUpId: followUp ? (followUp as { id: string }).id : null,
  };
}
