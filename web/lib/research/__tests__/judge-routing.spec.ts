import { describe, expect, it } from "vitest";
import { candidateStatusFromJudge, openclawVerdictFromJudge } from "../judge-routing";

describe("judge-routing", () => {
  it("maps judge verdicts to existing openclaw enum values", () => {
    expect(openclawVerdictFromJudge({ verdict: "approve" })).toBe("likely_match");
    expect(openclawVerdictFromJudge({ verdict: "review" })).toBe("uncertain");
    expect(openclawVerdictFromJudge({ verdict: "reject" })).toBe("unlikely_match");
  });

  it("keeps normal review verdicts in Anthony Review", () => {
    expect(candidateStatusFromJudge(
      { verdict: "review", confidence: 60, reasoning: "Plausible but ambiguous." },
      { isAuthoritative: false, initialConfidence: 50 },
    )).toBe("needs_anthony_review");
  });

  it("demotes weak candidates when the judge is unavailable", () => {
    expect(candidateStatusFromJudge(
      { verdict: "review", confidence: 50, reasoning: "LLM judge failed (529); routed to review." },
      { isAuthoritative: false, initialConfidence: 50 },
    )).toBe("weak_review");
  });

  it("does not demote authoritative candidates when the judge is unavailable", () => {
    expect(candidateStatusFromJudge(
      { verdict: "review", confidence: 50, reasoning: "Judge returned unparse-able response; routed to review." },
      { isAuthoritative: true, initialConfidence: 80 },
    )).toBe("needs_anthony_review");
  });
});
