// Multiplicative scorer (v3 enrichment redesign).
//
// Replaces the additive base-40 scorer. A weak factor multiplies the others
// and drags the final score down — so a hit with weak source authority OR
// weak address match OR weak name match never crosses 80.
//
// Inputs:
//   - sourceClass (Layer C result)
//   - gate outcomes (G3 address evidence, G4 name evidence)
//   - phone authority (in-region vs out-of-region)
//
// Output:
//   - score 0–100
//   - per-factor breakdown for audit

import type { GateOutcome, PhoneExtractionResult, SourceClass } from "./types";

// Re-export GateOutcome for external callers that import from scorer.
export type { GateOutcome };

export interface ScoreInput {
  sourceClass: SourceClass;
  domainHintApplied: boolean;
  outcomes: GateOutcome[];
  phone: PhoneExtractionResult;
}

export interface ScoreOutput {
  score: number;
  factors: { source: number; address: number; name: number; phoneAuthority: number };
}

// Per-factor weights; each in [0.3, 1.0] so a weak factor materially drops the score.
const SOURCE_WEIGHT: Record<SourceClass, number> = {
  directory_authoritative: 1.0,
  company_website: 1.0,
  social: 0.65,
  web_other: 0.55,
  directory_aggregate: 0.3,
  bulk_document: 0.3,
  commerce_unrelated: 0.3,
  municipal_or_institutional: 0.3,
};

export function scoreCandidate(input: ScoreInput): ScoreOutput {
  const sourceFactor = SOURCE_WEIGHT[input.sourceClass] ?? 0.5;

  // Address factor: derived from G3 outcome's signal payload.
  const g3 = input.outcomes.find(o => o.gate === "G3_address_match");
  const addressFactor = (() => {
    const sig = g3?.signal as Record<string, unknown> | undefined;
    if (!g3 || !g3.pass) return 0.5;
    const civicHit = !!sig?.civicHit;
    const streetHit = !!sig?.streetHit;
    const postalHitFull = !!sig?.postalHitFull;
    if (civicHit && streetHit && postalHitFull) return 1.0;
    if (civicHit && streetHit) return 0.9;
    if (civicHit && postalHitFull) return 0.85;
    if (postalHitFull) return 0.7;
    return 0.6;
  })();

  // Name factor: derived from G4 outcome's signal payload.
  const g4 = input.outcomes.find(o => o.gate === "G4_owner_match");
  const nameFactor = (() => {
    const sig = g4?.signal as Record<string, unknown> | undefined;
    if (!g4 || !g4.pass) return 0.4;
    const ownerHit = !!sig?.ownerHit;
    const companyHits = typeof sig?.companyHits === "number" ? sig.companyHits as number : 0;
    if (ownerHit && companyHits >= 2) return 1.0;
    if (ownerHit) return 0.9;
    if (companyHits >= 3) return 0.9;
    if (companyHits >= 2) return 0.75;
    if (companyHits >= 1 && (input.sourceClass === "directory_authoritative" || input.sourceClass === "company_website")) return 0.7;
    return 0.55;
  })();

  // Phone authority: in-region area code is full credit; out-of-region halves
  // unless the source is authoritative.
  const phoneFactor = input.phone.isInRegion
    ? 1.0
    : (input.sourceClass === "directory_authoritative" || input.sourceClass === "company_website")
      ? 0.85
      : 0.5;

  // Multiplicative score, scaled so all-1.0 → 100, all-0.5 → ~6.
  const product = sourceFactor * addressFactor * nameFactor * phoneFactor;
  // Use a sqrt curve so middling factors don't crash the score too aggressively.
  const score = Math.round(Math.sqrt(product) * 100);

  return {
    score,
    factors: {
      source: round2(sourceFactor),
      address: round2(addressFactor),
      name: round2(nameFactor),
      phoneAuthority: round2(phoneFactor),
    },
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Decide candidate disposition from the score + gate report.
 *
 * Gate outcomes are passed through so the G6 Haiku verdict can promote
 * borderline (score ≥ 70) candidates from review → auto_attached when
 * Haiku has high confidence.
 */
export function chooseDisposition(
  allGatesPassed: boolean,
  score: number,
  sourceClass: SourceClass,
  ownerNameHit: boolean,
  gateOutcomes?: GateOutcome[],
): "auto_attached" | "needs_anthony_review" | "weak_review" | "quarantined" {
  if (!allGatesPassed) return "quarantined";

  // Auto-attach only with high score + authoritative source + owner-name hit.
  if (score >= 85 && (sourceClass === "directory_authoritative" || sourceClass === "company_website") && ownerNameHit) {
    return "auto_attached";
  }

  // G6-aware promotion: if score >= 70 AND Haiku approved with confidence >= 85,
  // trust Haiku's full-snippet verdict and auto-attach.
  if (score >= 70 && gateOutcomes) {
    const g6 = gateOutcomes.find(o => o.gate === "G6_haiku_validation");
    if (g6 && g6.pass) {
      const sig = g6.signal as Record<string, unknown> | undefined;
      const haikuConf = typeof sig?.confidence === "number" ? sig.confidence as number : 0;
      if (haikuConf >= 85) {
        return "auto_attached";
      }
    }
  }

  if (score >= 70) return "needs_anthony_review";
  if (score >= 50) return "weak_review";
  return "quarantined";
}
