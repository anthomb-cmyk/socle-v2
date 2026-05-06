// Call-queue audit (v3 enrichment redesign — Phase 4 backfill).
//
// Purpose
//   Re-validate every phone that the OLD enrichment system promoted to
//   "callable" status (lead.status = 'ready_to_call'). The old additive
//   scorer let phones through with weak signals (city match + postal-prefix);
//   we now have the v3 gate engine and want to apply it retroactively.
//
// Strategy
//   For each lead in ready_to_call:
//     1. Find every phone for the contact whose source is enrichment-derived
//        (brave, google_places, pages_jaunes, 411ca, enrichment_other).
//        Trusted sources (role, file, manual, caller_verified) are NEVER
//        audited — those came from the homeowner roll or a human.
//     2. For each enrichment-derived phone, find the originating
//        phone_candidates row (by contact_id + e164) and re-run preflight +
//        the v3 gate engine over its stored snippet/url.
//     3. If the new disposition is quarantined / pipeline_rejected:
//          - phone.status → 'wrong_person'
//          - phone_candidates.candidate_status → 'pipeline_rejected'
//          - phone_candidates.gate_results → the new audit report
//        If !dryRun, persist; otherwise just collect what would change.
//     4. After processing all phones for a contact, if NO phone with status
//        in (unverified, valid, verified) remains, transition the lead's
//        status from ready_to_call → needs_phone_review (so the user can
//        manually decide whether to re-enrich, mark unsuitable, or accept).
//
// Defensive choices
//   - Never deletes phone rows. Always demotes via status change.
//   - Never deletes lead rows. Only changes lead.status.
//   - Skips contacts whose mailing address can't be parsed (the lead is
//     already in a bad state — we can't reliably audit a phone we couldn't
//     have validated in the first place; logged for review).
//   - Haiku is OFF by default to keep the audit cheap. Pass useHaiku=true
//     for a slower but stronger pass.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GateReport } from "./types";
import { runPreflight } from "./preflight";
import { evaluateBraveResult } from "./candidate-evaluator";

export interface AuditCallQueueOptions {
  /** Don't write anything; just produce the report. */
  dryRun?: boolean;
  /** Cap on number of leads to audit (rolling). */
  limit?: number;
  /** When true, also send each candidate through Haiku G6. Costs money + latency. */
  useHaiku?: boolean;
}

export interface AuditCallQueueResult {
  scanned_leads: number;
  scanned_phones: number;
  /** Phones that would be (or were) demoted to status='wrong_person' */
  demoted_phones: number;
  /** Leads whose status would be (or was) transitioned out of ready_to_call */
  transitioned_leads: number;
  /** Leads we skipped because their mailing address couldn't be parsed */
  skipped_unparseable_mailing: number;
  /** Phones we couldn't audit because no originating candidate row exists */
  skipped_no_candidate: number;
  /** Counts by reason — which gate failed */
  by_failure_gate: Record<string, number>;
  /** Per-disposition summary of what the v3 gates would emit now */
  by_new_disposition: Record<string, number>;
  /** First N concrete examples — useful for spot-checking before re-running with dryRun=false */
  samples: Array<{
    leadId: string;
    contactName: string;
    propertyAddress: string;
    phoneE164: string;
    phoneSource: string;
    sourceUrl: string | null;
    candidateName: string | null;
    oldDisposition: string;
    newDisposition: GateReport["disposition"];
    firstFailedGate: string | null;
    reason: string;
  }>;
  errors: Array<{ leadId: string; message: string }>;
}

const TRUSTED_PHONE_SOURCES = new Set(["role", "file", "manual", "caller_verified"]);
const TRUSTWORTHY_PHONE_STATUSES = new Set(["unverified", "valid", "verified"]);
const SAMPLE_LIMIT = 50;

interface LeadRow {
  id: string;
  contact_id: string;
  status: string;
  contacts: {
    id: string;
    full_name: string | null;
    company_name: string | null;
    mailing_address: string | null;
    mailing_city: string | null;
    mailing_postal: string | null;
  } | null;
  properties: { address: string | null; city: string | null; num_units: number | null } | null;
}

interface PhoneRow {
  id: string;
  contact_id: string;
  e164: string;
  display: string;
  status: string;
  source: string;
  confidence: number;
}

interface CandidateRow {
  id: string;
  phone_e164: string;
  snippet: string | null;
  source_url: string | null;
  candidate_name: string | null;
  source_label: string | null;
  candidate_status: string;
  gate_results: GateReport | null;
}

export async function auditCallQueue(
  sb: SupabaseClient,
  opts: AuditCallQueueOptions = {},
): Promise<AuditCallQueueResult> {
  const result: AuditCallQueueResult = {
    scanned_leads: 0,
    scanned_phones: 0,
    demoted_phones: 0,
    transitioned_leads: 0,
    skipped_unparseable_mailing: 0,
    skipped_no_candidate: 0,
    by_failure_gate: {},
    by_new_disposition: {},
    samples: [],
    errors: [],
  };

  const limit = opts.limit ?? 500;
  const dryRun = opts.dryRun ?? true;

  // 1. Pull every lead currently in ready_to_call along with its contact + property
  const { data: leadsRaw, error: leadsErr } = await sb
    .from("leads")
    .select(`
      id, contact_id, status,
      contacts ( id, full_name, company_name, mailing_address, mailing_city, mailing_postal ),
      properties ( address, city, num_units )
    `)
    .eq("status", "ready_to_call")
    .limit(limit);

  if (leadsErr || !leadsRaw) {
    result.errors.push({ leadId: "ALL", message: leadsErr?.message ?? "no leads returned" });
    return result;
  }
  const leads = leadsRaw as unknown as LeadRow[];

  for (const lead of leads) {
    result.scanned_leads++;
    if (!lead.contacts) continue;

    try {
      const ctx = {
        leadId: lead.id,
        contactId: lead.contact_id,
        enrichmentJobId: "audit",
        fullName: lead.contacts.full_name,
        companyName: lead.contacts.company_name,
        secondaryName: null,
        propertyAddress: lead.properties?.address ?? null,
        propertyCity: lead.properties?.city ?? null,
        mailingAddress: lead.contacts.mailing_address,
        mailingCity: lead.contacts.mailing_city,
        mailingPostal: lead.contacts.mailing_postal,
        matricule: null,
        numUnits: lead.properties?.num_units ?? null,
      };

      const preflight = runPreflight(ctx);
      if (!preflight.ok || !preflight.parsed) {
        // Lead is in ready_to_call but its mailing address is unusable.
        // We can't audit a phone for a lead with a bad address; flag the lead.
        result.skipped_unparseable_mailing++;
        if (!dryRun) {
          await sb.from("leads").update({ status: "unsuitable_for_phone_enrichment" }).eq("id", lead.id);
          result.transitioned_leads++;
          await sb.from("enrichment_events").insert({
            lead_id: lead.id,
            event_type: "lead_status_updated",
            payload: { from: "ready_to_call", to: "unsuitable_for_phone_enrichment", reason: "audit: mailing unparseable", failures: preflight.failures },
          });
        }
        continue;
      }

      // 2. Pull all enrichment-derived phones for this contact
      const { data: phones, error: phonesErr } = await sb
        .from("phones")
        .select("id, contact_id, e164, display, status, source, confidence")
        .eq("contact_id", lead.contact_id);
      if (phonesErr || !phones) continue;
      const phoneRows = phones as PhoneRow[];

      const auditable = phoneRows.filter(p =>
        !TRUSTED_PHONE_SOURCES.has(p.source) &&
        TRUSTWORTHY_PHONE_STATUSES.has(p.status)
      );

      const demotedThisLead = new Set<string>();

      for (const phone of auditable) {
        result.scanned_phones++;

        // 3. Find the originating candidate row (by contact_id + e164)
        const { data: candRows } = await sb
          .from("phone_candidates")
          .select("id, phone_e164, snippet, source_url, candidate_name, source_label, candidate_status, gate_results")
          .eq("contact_id", lead.contact_id)
          .eq("phone_e164", phone.e164)
          .order("created_at", { ascending: false })
          .limit(1);

        const cand = (candRows?.[0] as CandidateRow | undefined);
        if (!cand) {
          result.skipped_no_candidate++;
          continue;
        }

        // 4. Re-run gates over the candidate's stored snippet/url
        const url = cand.source_url ?? "";
        const title = cand.candidate_name ?? "";
        const description = (cand.snippet ?? "").replace(`${title}: `, "").slice(0, 500);

        if (!url && !title && !description) {
          // No evidence to re-audit; conservatively demote.
          demotedThisLead.add(phone.e164);
          recordDemotion(result, lead, phone, cand, "quarantined", "no evidence stored", "G2_source_class");
          if (!dryRun) await applyDemotion(sb, lead, phone, cand, null);
          continue;
        }

        let evald;
        try {
          evald = await evaluateBraveResult({
            ctx,
            parsedAddress: preflight.parsed,
            result: { url, title, description },
            useHaiku: opts.useHaiku ?? false,
          });
        } catch (err) {
          result.errors.push({ leadId: lead.id, message: `evaluate failed for ${phone.e164}: ${(err as Error).message}` });
          continue;
        }

        // Pick the best candidate this URL+snippet would have produced today.
        // If extraction now finds nothing, treat as pipeline_rejected.
        const best = evald.candidates[0];
        const newDisposition: GateReport["disposition"] = best?.report.disposition ?? "pipeline_rejected";
        result.by_new_disposition[newDisposition] = (result.by_new_disposition[newDisposition] ?? 0) + 1;

        const isFail = newDisposition === "quarantined" || newDisposition === "pipeline_rejected" || newDisposition === "weak_review";

        if (isFail) {
          demotedThisLead.add(phone.e164);
          const failedGate = best?.report.firstFailure ?? "G2_source_class";
          const reason = best?.report.outcomes.find(o => !o.pass)?.reason ?? "no candidate produced by re-evaluation";
          recordDemotion(result, lead, phone, cand, newDisposition, reason, failedGate);
          if (!dryRun) await applyDemotion(sb, lead, phone, cand, best?.report ?? null);
        }
      }

      // 5. After demotions, check whether any callable phone remains
      if (demotedThisLead.size > 0) {
        const remaining = phoneRows.filter(p =>
          TRUSTWORTHY_PHONE_STATUSES.has(p.status) && !demotedThisLead.has(p.e164)
        );
        if (remaining.length === 0) {
          if (!dryRun) {
            await sb.from("leads").update({ status: "needs_phone_review" }).eq("id", lead.id);
            await sb.from("enrichment_events").insert({
              lead_id: lead.id,
              event_type: "lead_status_updated",
              payload: { from: "ready_to_call", to: "needs_phone_review", reason: "audit: all phones demoted", demoted_count: demotedThisLead.size },
            });
          }
          result.transitioned_leads++;
        }
      }
    } catch (err) {
      result.errors.push({ leadId: lead.id, message: (err as Error).message });
    }
  }

  return result;
}

function recordDemotion(
  result: AuditCallQueueResult,
  lead: LeadRow,
  phone: PhoneRow,
  cand: CandidateRow,
  newDisposition: GateReport["disposition"],
  reason: string,
  failedGate: string,
) {
  result.demoted_phones++;
  result.by_failure_gate[failedGate] = (result.by_failure_gate[failedGate] ?? 0) + 1;
  if (result.samples.length < SAMPLE_LIMIT) {
    result.samples.push({
      leadId: lead.id,
      contactName: lead.contacts?.full_name ?? lead.contacts?.company_name ?? "(unknown)",
      propertyAddress: `${lead.properties?.address ?? ""} ${lead.properties?.city ?? ""}`.trim(),
      phoneE164: phone.e164,
      phoneSource: phone.source,
      sourceUrl: cand.source_url,
      candidateName: cand.candidate_name,
      oldDisposition: cand.candidate_status,
      newDisposition,
      firstFailedGate: failedGate,
      reason,
    });
  }
}

async function applyDemotion(
  sb: SupabaseClient,
  lead: LeadRow,
  phone: PhoneRow,
  cand: CandidateRow,
  newReport: GateReport | null,
) {
  // Mark the phone row as wrong_person — it's no longer a callable number.
  await sb.from("phones").update({
    status: "wrong_person",
    notes: `Demoted by v3 audit on ${new Date().toISOString()} — failing gate: ${newReport?.firstFailure ?? "no_evidence"}`,
  }).eq("id", phone.id);

  // Mark the originating candidate as pipeline_rejected with the new gate report.
  await sb.from("phone_candidates").update({
    candidate_status: "pipeline_rejected",
    gate_results: newReport ?? {
      outcomes: [{ gate: "G2_source_class", pass: false, reason: "no evidence stored" }],
      passed: false,
      firstFailure: "G2_source_class",
      disposition: "pipeline_rejected",
      score: 0,
    },
    review_reason: `Audited by v3 gate engine — demoted from auto_attached to pipeline_rejected`,
  }).eq("id", cand.id);

  // Append an audit event so the trail is queryable.
  await sb.from("enrichment_events").insert({
    lead_id: lead.id,
    event_type: "candidate_pipeline_rejected",
    candidate_id: cand.id,
    payload: {
      audit: true,
      phone_e164: phone.e164,
      old_status: cand.candidate_status,
      new_disposition: newReport?.disposition ?? "pipeline_rejected",
      failed_gate: newReport?.firstFailure ?? "G2_source_class",
    },
  });
}
