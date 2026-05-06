// Layer E — Candidate gate engine (v3 enrichment redesign).
//
// A candidate must pass G1–G5 (deterministic) before G6 (Haiku) is invoked.
// Any failure → quarantine (not shown by default in /phone-review).
//
// G1 phone-shape       — Layer D produced a clean E.164 (NEQ/fax/area-code OK)
// G2 source-class      — Source is allowlisted (authoritative or social w/ extras)
// G3 address-match     — Source contains the exact civic number + street stem
//                          OR strong owner-name match
// G4 owner-name        — Owner last name OR ≥2 distinctive company tokens present
// G5 negative-signals  — No "résidence/CHSLD/RPA/locataire" markers when owner is Inc
// G6 haiku-validation  — LLM final gate (only invoked when G1–G5 pass)

import type {
  GateOutcome, GateReport, GateName, ParsedAddress,
  SourceClassification, LeadContext, PhoneExtractionResult,
} from "./types";
import { foldText } from "./address-parser";
import { isAllowedSourceClass, isHardDenySourceClass } from "./source-classifier";

export interface GateInput {
  parsedAddress: ParsedAddress;
  ctx: LeadContext;
  classification: SourceClassification;
  phone: PhoneExtractionResult;
  url: string;
  title: string;
  snippet: string;
}

// ── G1 — phone shape ─────────────────────────────────────────────────────────
// The extractor already rejected NEQ / fax / matricule-shaped numbers. If we
// got a PhoneExtractionResult here, G1 passed. We only re-check the area-code
// rule for non-authoritative sources.

export function evaluateG1(input: GateInput): GateOutcome {
  const isAuthoritative = input.classification.sourceClass === "directory_authoritative" || input.classification.sourceClass === "company_website";
  if (!input.phone.isInRegion && !isAuthoritative) {
    return { gate: "G1_phone_shape", pass: false, reason: `out-of-region area code (${input.phone.e164.slice(2,5)}) on non-authoritative source`, signal: { areaCode: input.phone.e164.slice(2,5) } };
  }
  return { gate: "G1_phone_shape", pass: true, reason: "valid NANP, in-region or authoritative source" };
}

// ── G2 — source class ────────────────────────────────────────────────────────

export function evaluateG2(input: GateInput): GateOutcome {
  const c = input.classification.sourceClass;
  if (isHardDenySourceClass(c)) {
    return { gate: "G2_source_class", pass: false, reason: `source class "${c}" is hard-denied (${input.classification.reason})`, signal: { sourceClass: c, host: input.classification.host } };
  }
  if (!isAllowedSourceClass(c)) {
    return { gate: "G2_source_class", pass: false, reason: `source class "${c}" not allowlisted`, signal: { sourceClass: c } };
  }
  return { gate: "G2_source_class", pass: true, reason: `source class "${c}"`, signal: { sourceClass: c, host: input.classification.host } };
}

// ── G3 — address match ───────────────────────────────────────────────────────

export function evaluateG3(input: GateInput): GateOutcome {
  const civic = input.parsedAddress.civicNumber ?? "";
  const street = input.parsedAddress.streetName ?? "";
  const postal = input.parsedAddress.postal ?? "";
  const blob = foldText(`${input.title} ${input.snippet} ${input.url}`);
  const streetFolded = foldText(street);

  // Take the most distinctive 2 words of the street (after dropping prefix words like "rue", "avenue", "boulevard").
  const streetTokens = streetFolded.split(/\s+/).filter(t => t.length > 2 && !/^(rue|avenue|av|boul|boulevard|chemin|ch|place|pl|terrasse|allee|all[eé]e|montee|mont[eé]e|cote|cot[eé]|impasse|rang|route|rt)$/.test(t));
  const distinctiveStreet = streetTokens.slice(0, 2).join(" ");

  // Civic must appear AS A WHOLE NUMBER (not as a substring of a larger digit run).
  // Use a word-boundary-ish check on both sides. We do this in the unfolded blob
  // because folding doesn't change digits.
  const civicRe = civic ? new RegExp(`(?:^|[^0-9])${civic}(?:[^0-9]|$)`) : null;
  const civicHit = civicRe ? civicRe.test(blob) : false;
  const streetHit = distinctiveStreet ? blob.includes(distinctiveStreet) : false;
  const postalFolded = postal.toLowerCase().replace(/\s/g, "");
  const blobFolded = blob.replace(/\s/g, "");
  const postalHitFull = postalFolded.length === 6 && blobFolded.includes(postalFolded);

  // Strong address: civic + street tokens.
  const strongAddress = civicHit && streetHit;
  // Strong postal: full 6-char postal present.
  const strongPostal = postalHitFull;

  // Owner-name match path — let G3 pass if we have a strong owner-name signal
  // even when civic+street aren't both present. G4 will still require name match.
  const ownerLast = ownerLastName(input.ctx).toLowerCase();
  const ownerHit = Boolean(ownerLast && ownerLast.length >= 4 && blob.includes(ownerLast));

  if (strongAddress) {
    return { gate: "G3_address_match", pass: true, reason: "civic + distinctive street tokens present", signal: { civicHit, streetTokens: distinctiveStreet, postalHitFull } };
  }
  if (strongPostal && ownerHit) {
    return { gate: "G3_address_match", pass: true, reason: "full postal + owner name present", signal: { postalHitFull, ownerHit } };
  }
  if (civicHit && strongPostal) {
    return { gate: "G3_address_match", pass: true, reason: "civic + full postal present", signal: { civicHit, postalHitFull } };
  }
  return {
    gate: "G3_address_match",
    pass: false,
    reason: `weak address match (civicHit=${civicHit}, streetHit=${streetHit}, postalHitFull=${postalHitFull}, ownerHit=${ownerHit})`,
    signal: { civicHit, streetHit, postalHitFull, ownerHit, distinctiveStreet, civic },
  };
}

// ── G4 — owner / company name match ──────────────────────────────────────────

export function evaluateG4(input: GateInput): GateOutcome {
  const blob = foldText(`${input.title} ${input.snippet} ${input.url}`);
  const ownerLast = ownerLastName(input.ctx).toLowerCase();
  const ownerHit = Boolean(ownerLast && ownerLast.length >= 4 && blob.includes(ownerLast));
  const companyTokens = (input.ctx.companyName ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .split(/\s+/)
    .filter(t => t.length > 3 && !/^(inc\.?|ltee|lt[eé]e|ltd|cie|corp|corporation|enr|reg|enr\.?|group|groupe)$/.test(t));
  const companyHits = companyTokens.filter(t => blob.includes(t)).length;

  // Authoritative directory pages get a softer rule — they're per-entity by definition.
  const authoritative = input.classification.sourceClass === "directory_authoritative" || input.classification.sourceClass === "company_website";

  if (ownerHit) {
    return { gate: "G4_owner_match", pass: true, reason: `owner last name "${ownerLast}" present in source`, signal: { ownerHit, companyHits } };
  }
  if (companyHits >= 2) {
    return { gate: "G4_owner_match", pass: true, reason: `${companyHits} distinctive company tokens present`, signal: { companyHits, companyTokens } };
  }
  if (authoritative && companyHits >= 1) {
    return { gate: "G4_owner_match", pass: true, reason: `authoritative source + ${companyHits} company token(s)`, signal: { companyHits, sourceClass: input.classification.sourceClass } };
  }
  return {
    gate: "G4_owner_match",
    pass: false,
    reason: `no owner-name signal (ownerHit=${ownerHit}, companyHits=${companyHits})`,
    signal: { ownerHit, companyHits, ownerLast, companyTokens },
  };
}

// ── G5 — negative signals ────────────────────────────────────────────────────

const RES_INSTITUTION_RE = /r[ée]sidence pour a[îi]n[ée]s|chsld|rpa|manoir|centre d['e]?h[ée]bergement|ehpad|maison de retraite/i;
const TENANT_PREFIX_RE = /^\s*(?:CLINIQUE|CLINIC|PHARMACIE|RESTAURANT|GARAGE|ATELIER|BOUTIQUE|[ÉE]PICERIE|EPICERIE|D[ÉE]PANNEUR|DEPANNEUR|COIFFURE|SALON|DENTAIRE|DENTAL|V[ÉE]T[ÉE]RINAIRE|VETERINAIRE|OPTIQUE|NOTAIRE|COMPTABLE|AVOCAT|H[ÔO]TEL|HOTEL|CAF[ÉE]|CAFE|BAR|BANQUE|[ÉE]COLE|ECOLE|GARDERIE|CPE|CENTRE|MUSEUM|MUSEE|MUS[ÉE]E|BIBLIOTHEQUE|BIBLIOTH[ÈE]QUE)\b/i;

export function evaluateG5(input: GateInput): GateOutcome {
  const text = `${input.title} ${input.snippet}`;
  if (RES_INSTITUTION_RE.test(text)) {
    return { gate: "G5_negative_signals", pass: false, reason: "source is an institution (résidence/CHSLD/RPA/manoir)", signal: { match: text.match(RES_INSTITUTION_RE)?.[0] } };
  }
  // Tenant prefix when owner is an Inc (not the matching owner).
  if (input.ctx.companyName && TENANT_PREFIX_RE.test(input.title) && !foldText(input.title).includes(foldText(input.ctx.companyName))) {
    return { gate: "G5_negative_signals", pass: false, reason: `title looks like a tenant business (${input.title.split(/\s+/).slice(0, 2).join(" ")})`, signal: { tenantPrefix: input.title.match(TENANT_PREFIX_RE)?.[0] } };
  }
  return { gate: "G5_negative_signals", pass: true, reason: "no negative markers" };
}

// ── Run G1–G5 ────────────────────────────────────────────────────────────────

export function runDeterministicGates(input: GateInput): GateOutcome[] {
  const outcomes: GateOutcome[] = [];
  outcomes.push(evaluateG1(input));
  outcomes.push(evaluateG2(input));
  // Short-circuit: if G2 hard-fails (denylisted source), skip the rest — a
  // bulk PDF will never pass G3–G5 anyway, and we want to be efficient.
  if (!outcomes[1].pass && isHardDenySourceClass(input.classification.sourceClass)) {
    return outcomes;
  }
  outcomes.push(evaluateG3(input));
  outcomes.push(evaluateG4(input));
  outcomes.push(evaluateG5(input));
  return outcomes;
}

export function buildGateReport(outcomes: GateOutcome[]): Pick<GateReport, "outcomes" | "passed" | "firstFailure"> {
  const passed = outcomes.every(o => o.pass);
  const firstFailureOutcome = outcomes.find(o => !o.pass);
  return {
    outcomes,
    passed,
    firstFailure: (firstFailureOutcome?.gate ?? null) as GateName | null,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ownerLastName(ctx: LeadContext): string {
  const name = (ctx.fullName ?? ctx.companyName ?? "").trim();
  if (!name) return "";
  // Strip diacritics, take last token of length >= 3.
  const folded = foldText(name);
  const tokens = folded.split(/\s+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].replace(/[^\p{L}]/gu, "");
    if (t.length >= 4 && !/^(inc\.?|ltee|ltd|cie|corp)$/.test(t)) return t;
  }
  return tokens[tokens.length - 1] ?? "";
}
