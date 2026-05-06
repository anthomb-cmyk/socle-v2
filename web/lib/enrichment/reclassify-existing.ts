// One-time backfill: re-run the v3 gate engine over every candidate already
// in the database, so the ~60+ pre-redesign candidates are reclassified into
// quarantined / weak_review / needs_anthony_review based on the new rules.
//
// Usage (server side only):
//   import { reclassifyAllPendingCandidates } from "@/lib/enrichment/reclassify-existing";
//   await reclassifyAllPendingCandidates(supabase);
//
// Strategy
//   - Pull every candidate whose status is one of needs_anthony_review,
//     candidate_found, validating_with_openclaw.
//   - For each, rebuild a synthetic Brave result from (snippet, source_url,
//     candidate_name → title) and re-evaluate.
//   - Update its status, gate_results, and source_class.
//   - Skip candidates the user has already approved/rejected — those are
//     human-decided and never overridden.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GateReport } from "./types";
import { runPreflight } from "./preflight";
import { evaluateBraveResult } from "./candidate-evaluator";

interface ReclassifyOptions {
  /** Skip Haiku G6 to keep cost predictable on a big backfill. */
  skipHaiku?: boolean;
  /** Hard limit (for staged rollout). */
  limit?: number;
}

interface ReclassifyResult {
  scanned: number;
  updated: number;
  skipped: number;
  byDisposition: Record<string, number>;
  errors: Array<{ candidateId: string; error: string }>;
}

const RECLASSIFIABLE_STATUSES = ["needs_anthony_review", "candidate_found", "validating_with_openclaw"] as const;

export async function reclassifyAllPendingCandidates(
  sb: SupabaseClient,
  opts: ReclassifyOptions = {},
): Promise<ReclassifyResult> {
  const out: ReclassifyResult = {
    scanned: 0, updated: 0, skipped: 0,
    byDisposition: {}, errors: [],
  };
  const limit = opts.limit ?? 500;

  type Row = {
    id: string;
    lead_id: string;
    contact_id: string;
    enrichment_job_id: string | null;
    snippet: string | null;
    source_url: string | null;
    candidate_name: string | null;
    candidate_status: string;
    leads: {
      contacts: {
        full_name: string | null;
        company_name: string | null;
        mailing_address: string | null;
        mailing_city: string | null;
        mailing_postal: string | null;
      } | null;
      properties: { address: string | null; city: string | null } | null;
    } | null;
  };

  const { data, error } = await sb
    .from("phone_candidates")
    .select(`
      id, lead_id, contact_id, enrichment_job_id, snippet, source_url, candidate_name, candidate_status,
      leads (
        contacts ( full_name, company_name, mailing_address, mailing_city, mailing_postal ),
        properties ( address, city )
      )
    `)
    .in("candidate_status", RECLASSIFIABLE_STATUSES as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    out.errors.push({ candidateId: "ALL", error: error?.message ?? "no data" });
    return out;
  }

  for (const r of data as unknown as Row[]) {
    out.scanned++;
    try {
      const ctx = r.leads ? {
        leadId: r.lead_id,
        contactId: r.contact_id,
        enrichmentJobId: r.enrichment_job_id ?? "",
        fullName: r.leads.contacts?.full_name ?? null,
        companyName: r.leads.contacts?.company_name ?? null,
        secondaryName: null,
        propertyAddress: r.leads.properties?.address ?? null,
        propertyCity: r.leads.properties?.city ?? null,
        mailingAddress: r.leads.contacts?.mailing_address ?? null,
        mailingCity: r.leads.contacts?.mailing_city ?? null,
        mailingPostal: r.leads.contacts?.mailing_postal ?? null,
        matricule: null,
        numUnits: null,
      } : null;

      if (!ctx) { out.skipped++; continue; }

      const preflight = runPreflight(ctx);
      // If preflight fails but we still have a candidate, we treat the
      // candidate as quarantined (lead is unsuitable). Update accordingly.
      if (!preflight.parsed) {
        await sb.from("phone_candidates").update({
          candidate_status: "quarantined",
          gate_results: {
            // Map a preflight failure onto G3 (address match) — preflight is
            // a precondition for any address gate to succeed, so this is the
            // semantically closest gate. The reason carries the full detail.
            outcomes: [{ gate: "G3_address_match", pass: false, reason: `preflight failed: ${preflight.failures.join(",")}` }],
            passed: false, firstFailure: "G3_address_match", disposition: "quarantined", score: 0,
          } satisfies Pick<GateReport, "outcomes"|"passed"|"firstFailure"|"disposition"|"score">,
          source_class: "web_other",
          review_reason: `Reclassified: lead failed preflight (${preflight.failures.join(",")})`,
        }).eq("id", r.id);
        out.updated++;
        out.byDisposition["quarantined_preflight"] = (out.byDisposition["quarantined_preflight"] ?? 0) + 1;
        continue;
      }

      // Synthesize a Brave-result-shaped object from the stored data.
      const title = r.candidate_name ?? "";
      const description = (r.snippet ?? "").replace(`${title}: `, "").slice(0, 400);
      const url = r.source_url ?? "";
      if (!url || (!title && !description)) { out.skipped++; continue; }

      const evald = await evaluateBraveResult({
        ctx,
        parsedAddress: preflight.parsed,
        result: { url, title, description },
        useHaiku: !opts.skipHaiku,
      });

      // Pick the best candidate. If extraction now produces nothing (fax/NEQ
      // detected after the fact), mark as pipeline_rejected.
      if (evald.candidates.length === 0) {
        await sb.from("phone_candidates").update({
          candidate_status: "pipeline_rejected",
          gate_results: {
            outcomes: [{ gate: "G1_phone_shape", pass: false, reason: "no phone re-extracted from snippet" }],
            passed: false, firstFailure: "G1_phone_shape", disposition: "pipeline_rejected", score: 0,
          } satisfies Pick<GateReport, "outcomes"|"passed"|"firstFailure"|"disposition"|"score">,
          source_class: evald.classification.sourceClass,
          review_reason: "Reclassified: no phone could be re-extracted",
        }).eq("id", r.id);
        out.updated++;
        out.byDisposition["pipeline_rejected_no_extraction"] = (out.byDisposition["pipeline_rejected_no_extraction"] ?? 0) + 1;
        continue;
      }

      const best = evald.candidates[0];
      const dispositionToStatus: Record<GateReport["disposition"], string> = {
        auto_attached:        "auto_attached",
        needs_anthony_review: "needs_anthony_review",
        weak_review:          "weak_review",
        quarantined:          "quarantined",
        pipeline_rejected:    "pipeline_rejected",
      };
      await sb.from("phone_candidates").update({
        candidate_status: dispositionToStatus[best.report.disposition],
        gate_results:     best.report,
        source_class:     best.classification.sourceClass,
        review_reason:    `Reclassified: ${best.report.disposition} (score ${best.report.score})`,
      }).eq("id", r.id);

      out.updated++;
      out.byDisposition[best.report.disposition] = (out.byDisposition[best.report.disposition] ?? 0) + 1;
    } catch (err) {
      out.errors.push({ candidateId: r.id, error: (err as Error).message });
    }
  }

  // Per-lead "candidates_reclassified" events are emitted by the API endpoint
  // that calls this function (it has the lead-set context). The function
  // itself returns the summary; the caller decides how to log it.
  return out;
}
