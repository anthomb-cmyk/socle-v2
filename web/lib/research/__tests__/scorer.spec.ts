/**
 * scorer.spec.ts — Tests for the shared hypothesis scoring module.
 *
 * Decision notes:
 *   - Test 8: company_website + pages_jaunes_business: these sources are NOT
 *     in independent_pairs together (only each is paired with req_phone or
 *     twilio_caller_name individually). They default to "independent" per the
 *     open-world rule, BUT neither is authoritative by default, so with no
 *     isAuthoritative flag the result is tier C (directory match, no postal
 *     corroboration). If pages_jaunes_business is marked authoritative → tier B.
 *
 *   - Test 9: Three rows with the same source string → 1 canonical source →
 *     if authoritative → tier B; if not → tier C (directory) or E (weak).
 */

import { describe, it, expect } from "vitest";
import { scoreHypothesis, countIndependentSources } from "../scorer";
import type { ScoreInput } from "../scorer";

// Helper to build a fresh row
function row(
  source: string,
  opts: {
    isAuthoritative?: boolean;
    postalCorroborated?: boolean;
    isDirectorOf?: boolean;
    sourceUrl?: string | null;
    fetchedAt?: string;
  } = {},
): ScoreInput["evidenceRows"][number] {
  return { source, ...opts };
}

// An ISO date string that is definitely older than 12 months
const staleDate = "2020-01-01T00:00:00Z";
// A recent date
const freshDate = new Date().toISOString();

// ---------------------------------------------------------------------------
// Test 1: Two independent + 1 authoritative → Tier A
// ---------------------------------------------------------------------------
describe("scoreHypothesis", () => {
  it("1. two independent sources with one authoritative → tier A, confirmed, isDirect=true", () => {
    const result = scoreHypothesis({
      evidenceRows: [
        row("req_phone", { isAuthoritative: true }),
        row("twilio_caller_name", { isAuthoritative: true }),
      ],
      ownerType: "named_co",
      pipeline: "A",
    });

    expect(result.tier).toBe("A");
    expect(result.label).toBe("confirmed");
    expect(result.isDirect).toBe(true);
    expect(result.statusReason).toContain("independent sources");
  });

  // ---------------------------------------------------------------------------
  // Test 2: Single authoritative → Tier B
  // ---------------------------------------------------------------------------
  it("2. single authoritative source → tier B, likely, isDirect=true", () => {
    const result = scoreHypothesis({
      evidenceRows: [row("req_phone", { isAuthoritative: true })],
      ownerType: "named_co",
      pipeline: "A",
    });

    expect(result.tier).toBe("B");
    expect(result.label).toBe("likely");
    expect(result.isDirect).toBe(true);
    expect(result.statusReason).toContain("authoritative");
  });

  // ---------------------------------------------------------------------------
  // Test 3: Single directory only → Tier C
  // ---------------------------------------------------------------------------
  it("3. single directory source only → tier C, connected, isDirect=true", () => {
    const result = scoreHypothesis({
      evidenceRows: [row("pages_jaunes_business", { isAuthoritative: false })],
      ownerType: "named_co",
      pipeline: "A",
    });

    expect(result.tier).toBe("C");
    expect(result.label).toBe("connected");
    expect(result.isDirect).toBe(true);
    expect(result.statusReason).toContain("directory match");
  });

  it("3b. single REQ-address web result → tier C review candidate", () => {
    const result = scoreHypothesis({
      evidenceRows: [row("req_address_lookup", { isAuthoritative: false })],
      ownerType: "individual",
      pipeline: "B",
    });

    expect(result.tier).toBe("C");
    expect(result.label).toBe("connected");
    expect(result.statusReason).toContain("directory match");
  });

  // ---------------------------------------------------------------------------
  // Test 4: Director-of signal alone → Tier D
  // ---------------------------------------------------------------------------
  it("4. isDirectorOf=true alone → tier D, connected, isDirect=false", () => {
    const result = scoreHypothesis({
      evidenceRows: [row("cross_property", { isDirectorOf: true })],
      ownerType: "individual",
      pipeline: "B",
    });

    expect(result.tier).toBe("D");
    expect(result.label).toBe("connected");
    expect(result.isDirect).toBe(false);
    expect(result.statusReason).toContain("director");
  });

  // ---------------------------------------------------------------------------
  // Test 5: All evidence older than 12 months → Tier E
  // ---------------------------------------------------------------------------
  it("5. all evidence older than 12 months → tier E, weak", () => {
    const result = scoreHypothesis({
      evidenceRows: [
        row("req_phone", { isAuthoritative: true, fetchedAt: staleDate }),
        row("twilio_caller_name", { isAuthoritative: true, fetchedAt: staleDate }),
      ],
      ownerType: "named_co",
      pipeline: "A",
    });

    expect(result.tier).toBe("E");
    expect(result.label).toBe("weak");
    expect(result.statusReason).toContain("12 months");
  });

  // ---------------------------------------------------------------------------
  // Test 6: Sibling group collapse — pagesjaunes.ca + 411.ca count as 1 source
  // ---------------------------------------------------------------------------
  it("6. sibling group: pagesjaunes.ca + 411.ca collapse to 1 source → not enough for tier A", () => {
    // Both URLs are in the same sibling group → 1 independent source
    const result = scoreHypothesis({
      evidenceRows: [
        row("pages_jaunes_business", {
          isAuthoritative: true,
          sourceUrl: "https://www.pagesjaunes.ca/listing/123",
        }),
        row("pages_jaunes_business", {
          isAuthoritative: true,
          sourceUrl: "https://www.411.ca/listing/456",
        }),
      ],
      ownerType: "named_co",
      pipeline: "A",
    });

    // Both collapse to the same sibling group → independentCount = 1 → tier B not A
    expect(result.tier).toBe("B");
    expect(result.tier).not.toBe("A");
  });

  // ---------------------------------------------------------------------------
  // Test 6b: countIndependentSources directly
  // ---------------------------------------------------------------------------
  it("6b. countIndependentSources: pagesjaunes.ca + 411.ca → 1 source", () => {
    const count = countIndependentSources([
      row("pages_jaunes_business", { sourceUrl: "https://www.pagesjaunes.ca/listing/123" }),
      row("pages_jaunes_business", { sourceUrl: "https://www.411.ca/listing/456" }),
    ]);
    expect(count).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Test 7: req_phone + twilio_caller_name → Tier A
  // ---------------------------------------------------------------------------
  it("7. req_phone + twilio_caller_name (both authoritative, in independent_pairs) → tier A", () => {
    const result = scoreHypothesis({
      evidenceRows: [
        row("req_phone", { isAuthoritative: true }),
        row("twilio_caller_name", { isAuthoritative: true }),
      ],
      ownerType: "named_co",
      pipeline: "A",
    });

    expect(result.tier).toBe("A");
    expect(result.label).toBe("confirmed");
    expect(result.statusReason).toMatch(/req_phone.*twilio_caller_name|twilio_caller_name.*req_phone/);
  });

  // ---------------------------------------------------------------------------
  // Test 8: company_website + pages_jaunes_business
  // These are NOT an enumerated independent_pair. They default to independent
  // per open-world rule. Since neither has isAuthoritative=true, the result
  // is tier C (pages_jaunes_business is a directory source → hasDirectoryMatch).
  // If pages_jaunes_business is marked authoritative → tier B (1 authoritative).
  // ---------------------------------------------------------------------------
  it("8a. company_website + pages_jaunes_business (neither authoritative) → tier C (directory match)", () => {
    const result = scoreHypothesis({
      evidenceRows: [
        row("company_website", { isAuthoritative: false }),
        row("pages_jaunes_business", { isAuthoritative: false }),
      ],
      ownerType: "named_co",
      pipeline: "A",
    });

    // Has directory match (pages_jaunes_business), no postal corroboration → tier C
    expect(result.tier).toBe("C");
    expect(result.label).toBe("connected");
  });

  it("8b. company_website + pages_jaunes_business (pages_jaunes authoritative) → tier A (open-world: two different sources are independent by default)", () => {
    // Decision: company_website and pages_jaunes_business are not in independent_pairs,
    // but they are different source strings and not in the same sibling group.
    // Per the open-world rule, they default to independent.
    // With 2 independent sources + 1 authoritative → tier A.
    const result = scoreHypothesis({
      evidenceRows: [
        row("company_website", { isAuthoritative: false }),
        row("pages_jaunes_business", { isAuthoritative: true }),
      ],
      ownerType: "named_co",
      pipeline: "A",
    });

    expect(result.tier).toBe("A");
    expect(result.label).toBe("confirmed");
  });

  // ---------------------------------------------------------------------------
  // Test 9: Three rows same source → 1 source
  // ---------------------------------------------------------------------------
  it("9a. three rows all source=req_phone (authoritative) → 1 independent source → tier B", () => {
    const result = scoreHypothesis({
      evidenceRows: [
        row("req_phone", { isAuthoritative: true }),
        row("req_phone", { isAuthoritative: true }),
        row("req_phone", { isAuthoritative: true }),
      ],
      ownerType: "named_co",
      pipeline: "A",
    });

    expect(result.tier).toBe("B");
    expect(result.label).toBe("likely");
  });

  it("9b. three rows all source=cross_property (not authoritative) → tier E", () => {
    const result = scoreHypothesis({
      evidenceRows: [
        row("cross_property", { isAuthoritative: false }),
        row("cross_property", { isAuthoritative: false }),
        row("cross_property", { isAuthoritative: false }),
      ],
      ownerType: "individual",
      pipeline: "B",
    });

    // cross_property is not a directory source in our list → tier E
    expect(result.tier).toBe("E");
    expect(result.label).toBe("weak");
  });

  // ---------------------------------------------------------------------------
  // Test 10: Empty → Tier E with "no evidence"
  // ---------------------------------------------------------------------------
  it("10. empty evidence rows → tier E, weak, reason='no evidence'", () => {
    const result = scoreHypothesis({
      evidenceRows: [],
      ownerType: "named_co",
      pipeline: "A",
    });

    expect(result.tier).toBe("E");
    expect(result.label).toBe("weak");
    expect(result.statusReason).toBe("no evidence");
  });

  // ---------------------------------------------------------------------------
  // Test 11: Pipeline B — 2 independent sources + postalCorroborated → Tier A
  // even without isAuthoritative
  // ---------------------------------------------------------------------------
  it("11. pipeline B: 2 independent sources + postalCorroborated → tier A", () => {
    const result = scoreHypothesis({
      evidenceRows: [
        row("reverse_address", { isAuthoritative: false, postalCorroborated: false }),
        row("name_postal_directory", { isAuthoritative: false, postalCorroborated: true }),
      ],
      ownerType: "individual",
      pipeline: "B",
    });

    expect(result.tier).toBe("A");
    expect(result.label).toBe("confirmed");
    expect(result.isDirect).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 12: Mixed stale and fresh evidence → NOT all stale → normal tier
  // ---------------------------------------------------------------------------
  it("12. mixed stale + fresh evidence → not treated as all stale → normal tier", () => {
    const result = scoreHypothesis({
      evidenceRows: [
        row("req_phone", { isAuthoritative: true, fetchedAt: staleDate }),
        row("twilio_caller_name", { isAuthoritative: true, fetchedAt: freshDate }),
      ],
      ownerType: "named_co",
      pipeline: "A",
    });

    // Not all stale → normal scoring → tier A
    expect(result.tier).toBe("A");
  });
});
