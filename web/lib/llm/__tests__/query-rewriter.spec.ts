// Tests for lib/llm/query-rewriter.ts
//
// callAnthropic and parseFirstJson are mocked so no real HTTP calls are made.
// Tests verify:
//   1. Returns [] when the API key is absent (callAnthropic returns ok:false).
//   2. Returns [] when the response is unparseable.
//   3. Returns well-shaped BuiltQuery objects when callAnthropic succeeds.
//   4. Caps the result at 3 queries even if the model returns more.
//   5. Skips suggestions with empty or non-string query fields.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock callAnthropic and parseFirstJson before importing the module under test.
vi.mock("@/lib/llm/anthropic-client", () => ({
  callAnthropic: vi.fn(),
  parseFirstJson: (text: string) => {
    if (!text) return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); }
    catch { return null; }
  },
}));

import { callAnthropic } from "@/lib/llm/anthropic-client";
import { suggestAlternateQueries } from "../query-rewriter";
import type { LeadContext, ParsedAddress } from "@/lib/enrichment/types";

const mockCallAnthropic = vi.mocked(callAnthropic);

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CTX: LeadContext = {
  leadId: "lead-test-1",
  contactId: "contact-1",
  enrichmentJobId: "job-1",
  fullName: "Jean Tremblay",
  companyName: "Tremblay Immobilier Inc",
  secondaryName: null,
  propertyAddress: "3720 Avenue Kent",
  propertyCity: "Montréal",
  mailingAddress: "3720 Avenue Kent, Montréal QC H3S 1N3",
  mailingCity: "Montréal",
  mailingPostal: "H3S 1N3",
  matricule: null,
  numUnits: 6,
};

const PARSED: ParsedAddress = {
  raw: "3720 Avenue Kent, Montréal QC H3S 1N3",
  civicNumber: "3720",
  civicRange: null,
  streetName: "Avenue Kent",
  unit: null,
  city: "Montréal",
  province: "QC",
  postal: "H3S 1N3",
  postalFsa: "H3S",
};

const PRIOR_QUERIES = [
  '"3720 Avenue Kent" "Montréal" "H3S 1N3" téléphone',
  '"3720 Avenue Kent" "H3S 1N3"',
];

function makeSuccessResult(json: object) {
  return {
    ok: true,
    text: JSON.stringify(json),
    inputTokens: 50,
    outputTokens: 80,
    costUsd: 0.0002,
    latencyMs: 300,
    status: 200,
  };
}

const FAILURE_RESULT = {
  ok: false,
  text: "",
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  latencyMs: 0,
  status: 0,
  error: "ANTHROPIC_API_KEY not set",
};

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("suggestAlternateQueries", () => {
  it("returns [] when callAnthropic returns ok:false (API key absent)", async () => {
    mockCallAnthropic.mockResolvedValueOnce(FAILURE_RESULT);

    const result = await suggestAlternateQueries(CTX, PARSED, PRIOR_QUERIES);

    expect(result).toEqual([]);
    expect(mockCallAnthropic).toHaveBeenCalledOnce();
    expect(mockCallAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "query_rewriting",
        leadId: "lead-test-1",
      }),
    );
  });

  it("returns [] when the response is not parseable JSON", async () => {
    mockCallAnthropic.mockResolvedValueOnce({
      ok: true,
      text: "Sorry, I could not generate queries.",
      inputTokens: 10,
      outputTokens: 10,
      costUsd: 0,
      latencyMs: 100,
      status: 200,
    });

    const result = await suggestAlternateQueries(CTX, PARSED, PRIOR_QUERIES);
    expect(result).toEqual([]);
  });

  it("returns [] when the parsed JSON has no queries array", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({ message: "no suggestions" }));

    const result = await suggestAlternateQueries(CTX, PARSED, PRIOR_QUERIES);
    expect(result).toEqual([]);
  });

  it("returns well-shaped BuiltQuery objects for a valid LLM response", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      queries: [
        { query: '"Tremblay Immobilier" Montréal téléphone', rationale: "Use trade name only" },
        { query: '"3720 Kent" "H3S" immeubles', rationale: "Short street name + FSA" },
      ],
    }));

    const result = await suggestAlternateQueries(CTX, PARSED, PRIOR_QUERIES);

    expect(result).toHaveLength(2);

    const first = result[0];
    expect(first.query).toBe('"Tremblay Immobilier" Montréal téléphone');
    expect(first.variant).toBe("owner_addr_city");
    expect(typeof first.inputs).toBe("object");
    expect(first.inputs.rewritten).toBe("true");

    const second = result[1];
    expect(second.query).toBe('"3720 Kent" "H3S" immeubles');
    expect(second.variant).toBe("owner_addr_city");
  });

  it("caps the result at 3 queries even when model returns more", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      queries: [
        { query: "Query one téléphone", rationale: "A" },
        { query: "Query two téléphone", rationale: "B" },
        { query: "Query three téléphone", rationale: "C" },
        { query: "Query four téléphone", rationale: "D" },
        { query: "Query five téléphone", rationale: "E" },
      ],
    }));

    const result = await suggestAlternateQueries(CTX, PARSED, PRIOR_QUERIES);
    expect(result).toHaveLength(3);
  });

  it("skips entries with empty or non-string query fields", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      queries: [
        { query: "", rationale: "empty — should be skipped" },
        { query: 42, rationale: "non-string — should be skipped" },
        { query: "Valid query téléphone", rationale: "this one counts" },
      ],
    }));

    const result = await suggestAlternateQueries(CTX, PARSED, PRIOR_QUERIES);
    expect(result).toHaveLength(1);
    expect(result[0].query).toBe("Valid query téléphone");
  });

  it("uses the companyName as the owner input when available", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      queries: [{ query: "Some company search", rationale: "Company angle" }],
    }));

    const result = await suggestAlternateQueries(CTX, PARSED, PRIOR_QUERIES);
    expect(result[0].inputs.owner).toBe("Tremblay Immobilier Inc");
  });

  it("falls back to fullName as owner when companyName is absent", async () => {
    const ctxNoCompany: LeadContext = { ...CTX, companyName: null };

    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      queries: [{ query: "Owner name search", rationale: "Director angle" }],
    }));

    const result = await suggestAlternateQueries(ctxNoCompany, PARSED, PRIOR_QUERIES);
    expect(result[0].inputs.owner).toBe("Jean Tremblay");
  });

  it("calls callAnthropic with feature=query_rewriting and model=claude-haiku-4-5", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      queries: [{ query: "Test query", rationale: "Test" }],
    }));

    await suggestAlternateQueries(CTX, PARSED, []);

    expect(mockCallAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "query_rewriting",
        model: "claude-haiku-4-5",
        leadId: "lead-test-1",
      }),
    );
  });

  it("includes prior queries in the prompt", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      queries: [{ query: "Alternate search", rationale: "Different angle" }],
    }));

    await suggestAlternateQueries(CTX, PARSED, PRIOR_QUERIES);

    const callArgs = mockCallAnthropic.mock.calls[0][0];
    expect(callArgs.prompt).toContain(PRIOR_QUERIES[0]);
    expect(callArgs.prompt).toContain(PRIOR_QUERIES[1]);
  });
});
