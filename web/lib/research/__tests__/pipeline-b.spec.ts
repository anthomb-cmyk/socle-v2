/**
 * pipeline-b.spec.ts — Tests for the Pipeline B orchestrator.
 *
 * All external dependencies are mocked. Tests are deterministic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports of the unit under test
// ---------------------------------------------------------------------------

vi.mock("../classifier", () => ({
  routeOwner: vi.fn(),
}));

vi.mock("../db", () => ({
  insertEvidence: vi.fn(),
  insertHypothesis: vi.fn(),
}));

vi.mock("../researchers/reverse-address", () => ({
  reverseAddressResearcher: vi.fn(),
}));

vi.mock("../researchers/name-postal-directory", () => ({
  namePostalDirectoryResearcher: vi.fn(),
}));

vi.mock("../researchers/cross-property", () => ({
  crossPropertyResearcher: vi.fn(),
}));

vi.mock("../../twilio/lookup", () => ({
  lookupCallerName: vi.fn(),
}));

import { runPipelineB } from "../pipeline-b";
import * as classifier from "../classifier";
import * as db from "../db";
import * as reverseAddressMod from "../researchers/reverse-address";
import * as namePostalMod from "../researchers/name-postal-directory";
import * as crossPropertyMod from "../researchers/cross-property";
import * as twilioLookupMod from "../../twilio/lookup";

// ---------------------------------------------------------------------------
// Typed mock refs
// ---------------------------------------------------------------------------

const mockRouteOwner = classifier.routeOwner as ReturnType<typeof vi.fn>;
const mockInsertEvidence = db.insertEvidence as ReturnType<typeof vi.fn>;
const mockInsertHypothesis = db.insertHypothesis as ReturnType<typeof vi.fn>;
const mockReverseAddress = reverseAddressMod.reverseAddressResearcher as ReturnType<typeof vi.fn>;
const mockNamePostal = namePostalMod.namePostalDirectoryResearcher as ReturnType<typeof vi.fn>;
const mockCrossProperty = crossPropertyMod.crossPropertyResearcher as ReturnType<typeof vi.fn>;
const mockTwilioLookup = twilioLookupMod.lookupCallerName as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_ID = "owner-pipeline-b-001";

const fakeOwner = {
  owner_id: OWNER_ID,
  owner_type: "individual",
  canonical_name: "Jean Tremblay",
  canonical_name_normalized: "jean tremblay",
  neq: null,
  mailing_address_raw: "123 Rue Principale, Montréal, QC H3B 1A1",
  mailing_geocode: null,
  mailing_postal_fsa: "H3B",
  dedupe_status: "pending_review",
  is_aggregator_address: false,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

const routingDecisionB = {
  pipeline: "B",
  isAggregator: false,
  reason: "individual with no geocode match or director record",
};

const routingDecisionBWithDirector = {
  pipeline: "B",
  isAggregator: false,
  reason: "individual identified as director in REQ",
  reqEnrichment: {
    isDirector: true,
    directorOf: [
      {
        neq: "9001",
        legal_name: "Corp XYZ",
        legal_name_normalized: "corp xyz",
        juridical_form: null,
        status: "ACTIF",
        status_date: null,
        registered_address_raw: null,
        mailing_address_raw: null,
        registered_geocode: null,
        mailing_geocode: null,
        postal_fsa: null,
        registered_phone: "+15140009999",
        activity_codes: null,
        imported_at: "2025-01-01T00:00:00Z",
      },
    ],
  },
};

function makeSb() {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: fakeOwner, error: null }),
  };
  return {
    from: vi.fn().mockReturnValue(chain),
    _chain: chain,
  } as unknown as Parameters<typeof runPipelineB>[0];
}

function makeHypResult(id: string) {
  return { data: { hypothesis_id: id }, error: null };
}

/** Build a name_postal_directory candidate with postal corroboration */
function makeNamePostalCandidate(phone: string, postalCorroborated: boolean, directoryMatch: boolean) {
  return {
    evidenceId: `ev-npd-${phone}`,
    source: "name_postal_directory" as const,
    phone,
    isAuthoritative: false,
    sourceUrl: "https://www.canada411.ca/result",
    postalCorroborated,
    directoryMatch,
  };
}

function makeReverseCandidate(phone: string) {
  return {
    evidenceId: `ev-ra-${phone}`,
    source: "reverse_address" as const,
    phone,
    isAuthoritative: false,
    sourceUrl: "https://example.ca",
  };
}

function makeCrossCandidate(phone: string) {
  return {
    evidenceId: `ev-cp-${phone}`,
    source: "cross_property" as const,
    phone,
    isAuthoritative: false,
    sourceUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockInsertEvidence.mockResolvedValue({ data: { evidence_id: "ev-001" }, error: null });
  mockInsertHypothesis.mockResolvedValue(makeHypResult("hyp-001"));
  mockReverseAddress.mockResolvedValue([]);
  mockNamePostal.mockResolvedValue([]);
  mockCrossProperty.mockResolvedValue([]);
  mockTwilioLookup.mockResolvedValue({
    caller_name: null,
    caller_type: null,
    line_type: null,
    cached: false,
    error: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set",
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPipelineB — routing guard", () => {
  it("throws when routeOwner returns Pipeline A", async () => {
    mockRouteOwner.mockResolvedValue({ pipeline: "A", isAggregator: false, reason: "company owner" });
    const sb = makeSb();

    await expect(runPipelineB(sb, OWNER_ID)).rejects.toThrow(/Pipeline A/);
  });
});

describe("runPipelineB — tier A (postal corroboration)", () => {
  it("two independent sources both postal-corroborated → tier A, accepted", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionB);
    const phone = "+15141234567";

    // reverse_address finds the phone
    mockReverseAddress.mockResolvedValue([makeReverseCandidate(phone)]);
    // name_postal_directory also finds it, with postal corroboration
    mockNamePostal.mockResolvedValue([makeNamePostalCandidate(phone, true, true)]);

    let capturedHyp: Record<string, unknown> | undefined;
    mockInsertHypothesis.mockImplementation(async (_sb: unknown, h: Record<string, unknown>) => {
      capturedHyp = h;
      return { data: { hypothesis_id: "hyp-tier-a", ...h }, error: null };
    });

    const sb = makeSb();
    const result = await runPipelineB(sb, OWNER_ID);

    expect(capturedHyp?.tier).toBe("A");
    expect(capturedHyp?.status).toBe("accepted");
    expect(capturedHyp?.confidence_label).toBe("confirmed");
    expect(result.primaryHypothesisId).toBe("hyp-tier-a");
  });

  it("directory match + reverse-address with same FSA → tier A (postal_corroborated)", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionB);
    const phone = "+15141112222";

    mockReverseAddress.mockResolvedValue([makeReverseCandidate(phone)]);
    mockNamePostal.mockResolvedValue([
      makeNamePostalCandidate(phone, true, true),  // postal corroborated, directory match
    ]);

    let capturedTier: string | undefined;
    mockInsertHypothesis.mockImplementation(async (_sb: unknown, h: Record<string, unknown>) => {
      capturedTier = h.tier as string;
      return { data: { hypothesis_id: "hyp-tier-a-2", ...h }, error: null };
    });

    const sb = makeSb();
    await runPipelineB(sb, OWNER_ID);

    expect(capturedTier).toBe("A");
  });
});

describe("runPipelineB — tier B", () => {
  it("two independent sources but neither postal-corroborated → tier B, candidate", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionB);
    const phone = "+15143334444";

    mockReverseAddress.mockResolvedValue([makeReverseCandidate(phone)]);
    // directory match but NO postal corroboration
    mockNamePostal.mockResolvedValue([makeNamePostalCandidate(phone, false, true)]);

    let capturedHyp: Record<string, unknown> | undefined;
    mockInsertHypothesis.mockImplementation(async (_sb: unknown, h: Record<string, unknown>) => {
      capturedHyp = h;
      return { data: { hypothesis_id: "hyp-tier-b", ...h }, error: null };
    });

    const sb = makeSb();
    const result = await runPipelineB(sb, OWNER_ID);

    expect(capturedHyp?.tier).toBe("B");
    expect(capturedHyp?.status).toBe("candidate");
    expect(result.primaryHypothesisId).toBeUndefined();
  });
});

describe("runPipelineB — tier C", () => {
  it("single directory match only → tier C, candidate", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionB);
    const phone = "+15145556666";

    // Only a directory match, no other source, no postal corroboration
    mockNamePostal.mockResolvedValue([makeNamePostalCandidate(phone, false, true)]);

    let capturedHyp: Record<string, unknown> | undefined;
    mockInsertHypothesis.mockImplementation(async (_sb: unknown, h: Record<string, unknown>) => {
      capturedHyp = h;
      return { data: { hypothesis_id: "hyp-tier-c", ...h }, error: null };
    });

    const sb = makeSb();
    await runPipelineB(sb, OWNER_ID);

    expect(capturedHyp?.tier).toBe("C");
    expect(capturedHyp?.status).toBe("candidate");
    expect(capturedHyp?.confidence_label).toBe("connected");
  });
});

describe("runPipelineB — tier D", () => {
  it("phone from director-of-other-entity → tier D, candidate", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionBWithDirector);

    // The director entity's registered_phone "+15140009999" is fed via cross-property
    const directorPhone = "+15140009999";
    mockCrossProperty.mockResolvedValue([makeCrossCandidate(directorPhone)]);

    let capturedHyp: Record<string, unknown> | undefined;
    mockInsertHypothesis.mockImplementation(async (_sb: unknown, h: Record<string, unknown>) => {
      capturedHyp = h;
      return { data: { hypothesis_id: "hyp-tier-d", ...h }, error: null };
    });

    const sb = makeSb();
    await runPipelineB(sb, OWNER_ID);

    expect(capturedHyp?.tier).toBe("D");
    expect(capturedHyp?.status).toBe("candidate");
    expect(capturedHyp?.confidence_label).toBe("connected");
  });
});

describe("runPipelineB — tier E", () => {
  it("single weak source (cross_property only, no directory) → tier E, rejected", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionB);
    const phone = "+15147778888";

    mockCrossProperty.mockResolvedValue([makeCrossCandidate(phone)]);

    let capturedHyp: Record<string, unknown> | undefined;
    mockInsertHypothesis.mockImplementation(async (_sb: unknown, h: Record<string, unknown>) => {
      capturedHyp = h;
      return { data: { hypothesis_id: "hyp-tier-e", ...h }, error: null };
    });

    const sb = makeSb();
    await runPipelineB(sb, OWNER_ID);

    expect(capturedHyp?.tier).toBe("E");
    expect(capturedHyp?.status).toBe("rejected");
    expect(capturedHyp?.status_reason).toBe("single_weak_source");
  });
});

describe("runPipelineB — Twilio corroboration", () => {
  it("Twilio caller_name match raises tier B → A (adds postalCorroborated via twilio)", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionB);
    const phone = "+15149990000";

    // Two sources: reverse + name_postal_directory (directory match, no postal corroborated)
    mockReverseAddress.mockResolvedValue([makeReverseCandidate(phone)]);
    mockNamePostal.mockResolvedValue([makeNamePostalCandidate(phone, false, true)]);

    // Twilio returns a name that matches "Jean Tremblay"
    mockTwilioLookup.mockResolvedValue({
      caller_name: "Jean Tremblay",
      caller_type: "consumer",
      line_type: "landline",
      cached: false,
    });
    mockInsertEvidence.mockResolvedValue({ data: { evidence_id: "ev-twilio-1" }, error: null });

    let capturedTier: string | undefined;
    mockInsertHypothesis.mockImplementation(async (_sb: unknown, h: Record<string, unknown>) => {
      capturedTier = h.tier as string;
      return { data: { hypothesis_id: "hyp-twilio-upgrade", ...h }, error: null };
    });

    const sb = makeSb();
    await runPipelineB(sb, OWNER_ID);

    // Twilio corroboration adds postalCorroborated=true → tier A
    expect(capturedTier).toBe("A");
    expect(mockInsertEvidence).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "twilio_caller_name" }),
    );
  });
});

describe("runPipelineB — no candidates", () => {
  it("returns 0 evidence, 0 hypotheses, no primaryHypothesisId when all researchers return empty", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionB);

    const sb = makeSb();
    const result = await runPipelineB(sb, OWNER_ID);

    expect(result.evidenceCount).toBe(0);
    expect(result.hypothesisIds).toHaveLength(0);
    expect(result.primaryHypothesisId).toBeUndefined();
    expect(mockInsertHypothesis).not.toHaveBeenCalled();
  });
});
