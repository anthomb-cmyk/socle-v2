/**
 * pipeline-a.spec.ts — Tests for the Pipeline A orchestrator.
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

vi.mock("../researchers/req-phone", () => ({
  reqPhoneResearcher: vi.fn(),
}));

vi.mock("../researchers/company-website", () => ({
  companyWebsiteResearcher: vi.fn(),
}));

vi.mock("../researchers/pages-jaunes-business", () => ({
  pagesJaunesBusinessResearcher: vi.fn(),
}));

vi.mock("../../twilio/lookup", () => ({
  lookupCallerName: vi.fn(),
}));

import { runPipelineA } from "../pipeline-a";
import * as classifier from "../classifier";
import * as db from "../db";
import * as reqPhoneMod from "../researchers/req-phone";
import * as cwMod from "../researchers/company-website";
import * as pjMod from "../researchers/pages-jaunes-business";
import * as twilioLookupMod from "../../twilio/lookup";

// ---------------------------------------------------------------------------
// Typed mock refs
// ---------------------------------------------------------------------------

const mockRouteOwner = classifier.routeOwner as ReturnType<typeof vi.fn>;
const mockInsertEvidence = db.insertEvidence as ReturnType<typeof vi.fn>;
const mockInsertHypothesis = db.insertHypothesis as ReturnType<typeof vi.fn>;
const mockReqPhone = reqPhoneMod.reqPhoneResearcher as ReturnType<typeof vi.fn>;
const mockCW = cwMod.companyWebsiteResearcher as ReturnType<typeof vi.fn>;
const mockPJ = pjMod.pagesJaunesBusinessResearcher as ReturnType<typeof vi.fn>;
const mockTwilioLookup = twilioLookupMod.lookupCallerName as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_ID = "owner-pipeline-a-001";

const fakeOwner = {
  owner_id: OWNER_ID,
  owner_type: "named_co",
  canonical_name: "Gestion Tremblay Inc",
  canonical_name_normalized: "gestion tremblay",
  neq: "9000000001",
  mailing_address_raw: null,
  mailing_geocode: null,
  mailing_postal_fsa: null,
  dedupe_status: "pending_review",
  is_aggregator_address: false,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

const fakeTarget = {
  neq: "9000000001",
  legal_name: "Gestion Tremblay Inc",
  legal_name_normalized: "gestion tremblay",
  juridical_form: null,
  status: "ACTIF",
  status_date: null,
  registered_address_raw: null,
  mailing_address_raw: null,
  registered_geocode: null,
  mailing_geocode: null,
  postal_fsa: null,
  registered_phone: "+15141234567",
  activity_codes: null,
  imported_at: "2025-01-01T00:00:00Z",
};

const routingDecisionA = {
  pipeline: "A",
  primaryTarget: fakeTarget,
  isAggregator: false,
  reason: "company owner",
};

// Build a minimal Supabase mock that returns fakeOwner on canonical_owner select
function makeSb() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: fakeOwner, error: null });
  return {
    from: vi.fn().mockReturnValue(chain),
    _chain: chain,
  } as unknown as Parameters<typeof runPipelineA>[0];
}

function makeHypResult(id: string) {
  return { data: { hypothesis_id: id }, error: null };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Safe defaults
  mockInsertEvidence.mockResolvedValue({ data: { evidence_id: "ev-001" }, error: null });
  mockInsertHypothesis.mockResolvedValue(makeHypResult("hyp-001"));
  mockReqPhone.mockResolvedValue([]);
  mockCW.mockResolvedValue([]);
  mockPJ.mockResolvedValue([]);
  mockTwilioLookup.mockResolvedValue({
    caller_name: null,
    caller_type: null,
    line_type: null,
    cached: false,
    error: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set",
  });
});

describe("runPipelineA — routing guard", () => {
  it("throws when routeOwner returns Pipeline B", async () => {
    mockRouteOwner.mockResolvedValue({ pipeline: "B", isAggregator: false, reason: "individual" });
    const sb = makeSb();

    await expect(runPipelineA(sb, OWNER_ID)).rejects.toThrow(/Pipeline B/);
  });
});

describe("runPipelineA — tier computation", () => {
  it("single REQ phone source → tier B (1 authoritative source)", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionA);
    mockReqPhone.mockResolvedValue([
      { evidenceId: "ev-req-1", source: "req_phone", phone: "+15141234567", isAuthoritative: true },
    ]);
    mockInsertHypothesis.mockImplementation(async (_sb: unknown, h: Record<string, unknown>) => ({
      data: { hypothesis_id: "hyp-b-1", ...h },
      error: null,
    }));
    const sb = makeSb();

    const result = await runPipelineA(sb, OWNER_ID);

    expect(mockInsertHypothesis).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tier: "B", confidence_label: "likely", status: "accepted" }),
    );
    expect(result.primaryHypothesisId).toBe("hyp-b-1");
  });

  it("REQ phone + company_website same number → tier A (2 sources, 1 authoritative)", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionA);
    mockReqPhone.mockResolvedValue([
      { evidenceId: "ev-req-1", source: "req_phone", phone: "+15141234567", isAuthoritative: true },
    ]);
    mockCW.mockResolvedValue([
      { evidenceId: "ev-cw-1", source: "company_website", phone: "+15141234567", isAuthoritative: false },
    ]);
    let capturedTier: string | undefined;
    mockInsertHypothesis.mockImplementation(async (_sb: unknown, h: Record<string, unknown>) => {
      capturedTier = h.tier as string;
      return { data: { hypothesis_id: "hyp-a-1", ...h }, error: null };
    });
    const sb = makeSb();

    await runPipelineA(sb, OWNER_ID);

    expect(capturedTier).toBe("A");
    expect(mockInsertHypothesis).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tier: "A",
        confidence_label: "confirmed",
        status: "accepted",
      }),
    );
  });

  it("directory-only (pages_jaunes only) → tier C, status candidate", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionA);
    mockPJ.mockResolvedValue([
      { evidenceId: "ev-pj-1", source: "pages_jaunes_business", phone: "+15145559999", isAuthoritative: false },
    ]);
    let capturedStatus: string | undefined;
    mockInsertHypothesis.mockImplementation(async (_sb: unknown, h: Record<string, unknown>) => {
      capturedStatus = h.status as string;
      return { data: { hypothesis_id: "hyp-c-1", ...h }, error: null };
    });
    const sb = makeSb();

    await runPipelineA(sb, OWNER_ID);

    expect(capturedStatus).toBe("candidate");
    expect(mockInsertHypothesis).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tier: "C", confidence_label: "connected" }),
    );
  });

  it("Twilio name match adds corroboration, upgrading from C to A", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionA);
    mockReqPhone.mockResolvedValue([
      { evidenceId: "ev-req-1", source: "req_phone", phone: "+15141234567", isAuthoritative: true },
    ]);
    mockCW.mockResolvedValue([
      { evidenceId: "ev-cw-1", source: "company_website", phone: "+15141234567", isAuthoritative: false },
    ]);
    // Twilio matches the entity name
    mockTwilioLookup.mockResolvedValue({
      caller_name: "Gestion Tremblay",
      caller_type: "business",
      line_type: "landline",
      cached: false,
    });
    mockInsertEvidence.mockResolvedValue({ data: { evidence_id: "ev-twilio-1" }, error: null });
    let capturedTier: string | undefined;
    mockInsertHypothesis.mockImplementation(async (_sb: unknown, h: Record<string, unknown>) => {
      capturedTier = h.tier as string;
      return { data: { hypothesis_id: "hyp-a-twilio", ...h }, error: null };
    });
    const sb = makeSb();

    await runPipelineA(sb, OWNER_ID);

    // With req_phone + twilio_caller_name (both authoritative) + company_website → still tier A
    expect(capturedTier).toBe("A");
    // Twilio evidence was inserted
    expect(mockInsertEvidence).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "twilio_caller_name" }),
    );
  });

  it("Twilio name mismatch does NOT add corroboration", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionA);
    mockPJ.mockResolvedValue([
      { evidenceId: "ev-pj-1", source: "pages_jaunes_business", phone: "+15145559999", isAuthoritative: false },
    ]);
    // Twilio returns a name that does NOT match "Gestion Tremblay Inc"
    mockTwilioLookup.mockResolvedValue({
      caller_name: "Some Unrelated Person",
      caller_type: "consumer",
      line_type: "mobile",
      cached: false,
    });
    let capturedTier: string | undefined;
    mockInsertHypothesis.mockImplementation(async (_sb: unknown, h: Record<string, unknown>) => {
      capturedTier = h.tier as string;
      return { data: { hypothesis_id: "hyp-no-twilio", ...h }, error: null };
    });
    const sb = makeSb();

    await runPipelineA(sb, OWNER_ID);

    // Should still be tier C — Twilio mismatch should not have added evidence
    expect(capturedTier).toBe("C");
    expect(mockInsertEvidence).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "twilio_caller_name" }),
    );
  });

  it("missing Twilio env → researcher logged but pipeline continues", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionA);
    mockReqPhone.mockResolvedValue([
      { evidenceId: "ev-req-1", source: "req_phone", phone: "+15141234567", isAuthoritative: true },
    ]);
    // Twilio env missing — lookupCallerName returns error
    mockTwilioLookup.mockResolvedValue({
      caller_name: null,
      caller_type: null,
      line_type: null,
      cached: false,
      error: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set",
    });
    mockInsertHypothesis.mockResolvedValue(makeHypResult("hyp-no-env"));
    const sb = makeSb();

    // Should NOT throw
    const result = await runPipelineA(sb, OWNER_ID);

    expect(result.hypothesisIds).toHaveLength(1);
    // Tier B from req_phone alone
    expect(mockInsertHypothesis).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tier: "B" }),
    );
  });

  it("no candidates → returns 0 evidence and 0 hypotheses", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionA);
    mockReqPhone.mockResolvedValue([]);
    mockCW.mockResolvedValue([]);
    mockPJ.mockResolvedValue([]);
    const sb = makeSb();

    const result = await runPipelineA(sb, OWNER_ID);

    expect(result.evidenceCount).toBe(0);
    expect(result.hypothesisIds).toHaveLength(0);
    expect(result.primaryHypothesisId).toBeUndefined();
    expect(mockInsertHypothesis).not.toHaveBeenCalled();
  });

  it("primaryHypothesisId picks highest-tier hypothesis when multiple phones found", async () => {
    mockRouteOwner.mockResolvedValue(routingDecisionA);
    // Phone 1: REQ (tier B)
    mockReqPhone.mockResolvedValue([
      { evidenceId: "ev-req-1", source: "req_phone", phone: "+15141111111", isAuthoritative: true },
    ]);
    // Phone 2: Pages Jaunes only (tier C)
    mockPJ.mockResolvedValue([
      { evidenceId: "ev-pj-1", source: "pages_jaunes_business", phone: "+15142222222", isAuthoritative: false },
    ]);

    let callCount = 0;
    mockInsertHypothesis.mockImplementation(async (_sb: unknown, h: Record<string, unknown>) => {
      callCount++;
      const id = h.tier === "B" ? "hyp-tier-b" : "hyp-tier-c";
      return { data: { hypothesis_id: id, ...h }, error: null };
    });
    const sb = makeSb();

    const result = await runPipelineA(sb, OWNER_ID);

    expect(callCount).toBe(2);
    // Primary should be the tier-B one
    expect(result.primaryHypothesisId).toBe("hyp-tier-b");
  });
});
