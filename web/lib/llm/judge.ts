/**
 * judge.ts — LLM judge for phone candidates in the new research pipeline.
 *
 * Wraps a synchronous Claude Haiku call that evaluates whether a candidate
 * phone number truly belongs to the owner described by the owner record.
 *
 * The judge returns a structured verdict:
 *   approve  — phone, name, and address all strongly match; high confidence.
 *   review   — plausible match but some ambiguity; medium confidence.
 *   reject   — source belongs to a different entity, area code is implausible,
 *              or snippet contradicts the owner.
 *
 * Usage log: every call writes to llm_usage_log via callAnthropic() for full
 * cost tracking in /admin/costs.
 */

import { callAnthropic, parseFirstJson } from "./anthropic-client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JUDGE_MODEL = "claude-haiku-4-5-20251001";
const JUDGE_MAX_TOKENS = 300;

/**
 * NANP area codes that are not in active Quebec/Ontario/Atlantic allocation.
 * This list covers toll-free, invalid, unassigned, or non-Canadian codes that
 * should trigger an automatic reject.
 */
const IMPLAUSIBLE_AREA_CODES = new Set([
  // Toll-free
  "800", "833", "844", "855", "866", "877", "888",
  // Unassigned / reserved
  "242", "244", "392", "622", "645",
  // US-only area codes known to appear in scraped Canadian sources
  "900", // premium-rate
]);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type JudgeVerdict = "approve" | "review" | "reject";

export interface JudgeInput {
  /** Normalised E.164 phone being evaluated. */
  phone: string;
  /** URL of the page where the phone was found. */
  sourceUrl: string | null;
  /** Brave search snippet for the page. */
  snippet: string | null;
  /** The search query that found the page. */
  searchQuery: string | null;
  /** Source label (e.g. "name_postal_directory", "company_website"). */
  sourceLabel: string;
}

export interface OwnerRecord {
  /** Owner's full canonical name (individual or business). */
  canonicalName: string;
  /** Other owner/contact names attached to the same property/import row. */
  relatedNames?: string[];
  /** Raw mailing address string as stored in canonical_owner. */
  mailingAddress: string | null;
  /** Owner type: individual / named_co / numbered_co / trust / government. */
  ownerType: string;
}

export interface JudgeResult {
  verdict: JudgeVerdict;
  /** 0-100 confidence score from the judge. */
  confidence: number;
  /** One-sentence reasoning from the model. */
  reasoning: string;
  /** True when the area code was caught as implausible before the LLM was called. */
  implausibleAreaCode: boolean;
}

// ---------------------------------------------------------------------------
// Area-code pre-filter
// ---------------------------------------------------------------------------

function getAreaCode(e164: string): string | null {
  // E.164 Canadian: +1AAANNNNNNN — area code is chars [2..4]
  const digits = e164.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    return digits.slice(1, 4);
  }
  if (digits.length === 10) {
    return digits.slice(0, 3);
  }
  return null;
}

// ---------------------------------------------------------------------------
// System prompt (written once, used for every call)
// ---------------------------------------------------------------------------

const JUDGE_SYSTEM_PROMPT = `You are a phone-number verification judge for a Quebec real estate CRM.

Your job is to decide whether a candidate phone number found on a web page truly belongs to the owner described below.

VERDICT RULES — you MUST return one of these three verdicts:

"approve" — Use ONLY when ALL of the following hold:
  • The phone, owner name, and address all strongly match the source page.
  • The snippet or URL provides clear, specific evidence linking this exact phone to this exact owner.
  • High confidence (75–100).

"review" — Use when:
  • There is a plausible link between the phone and the owner, but with some ambiguity.
  • Examples: partial address match, name variation, phone found on a directory page with several entries, no clear corroboration between name and phone.
  • Medium confidence (40–74).

"reject" — Use when ANY of the following holds:
  • The source page clearly belongs to a different person or company.
  • The snippet contradicts the owner (different city, different name, different business type).
  • The area code is implausible for Quebec/Ontario/Atlantic Canada (e.g. 800/toll-free, 242, 244, 392, 622, 645, 900).
  • The phone looks like a fax number (labelled "fax", "télécopieur", "fax:" in snippet).
  • The snippet is a generic directory listing with no name/address corroboration.
  • Low confidence (0–39).

Respond with ONLY a JSON object, no prose before or after:
{"verdict":"approve"|"review"|"reject","confidence":<0-100>,"reasoning":"<one sentence>"}`;

// ---------------------------------------------------------------------------
// Main judge function
// ---------------------------------------------------------------------------

/**
 * Judge whether a candidate phone number belongs to the given owner.
 *
 * - Runs an area-code pre-filter before the LLM call.
 * - Uses Claude Haiku via callAnthropic() for cost tracking.
 * - Never throws; returns a "review" verdict on parse failures so candidates
 *   are not silently dropped.
 */
export async function judgePhoneCandidate(
  candidate: JudgeInput,
  owner: OwnerRecord,
  context?: { leadId?: string; candidateId?: string },
): Promise<JudgeResult> {
  // Pre-filter: implausible area codes are rejected without an LLM call.
  const areaCode = getAreaCode(candidate.phone);
  if (areaCode && IMPLAUSIBLE_AREA_CODES.has(areaCode)) {
    return {
      verdict: "reject",
      confidence: 95,
      reasoning: `Area code ${areaCode} is not in active Quebec/Ontario/Atlantic NANP allocation.`,
      implausibleAreaCode: true,
    };
  }

  // Build the user prompt with all available provenance context.
  const lines: string[] = [
    `OWNER:`,
    `  Name: ${owner.canonicalName}`,
    ...(owner.relatedNames && owner.relatedNames.length > 0
      ? [`  Other owner names on same property/import row: ${owner.relatedNames.join("; ")}`]
      : []),
    `  Type: ${owner.ownerType}`,
    `  Mailing address: ${owner.mailingAddress ?? "(not available)"}`,
    ``,
    `CANDIDATE PHONE: ${candidate.phone}`,
    `  Source type: ${candidate.sourceLabel}`,
    `  Source URL: ${candidate.sourceUrl ?? "(not available)"}`,
    `  Search query that found this page: ${candidate.searchQuery ?? "(not available)"}`,
    `  Page snippet: ${candidate.snippet ?? "(not available)"}`,
    ``,
    `Based solely on the evidence above, return your JSON verdict.`,
  ];

  const result = await callAnthropic({
    feature: "phone_judge",
    model: JUDGE_MODEL,
    maxTokens: JUDGE_MAX_TOKENS,
    system: JUDGE_SYSTEM_PROMPT,
    prompt: lines.join("\n"),
    leadId: context?.leadId,
    candidateId: context?.candidateId,
  });

  if (!result.ok || !result.text) {
    // LLM call failed — fall back to "review" so a human sees it.
    return {
      verdict: "review",
      confidence: 50,
      reasoning: `LLM judge failed (${result.error ?? "no response"}); routed to review.`,
      implausibleAreaCode: false,
    };
  }

  interface RawVerdict {
    verdict?: string;
    confidence?: number;
    reasoning?: string;
  }

  const parsed = parseFirstJson<RawVerdict>(result.text);
  if (!parsed || !parsed.verdict) {
    return {
      verdict: "review",
      confidence: 50,
      reasoning: `Judge returned unparse-able response; routed to review.`,
      implausibleAreaCode: false,
    };
  }

  const verdict = (["approve", "review", "reject"].includes(parsed.verdict ?? "")
    ? parsed.verdict
    : "review") as JudgeVerdict;

  return {
    verdict,
    confidence: typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(100, parsed.confidence))
      : 50,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    implausibleAreaCode: false,
  };
}
