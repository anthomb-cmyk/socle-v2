// Tests for lib/llm/fit-scorer.ts
//
// Mocks callAnthropic (no real HTTP) and a chainable Supabase stub.

import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { scoreLeadFit } from "@/lib/llm/fit-scorer";
import { callAnthropic } from "@/lib/llm/anthropic-client";
import type { SupabaseClient } from "@supabase/supabase-js";

const mockCallAnthropic = vi.mocked(callAnthropic);

function makeOkResult(json: object) {
  return {
    ok: true,
    text: JSON.stringify(json),
    inputTokens: 200,
    outputTokens: 50,
    costUsd: 0.0001,
    latencyMs: 400,
    status: 200,
  };
}

const FAIL_RESULT = {
  ok: false,
  text: "",
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  latencyMs: 0,
  status: 0,
  error: "ANTHROPIC_API_KEY not set",
};

const LEAD_ROW = {
  id: "lead-1",
  contact_id: "contact-1",
  contacts: {
    full_name: "Jean Tremblay",
    company_name: null,
    kind: "person",
    mailing_address: "14 Rue des Érables",
    mailing_city: "Granby",
    mailing_postal: "J2G 0A1",
  },
  properties: {
    address: "50 Rue Principale",
    city: "Granby",
    num_units: 12,
    evaluation_total: 3_600_000,
    year_built: 1988,
  },
};

function makeSupabaseStub(opts: {
  leadData?: unknown;
  leadError?: { message: string } | null;
  updateError?: { message: string } | null;
} = {}): SupabaseClient {
  const leadData = opts.leadData ?? LEAD_ROW;
  const leadError = opts.leadError ?? null;
  const updateError = opts.updateError ?? null;

  return {
    from: vi.fn((table: string) => {
      if (table === "leads") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: leadData, error: leadError }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: updateError }),
          }),
        };
      }
      return { select: vi.fn(), update: vi.fn() };
    }),
  } as unknown as SupabaseClient;
}

describe("scoreLeadFit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns score and reasoning on success", async () => {
    mockCallAnthropic.mockResolvedValueOnce(
      makeOkResult({ score: 78, reasoning: "Good fit: 12 units in Granby, long tenure." }),
    );
    const sb = makeSupabaseStub();
    const result = await scoreLeadFit("lead-1", sb);

    expect(result).not.toBeNull();
    expect(result!.score).toBe(78);
    expect(result!.reasoning).toContain("Good fit");
  });

  it("clamps score to 0-100", async () => {
    mockCallAnthropic.mockResolvedValueOnce(
      makeOkResult({ score: 150, reasoning: "Over the limit." }),
    );
    const sb = makeSupabaseStub();
    const result = await scoreLeadFit("lead-1", sb);

    expect(result!.score).toBe(100);
  });

  it("clamps negative score to 0", async () => {
    mockCallAnthropic.mockResolvedValueOnce(
      makeOkResult({ score: -10, reasoning: "Terrible fit." }),
    );
    const sb = makeSupabaseStub();
    const result = await scoreLeadFit("lead-1", sb);

    expect(result!.score).toBe(0);
  });

  it("returns null when callAnthropic fails", async () => {
    mockCallAnthropic.mockResolvedValueOnce(FAIL_RESULT);
    const sb = makeSupabaseStub();
    const result = await scoreLeadFit("lead-1", sb);
    expect(result).toBeNull();
  });

  it("returns null when lead is not found", async () => {
    const sb = makeSupabaseStub({ leadData: null, leadError: { message: "not found" } });
    const result = await scoreLeadFit("lead-1", sb);
    expect(result).toBeNull();
    expect(mockCallAnthropic).not.toHaveBeenCalled();
  });

  it("returns null when JSON cannot be parsed from response", async () => {
    mockCallAnthropic.mockResolvedValueOnce({
      ...makeOkResult({}),
      text: "Sorry, I cannot score this lead.",
    });
    const sb = makeSupabaseStub();
    const result = await scoreLeadFit("lead-1", sb);
    expect(result).toBeNull();
  });

  it("still returns result even when DB update fails", async () => {
    mockCallAnthropic.mockResolvedValueOnce(
      makeOkResult({ score: 55, reasoning: "Moderate fit." }),
    );
    const sb = makeSupabaseStub({ updateError: { message: "column does not exist" } });
    const result = await scoreLeadFit("lead-1", sb);
    // Result should still be returned despite update failure
    expect(result).not.toBeNull();
    expect(result!.score).toBe(55);
  });

  it("passes feature:deal_fit_score and leadId to callAnthropic", async () => {
    mockCallAnthropic.mockResolvedValueOnce(
      makeOkResult({ score: 60, reasoning: "Some fit." }),
    );
    const sb = makeSupabaseStub();
    await scoreLeadFit("lead-abc", sb);

    expect(mockCallAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "deal_fit_score",
        model: "claude-haiku-4-5",
        leadId: "lead-abc",
      }),
    );
  });

  it("prompt includes INVESTMENT_THESIS content", async () => {
    mockCallAnthropic.mockResolvedValueOnce(
      makeOkResult({ score: 70, reasoning: "Good." }),
    );
    const sb = makeSupabaseStub();
    await scoreLeadFit("lead-1", sb);

    const callArgs = mockCallAnthropic.mock.calls[0][0];
    expect(callArgs.prompt).toContain("Quebec multi-unit residential");
    expect(callArgs.prompt).toContain("positive_signals");
    expect(callArgs.prompt).toContain("Jean Tremblay");
    expect(callArgs.prompt).toContain("Granby");
  });
});
