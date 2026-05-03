// OpenClaw — Stage 3 automated browser research + candidate validation.
//
// Role 1: Stage 3 deep research (primary role)
//   Called when address search AND company/person search both found nothing.
//   OpenClaw is an n8n workflow that uses a real browser to research the lead.
//
//   Research order (address-first):
//     1. Search mailing address → find businesses / people registered there
//     2. Check public B2BHint pages (no API — browser only) for related entities
//     3. Find related companies, directors, subsidiaries
//     4. Check company websites, public directories (411, Canada411, Pages Jaunes)
//     5. Stop as soon as a high-confidence phone is found
//
//   Callback: POST /api/enrichment/openclaw-callback
//
// Role 2: Candidate validation (low-confidence candidates from Stages 1–2)
//   Can be used to validate an uncertain candidate already found.
//   Callback: POST /api/enrichment/openclaw-callback with mode=validate_candidate.
//
// Required env:
//   OPENCLAW_WEBHOOK_URL  — n8n webhook URL for the OpenClaw workflow
//   N8N_SHARED_KEY        — shared bearer token (optional but recommended)
//
// If OPENCLAW_WEBHOOK_URL is not set, stage is skipped cleanly
// and the lead is marked unresolved_after_openclaw.

import type { LeadContext, OpenclawValidationResult, PhoneCandidate } from "./types";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

// ── Role 1: Stage 3 deep research ────────────────────────────────────────────

export async function requestOpenclawDeepSearch(
  ctx: LeadContext,
  priorCandidateIds: string[] = [],
): Promise<{ dispatched: boolean; reason?: string }> {
  const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL;
  if (!webhookUrl) {
    return { dispatched: false, reason: "OPENCLAW_WEBHOOK_URL not configured — Stage 3 skipped" };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.N8N_SHARED_KEY) {
    headers["Authorization"] = `Bearer ${process.env.N8N_SHARED_KEY}`;
  }

  // Compose the city/region string for search queries
  const city = ctx.mailingCity ?? ctx.propertyCity ?? null;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode:               "deep_search",
        lead_id:            ctx.leadId,
        enrichment_job_id:  ctx.enrichmentJobId,

        // Full context
        lead_context: {
          full_name:        ctx.fullName,
          company_name:     ctx.companyName,
          secondary_name:   ctx.secondaryName,
          property_address: ctx.propertyAddress,
          property_city:    ctx.propertyCity,
          mailing_address:  ctx.mailingAddress,
          mailing_city:     ctx.mailingCity,
          mailing_postal:   ctx.mailingPostal,
          matricule:        ctx.matricule,
          city,
        },

        // Stages already tried — don't repeat basic Brave searches
        stages_exhausted: ["address_search", "company_search"],

        // Prior candidates (low-confidence) for context
        prior_candidate_ids: priorCandidateIds,

        // ── Research instructions (address-first approach) ──────────────
        research_approach: "address_first",
        research_instructions: {
          priority_order: [
            "mailing_address",
            "property_address",
            "company_name_at_address",
            "related_entities",
            "public_directories",
          ],
          steps: [
            {
              step: 1,
              action: "address_lookup",
              description: "Search the mailing address first. Find any business, person, or organization registered or operating at this address. Use Google Maps, Canada411, Pages Jaunes, and Registraire des entreprises du Québec (REQ) public pages.",
              queries: [
                `"${ctx.mailingAddress ?? ctx.propertyAddress}" téléphone`,
                `"${ctx.mailingAddress ?? ctx.propertyAddress}" ${city ?? ""} téléphone`.trim(),
                `${ctx.companyName ?? ctx.fullName ?? ""} "${ctx.mailingAddress ?? ctx.propertyAddress}" téléphone`.trim(),
              ].filter(q => q.length > 5),
            },
            {
              step: 2,
              action: "public_b2bhint_check",
              description: "Check the PUBLIC B2BHint web page for the company or director (no API — use browser). B2BHint shows related companies, registered addresses, and sometimes phone numbers. URL pattern: https://b2bhint.com/en/company/<slug>. Search Google for '<company name> b2bhint' to find the page.",
              inspect_public_b2bhint_pages: true,
              note: "This is a public website — no API key needed. Just browse it like any other web page.",
            },
            {
              step: 3,
              action: "related_entity_expansion",
              description: "For each related company or director found at the address, search for their phone number using Brave/Google. Check REQ for the company's registered address and officers. Follow one level of related companies.",
              find_related_entities: true,
              entity_types_to_check: ["related_company", "same_address_company", "director", "subsidiary"],
            },
            {
              step: 4,
              action: "public_directory_search",
              description: "Search public phone directories: Canada411, Pages Jaunes, 411.ca, whitepages.ca. Search by company name and by personal name + city.",
              queries: [
                `${ctx.companyName ?? ""} ${city ?? ""} téléphone`.trim(),
                `${ctx.fullName ?? ""} ${city ?? ""} téléphone`.trim(),
              ].filter(q => q.length > 5),
            },
            {
              step: 5,
              action: "company_website",
              description: "If a company name is known, find their website and look for a contact/phone number on the Contact page, About page, or footer.",
            },
          ],
          stop_when: "high_confidence_phone_found (confidence >= 80)",
          return_with_confidence_below_80: true,
        },

        // ── Callback specification ──────────────────────────────────────
        callback_url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/enrichment/openclaw-callback`,
        // OpenClaw must include in callback:
        //   proposed_phone, owner_name, source_url, source_snippet,
        //   confidence, reasoning, matched_on, candidate_name, candidate_address,
        //   human_review_required, entities_searched
      }),
    });
    if (!res.ok) return { dispatched: false, reason: `OpenClaw webhook ${res.status}` };
    return { dispatched: true };
  } catch (err) {
    return { dispatched: false, reason: (err as Error).message };
  }
}

// ── Role 2: Validate a low-confidence candidate ───────────────────────────────

export async function requestOpenclawValidation(
  candidateId: string,
  candidate: PhoneCandidate,
  ctx: LeadContext,
): Promise<{ dispatched: boolean; reason?: string }> {
  const webhookUrl = process.env.OPENCLAW_WEBHOOK_URL;
  if (!webhookUrl) {
    return { dispatched: false, reason: "OPENCLAW_WEBHOOK_URL not configured — validation skipped" };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.N8N_SHARED_KEY) {
    headers["Authorization"] = `Bearer ${process.env.N8N_SHARED_KEY}`;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode:          "validate_candidate",
        candidate_id:  candidateId,
        lead_id:       ctx.leadId,
        phone_raw:     candidate.phoneRaw,
        phone_e164:    candidate.phoneE164,
        stage:         candidate.stage,
        matched_on:    candidate.matchedOn,
        snippet:       candidate.snippet,
        search_query:  candidate.searchQuery,
        lead_context: {
          full_name:        ctx.fullName,
          company_name:     ctx.companyName,
          secondary_name:   ctx.secondaryName,
          property_address: ctx.propertyAddress,
          property_city:    ctx.propertyCity,
          mailing_address:  ctx.mailingAddress,
          mailing_city:     ctx.mailingCity,
          mailing_postal:   ctx.mailingPostal,
        },
      }),
    });
    if (!res.ok) return { dispatched: false, reason: `OpenClaw webhook ${res.status}` };
    return { dispatched: true };
  } catch (err) {
    return { dispatched: false, reason: (err as Error).message };
  }
}

// ── Apply OpenClaw callback result ───────────────────────────────────────────
// Called by POST /api/enrichment/openclaw-callback.
// Updates the candidate status and queues for human review if needed.

export async function applyOpenclawValidation(
  candidateId: string,
  result: OpenclawValidationResult,
): Promise<void> {
  const sb = createSupabaseAdminClient();

  let newStatus: string;
  let reviewReason: string | null = null;

  switch (result.verdict) {
    case "likely_match":
      newStatus = "needs_anthony_review";
      reviewReason = "OpenClaw: likely match — needs human approval before attaching";
      break;
    case "uncertain":
      newStatus = "needs_anthony_review";
      reviewReason = "OpenClaw: uncertain — needs human judgement";
      break;
    case "unlikely_match":
      newStatus = "rejected_by_openclaw";
      break;
  }

  await sb.from("phone_candidates").update({
    openclaw_verdict:    result.verdict,
    openclaw_confidence: result.confidence,
    openclaw_evidence:   result.evidence,
    openclaw_reasoning:  result.reasoning,
    candidate_status:    newStatus,
    review_reason:       reviewReason,
  }).eq("id", candidateId);

  const { data: cand } = await sb
    .from("phone_candidates")
    .select("lead_id")
    .eq("id", candidateId)
    .single();

  if (!cand) return;
  const leadId = (cand as { lead_id: string }).lead_id;

  await sb.from("enrichment_events").insert({
    lead_id:      leadId,
    event_type:   "openclaw_validation_complete",
    stage:        "openclaw",
    candidate_id: candidateId,
    payload: {
      verdict:    result.verdict,
      confidence: result.confidence,
      new_status: newStatus,
    },
  });

  if (newStatus === "needs_anthony_review") {
    await sb.from("leads").update({ status: "needs_phone_review" }).eq("id", leadId);
    await sb.from("enrichment_events").insert({
      lead_id:      leadId,
      event_type:   "phone_candidate_needs_review",
      stage:        "openclaw",
      candidate_id: candidateId,
      payload:      { review_reason: reviewReason },
    });
  }
}
