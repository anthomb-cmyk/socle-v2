import { describe, expect, it } from "vitest";
import {
  assertBudgetCanSpend,
  buildReviewProposal,
  classifyRecoverability,
  estimateAiSecondPassCostUsd,
} from "../session";

describe("phone enrichment session helpers", () => {
  it("classifies pipeline errors before weak evidence", () => {
    expect(classifyRecoverability({
      latestJob: { error_message: "runner exploded", raw_output: { outcome: "runner_error" } },
      weakCandidateCount: 2,
      quarantinedCandidateCount: 0,
      queryBuiltCount: 4,
    })).toEqual({ reason: "pipeline_error", detail: "runner exploded" });
  });

  it("classifies sparse query coverage as bad_query", () => {
    expect(classifyRecoverability({
      latestJob: { raw_output: { outcome: "no_result" } },
      weakCandidateCount: 0,
      quarantinedCandidateCount: 0,
      queryBuiltCount: 2,
    }).reason).toBe("bad_query");
  });

  it("blocks spend that would exceed the session cap", () => {
    const result = assertBudgetCanSpend({
      dailyBudgetUsd: 20,
      sessionBudgetUsd: 5,
      dailySpentUsd: 4,
      sessionSpentUsd: 4.8,
      dailyRemainingUsd: 16,
      sessionRemainingUsd: 0.2,
      overDailyBudget: false,
      overSessionBudget: false,
    }, 0.3);

    expect(result.ok).toBe(false);
  });

  it("proposes rejection for fax evidence", () => {
    const proposal = buildReviewProposal({
      id: "cand-1",
      phone_e164: "+15145550199",
      phone_raw: "(514) 555-0199",
      source_label: "directory",
      source_url: null,
      snippet: "Tel: 514-555-0100 Fax: 514-555-0199",
      matched_on: "city",
      initial_confidence: 82,
      review_reason: null,
    });

    expect(proposal.verdict).toBe("reject");
  });

  it("estimates AI second-pass spend from the lead count", () => {
    expect(estimateAiSecondPassCostUsd(3)).toBe(0.06);
  });
});
