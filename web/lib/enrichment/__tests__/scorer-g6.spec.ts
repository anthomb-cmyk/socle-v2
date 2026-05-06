// Tests for the G6-aware chooseDisposition tuning.
// Verifies that Haiku confidence >= 85 promotes score>=70 candidates to auto_attached.

import { describe, it, expect } from "vitest";
import { chooseDisposition } from "../scorer";
import type { GateOutcome } from "../types";

// Helper: build a G6 gate outcome
function g6Outcome(isOwnersPhone: boolean, confidence: number): GateOutcome {
  return {
    gate: "G6_haiku_validation",
    pass: isOwnersPhone && confidence >= 60,
    reason: isOwnersPhone ? "Haiku approves" : "Haiku rejects",
    signal: { confidence, nameInSource: true, addressInSource: true },
  };
}

describe("chooseDisposition — existing rules unchanged", () => {
  it("returns quarantined when not all gates pass", () => {
    expect(chooseDisposition(false, 90, "directory_authoritative", true)).toBe("quarantined");
  });

  it("auto_attached when score>=85 + authoritative + ownerHit", () => {
    expect(chooseDisposition(true, 85, "directory_authoritative", true)).toBe("auto_attached");
    expect(chooseDisposition(true, 85, "company_website", true)).toBe("auto_attached");
  });

  it("needs_anthony_review when score>=70 but not meeting auto threshold", () => {
    expect(chooseDisposition(true, 75, "web_other", true)).toBe("needs_anthony_review");
    expect(chooseDisposition(true, 75, "directory_authoritative", false)).toBe("needs_anthony_review");
  });

  it("weak_review when 50<=score<70", () => {
    expect(chooseDisposition(true, 65, "web_other", false)).toBe("weak_review");
    expect(chooseDisposition(true, 50, "social", false)).toBe("weak_review");
  });

  it("quarantined when score<50 even if all gates passed", () => {
    expect(chooseDisposition(true, 49, "directory_authoritative", true)).toBe("quarantined");
  });
});

describe("chooseDisposition — G6-aware auto-attach promotion", () => {
  it("promotes to auto_attached when score>=70 + G6 pass + confidence>=85", () => {
    const outcomes: GateOutcome[] = [g6Outcome(true, 90)];
    expect(chooseDisposition(true, 70, "web_other", false, outcomes)).toBe("auto_attached");
    expect(chooseDisposition(true, 78, "social", true, outcomes)).toBe("auto_attached");
  });

  it("stays needs_anthony_review when G6 confidence < 85", () => {
    const outcomes: GateOutcome[] = [g6Outcome(true, 80)];
    expect(chooseDisposition(true, 75, "web_other", false, outcomes)).toBe("needs_anthony_review");
  });

  it("stays needs_anthony_review when G6 rejects", () => {
    const outcomes: GateOutcome[] = [g6Outcome(false, 95)];
    expect(chooseDisposition(true, 75, "web_other", false, outcomes)).toBe("needs_anthony_review");
  });

  it("does not promote when score < 70 even with high G6 confidence", () => {
    const outcomes: GateOutcome[] = [g6Outcome(true, 95)];
    // score 65 → weak_review, G6 does not apply to weak_review range
    expect(chooseDisposition(true, 65, "web_other", false, outcomes)).toBe("weak_review");
  });

  it("existing high-score rule still fires before G6 check", () => {
    const outcomes: GateOutcome[] = [g6Outcome(true, 90)];
    // score 85 + authoritative + ownerHit → auto_attached via classic rule
    expect(chooseDisposition(true, 85, "directory_authoritative", true, outcomes)).toBe("auto_attached");
  });

  it("no G6 outcome in outcomes array → no promotion", () => {
    const outcomes: GateOutcome[] = [
      { gate: "G4_owner_match", pass: true, reason: "owner hit", signal: { ownerHit: true, companyHits: 0 } },
    ];
    expect(chooseDisposition(true, 75, "web_other", false, outcomes)).toBe("needs_anthony_review");
  });

  it("empty outcomes array → no promotion, falls back to score-based rule", () => {
    expect(chooseDisposition(true, 75, "web_other", false, [])).toBe("needs_anthony_review");
  });
});
