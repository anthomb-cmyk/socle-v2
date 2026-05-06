// Tests for the LLM address fallback.
// callAnthropic is mocked so no network calls are made.

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

import { callAnthropic } from "@/lib/llm/anthropic-client";
import { llmParseAddress } from "../address-fallback";

const mockCallAnthropic = vi.mocked(callAnthropic);

function makeSuccessResult(json: object) {
  return {
    ok: true,
    text: JSON.stringify(json),
    inputTokens: 10,
    outputTokens: 20,
    costUsd: 0.001,
    latencyMs: 120,
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("llmParseAddress", () => {
  it("parses a complete Quebec address from a canned LLM response", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      civic_number: "3720",
      civic_range: null,
      street_name: "Avenue Kent",
      unit: null,
      city: "Montréal",
      province: "QC",
      postal: "H3S 1N3",
      unparseable: false,
    }));

    const result = await llmParseAddress("3720 Avenue Kent Montreal QC H3S1N3");

    expect(result).not.toBeNull();
    expect(result!.civicNumber).toBe("3720");
    expect(result!.streetName).toBe("Avenue Kent");
    expect(result!.city).toBe("Montréal");
    expect(result!.province).toBe("QC");
    expect(result!.postal).toBe("H3S 1N3");
    expect(result!.postalFsa).toBe("H3S");
  });

  it("normalises a postal code returned without a space", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      civic_number: "100",
      civic_range: null,
      street_name: "Rue Principale",
      unit: null,
      city: "Granby",
      province: "QC",
      postal: "J2G0A1",   // ← no space
      unparseable: false,
    }));

    const result = await llmParseAddress("100 Rue Principale Granby QC J2G0A1");
    expect(result!.postal).toBe("J2G 0A1");
  });

  it("returns null when callAnthropic returns ok:false", async () => {
    mockCallAnthropic.mockResolvedValueOnce(FAILURE_RESULT);

    const result = await llmParseAddress("BROMONT QC J2L 2X5");
    expect(result).toBeNull();
  });

  it("returns null when Haiku marks the address as unparseable", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      civic_number: null,
      civic_range: null,
      street_name: null,
      unit: null,
      city: null,
      province: null,
      postal: null,
      unparseable: true,
    }));

    const result = await llmParseAddress("zzz gibberish not an address");
    expect(result).toBeNull();
  });

  it("returns null for an empty string input without calling the API", async () => {
    const result = await llmParseAddress("");
    expect(mockCallAnthropic).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("includes a unit field when Haiku extracts one", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      civic_number: "1020",
      civic_range: null,
      street_name: "Rue Levert",
      unit: "408",
      city: "Verdun",
      province: "QC",
      postal: "H3E 0G4",
      unparseable: false,
    }));

    const result = await llmParseAddress("408-1020 Rue Levert, Verdun QC H3E 0G4");
    expect(result!.unit).toBe("408");
    expect(result!.civicNumber).toBe("1020");
  });

  it("passes leadId to callAnthropic for cost tracking", async () => {
    mockCallAnthropic.mockResolvedValueOnce(makeSuccessResult({
      civic_number: "1", civic_range: null, street_name: "Rue Test",
      unit: null, city: "Montréal", province: "QC", postal: "H1A 1A1", unparseable: false,
    }));

    await llmParseAddress("1 Rue Test Montréal QC H1A1A1", { leadId: "lead-abc" });

    expect(mockCallAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "lead-abc", feature: "address_fallback" }),
    );
  });
});
