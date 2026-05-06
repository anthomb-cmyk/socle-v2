// Candidate evaluator (v3 enrichment redesign).
//
// Glues together: source classification → context-aware extraction → G1–G5
// → multiplicative scoring → optional Haiku G6. Produces a per-result decision
// the pipeline can record verbatim.

import type {
  LeadContext, ParsedAddress, GateOutcome, GateReport,
  PhoneExtractionResult, SourceClassification,
} from "./types";
import { classifyResult } from "./source-classifier";
import { extractPhonesWithContext } from "./phone-context-extractor";
import { runDeterministicGates, buildGateReport } from "./gates";
import { scoreCandidate, chooseDisposition } from "./scorer";
import { validateWithHaiku } from "./haiku-validator";

export interface EvaluatorInput {
  ctx: LeadContext;
  parsedAddress: ParsedAddress;
  result: { url: string; title: string; description: string };
  /** Whether to invoke G6 Haiku validation when G1–G5 pass. */
  useHaiku?: boolean;
}

export interface EvaluatedCandidate {
  // Final decision
  report: GateReport;
  // The phone (may be null if extraction yielded nothing)
  phone: PhoneExtractionResult | null;
  classification: SourceClassification;
  // Audit fields
  searchedSnippet: string;
  rejectedExtractions: Array<{ reason: string; rawDigits: string; window: string }>;
}

export interface EvaluatorResults {
  /** One evaluated candidate per phone discovered. May be empty if extraction yielded nothing. */
  candidates: EvaluatedCandidate[];
  /** Source classification (single per Brave result). */
  classification: SourceClassification;
}

export async function evaluateBraveResult(input: EvaluatorInput): Promise<EvaluatorResults> {
  const { ctx, parsedAddress, result } = input;
  const classification = classifyResult(result);

  const blob = `${result.title} ${result.description}`;
  // Strict area-code check on non-authoritative sources only.
  const strictAreaCode = classification.sourceClass !== "directory_authoritative" && classification.sourceClass !== "company_website";
  const extracted = extractPhonesWithContext(blob, { strictAreaCode });

  const candidates: EvaluatedCandidate[] = [];

  // If extraction produced nothing, still record one no-op evaluation so the
  // audit log shows we considered this URL.
  if (extracted.accepted.length === 0 && extracted.rejected.length === 0) {
    return { candidates, classification };
  }

  // Phone-shape rejections become pipeline_rejected entries the caller will
  // log for audit (they don't surface in review).
  if (extracted.accepted.length === 0 && extracted.rejected.length > 0) {
    // No accepted phones — but record the rejection set so the pipeline can
    // emit phone_extraction_rejected events.
    return {
      candidates: [{
        report: {
          outcomes: [{
            gate: "G1_phone_shape",
            pass: false,
            reason: `extractor rejected ${extracted.rejected.length} candidate(s): ${extracted.rejected.map(r => r.reason).join(",")}`,
            signal: { rejections: extracted.rejected },
          }],
          passed: false,
          firstFailure: "G1_phone_shape",
          disposition: "pipeline_rejected",
          score: 0,
        },
        phone: null,
        classification,
        searchedSnippet: blob,
        rejectedExtractions: extracted.rejected,
      }],
      classification,
    };
  }

  for (const phone of extracted.accepted) {
    const outcomes: GateOutcome[] = runDeterministicGates({
      parsedAddress,
      ctx,
      classification,
      phone,
      url: result.url,
      title: result.title,
      snippet: result.description,
    });

    const baseReport = buildGateReport(outcomes);

    if (!baseReport.passed) {
      candidates.push({
        report: {
          ...baseReport,
          disposition: "quarantined",
          score: 0,
        },
        phone,
        classification,
        searchedSnippet: blob,
        rejectedExtractions: extracted.rejected,
      });
      continue;
    }

    // G1–G5 passed. Compute deterministic score, then optionally call Haiku.
    const scoreOut = scoreCandidate({
      sourceClass: classification.sourceClass,
      domainHintApplied: classification.domainHintApplied,
      outcomes,
      phone,
    });

    let haiku: GateReport["haiku"] = undefined;
    if (input.useHaiku !== false) {
      const verdict = await validateWithHaiku({
        ctx,
        parsedAddress,
        phone: phone.display,
        url: result.url,
        title: result.title,
        snippet: result.description,
      });
      if (verdict) {
        haiku = {
          isOwnersPhone: verdict.isOwnersPhone,
          confidence: verdict.confidence,
          reasoning: verdict.reasoning,
          nameInSource: verdict.nameInSource,
          addressInSource: verdict.addressInSource,
        };
        outcomes.push({
          gate: "G6_haiku_validation",
          pass: verdict.isOwnersPhone && verdict.confidence >= 60,
          reason: verdict.reasoning || (verdict.isOwnersPhone ? "Haiku approves" : "Haiku rejects"),
          signal: { confidence: verdict.confidence, nameInSource: verdict.nameInSource, addressInSource: verdict.addressInSource },
        });
      }
    }

    const allPassed = outcomes.every(o => o.pass);
    const ownerHit = !!(outcomes.find(o => o.gate === "G4_owner_match")?.signal as Record<string, unknown> | undefined)?.ownerHit;
    // Pass gate outcomes so chooseDisposition can apply G6-aware auto-attach tuning.
    const disposition = chooseDisposition(allPassed, scoreOut.score, classification.sourceClass, ownerHit, outcomes);

    candidates.push({
      report: {
        outcomes,
        passed: allPassed,
        firstFailure: outcomes.find(o => !o.pass)?.gate ?? null,
        disposition,
        score: scoreOut.score,
        scoreFactors: scoreOut.factors,
        haiku,
      },
      phone,
      classification,
      searchedSnippet: blob,
      rejectedExtractions: extracted.rejected,
    });
  }

  return { candidates, classification };
}
