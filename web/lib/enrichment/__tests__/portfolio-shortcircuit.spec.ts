// Tests for Stage 0 and Stage 0.5 short-circuit helpers.
//
// All tests use a mock SupabaseClient — no real DB is hit.

import { describe, it, expect, vi } from "vitest";
import {
  tryExistingPhoneShortCircuit,
  tryCrossContactPortfolioMatch,
} from "../portfolio-shortcircuit";
import type { LeadContext } from "../types";

// ── Helpers ────────────────────────────────────────────────────────────────

const BASE_CTX: LeadContext = {
  leadId:          "lead-001",
  contactId:       "contact-001",
  enrichmentJobId: "job-001",
  fullName:        "Jean Tremblay",
  companyName:     "9123456 Canada Inc",
  secondaryName:   null,
  propertyAddress: "123 Rue Principale",
  propertyCity:    "Montréal",
  mailingAddress:  "123 Rue Principale, Montréal QC H2X 1A1",
  mailingCity:     "Montréal",
  mailingPostal:   "H2X 1A1",
  matricule:       null,
  numUnits:        null,
};

/**
 * Build a minimal Supabase mock.
 * `tableResponses` maps table name to a list of query responses (returned in
 * order). Each entry is a `{ data, error }` object for `.select()` calls, or
 * a `{ error }` object for `.upsert()` calls.
 *
 * Because the Supabase query builder chains methods (.select().eq().order()
 * etc.) we need every chainable method to return the same builder object
 * until the final await resolves it.
 */
function makeSb(tableHandlers: Record<string, () => Promise<{ data: unknown; error: unknown }>>) {
  const from = vi.fn((table: string) => {
    const handler = tableHandlers[table];

    // Build a chainable builder that resolves when awaited (then is called)
    const builder: Record<string, unknown> = {};
    const chainable = new Proxy(builder, {
      get(_target, prop) {
        if (prop === "then") {
          // Resolve the promise when awaited
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            (handler ? handler() : Promise.resolve({ data: [], error: null }))
              .then(resolve)
              .catch(reject);
          };
        }
        // All other chained methods return `this` (the same proxy)
        return () => chainable;
      },
    });
    return chainable;
  });

  return { sb: { from } as unknown as Parameters<typeof tryExistingPhoneShortCircuit>[0], from };
}

// ── Stage 0 — tryExistingPhoneShortCircuit ─────────────────────────────────

describe("Stage 0 — tryExistingPhoneShortCircuit", () => {
  it("returns hit:true when contact has a caller_verified phone", async () => {
    const { sb } = makeSb({
      phones: async () => ({
        data: [
          {
            e164: "+15149990001",
            source: "caller_verified",
            status: "valid",
            confidence: 95,
            updated_at: "2025-01-01T00:00:00Z",
          },
        ],
        error: null,
      }),
    });

    const result = await tryExistingPhoneShortCircuit(sb, BASE_CTX);
    expect(result.hit).toBe(true);
    expect(result.phoneE164).toBe("+15149990001");
    expect(result.source).toBe("caller_verified");
  });

  it("returns hit:true when contact has a status=valid phone (even if source is not caller_verified)", async () => {
    const { sb } = makeSb({
      phones: async () => ({
        data: [
          {
            e164: "+15149990002",
            source: "enrichment_other",
            status: "valid",
            confidence: 80,
            updated_at: "2025-01-02T00:00:00Z",
          },
        ],
        error: null,
      }),
    });

    const result = await tryExistingPhoneShortCircuit(sb, BASE_CTX);
    expect(result.hit).toBe(true);
    expect(result.phoneE164).toBe("+15149990002");
    expect(result.status).toBe("valid");
  });

  it("returns hit:false when contact has no phones", async () => {
    const { sb } = makeSb({
      phones: async () => ({ data: [], error: null }),
    });

    const result = await tryExistingPhoneShortCircuit(sb, BASE_CTX);
    expect(result.hit).toBe(false);
  });

  it("returns hit:false when DB returns an error", async () => {
    const { sb } = makeSb({
      phones: async () => ({ data: null, error: { message: "DB error" } }),
    });

    const result = await tryExistingPhoneShortCircuit(sb, BASE_CTX);
    expect(result.hit).toBe(false);
  });

  it("prefers caller_verified over valid-status phone", async () => {
    const { sb } = makeSb({
      phones: async () => ({
        data: [
          {
            e164: "+15149990010",
            source: "enrichment_other",
            status: "valid",
            confidence: 90,
            updated_at: "2025-03-01T00:00:00Z",
          },
          {
            e164: "+15149990011",
            source: "caller_verified",
            status: "unverified",
            confidence: 70,
            updated_at: "2025-01-01T00:00:00Z",
          },
        ],
        error: null,
      }),
    });

    const result = await tryExistingPhoneShortCircuit(sb, BASE_CTX);
    expect(result.hit).toBe(true);
    // caller_verified should win even though valid has higher confidence
    expect(result.phoneE164).toBe("+15149990011");
    expect(result.source).toBe("caller_verified");
  });
});

// ── Stage 0.5 — tryCrossContactPortfolioMatch ──────────────────────────────

describe("Stage 0.5 — tryCrossContactPortfolioMatch", () => {
  it("returns hit:false immediately when ctx.mailingPostal is null", async () => {
    const ctx = { ...BASE_CTX, mailingPostal: null };
    // No db calls should be needed; pass an empty handler map
    const { sb } = makeSb({});
    const result = await tryCrossContactPortfolioMatch(sb, ctx);
    expect(result.hit).toBe(false);
  });

  it("returns hit:true when another contact has same normalized full_name + same FSA + caller_verified phone", async () => {
    // contacts returns one other contact with same name + FSA
    const { sb } = makeSb({
      contacts: async () => ({
        data: [
          {
            id: "contact-other",
            full_name: "Jean Tremblay",       // same name, different casing handled by normalize
            company_name: null,
            mailing_postal: "H2X 2B3",        // FSA = H2X, matches ctx
          },
        ],
        error: null,
      }),
      phones: async () => {
        return {
          data: [
            {
              id: "phone-other-001",
              contact_id: "contact-other",
              e164: "+15141234567",
              source: "caller_verified",
              status: "unverified",
              confidence: 90,
              updated_at: "2025-01-01T00:00:00Z",
            },
          ],
          error: null,
        };
      },
    });

    const result = await tryCrossContactPortfolioMatch(sb, BASE_CTX);
    expect(result.hit).toBe(true);
    expect(result.matchedContactId).toBe("contact-other");
    expect(result.matchedPhoneId).toBe("phone-other-001");
    expect(result.phoneE164).toBe("+15141234567");
    expect(result.fsa).toBe("H2X");
    expect(result.matchField).toBe("fullName");
  });

  it("returns hit:false when name matches but FSA differs", async () => {
    const { sb } = makeSb({
      contacts: async () => ({
        data: [
          {
            id: "contact-other",
            full_name: "Jean Tremblay",
            company_name: null,
            mailing_postal: "G1V 3X9",  // FSA = G1V — Québec City, not H2X
          },
        ],
        error: null,
      }),
      phones: async () => ({
        data: [
          {
            id: "phone-other-001",
            contact_id: "contact-other",
            e164: "+14188880001",
            source: "caller_verified",
            status: "unverified",
            confidence: 90,
            updated_at: "2025-01-01T00:00:00Z",
          },
        ],
        error: null,
      }),
    });

    const result = await tryCrossContactPortfolioMatch(sb, BASE_CTX);
    expect(result.hit).toBe(false);
  });

  it("returns hit:false when name matches + FSA matches but phone is only unverified (not trusted)", async () => {
    const { sb } = makeSb({
      contacts: async () => ({
        data: [
          {
            id: "contact-other",
            full_name: "Jean Tremblay",
            company_name: null,
            mailing_postal: "H2X 2B3",
          },
        ],
        error: null,
      }),
      phones: async () => ({
        data: [
          {
            id: "phone-other-001",
            contact_id: "contact-other",
            e164: "+15141234567",
            source: "enrichment_other",  // NOT caller_verified
            status: "unverified",        // NOT valid
            confidence: 60,
            updated_at: "2025-01-01T00:00:00Z",
          },
        ],
        error: null,
      }),
    });

    const result = await tryCrossContactPortfolioMatch(sb, BASE_CTX);
    expect(result.hit).toBe(false);
    expect(result.ambiguous).toBeFalsy();
  });

  it("returns ambiguous:true when two qualifying contacts match", async () => {
    const { sb } = makeSb({
      contacts: async () => ({
        data: [
          {
            id: "contact-A",
            full_name: "Jean Tremblay",
            company_name: null,
            mailing_postal: "H2X 1C1",
          },
          {
            id: "contact-B",
            full_name: "Jean Tremblay",
            company_name: null,
            mailing_postal: "H2X 1D2",
          },
        ],
        error: null,
      }),
      phones: async () => ({
        data: [
          {
            id: "phone-A",
            contact_id: "contact-A",
            e164: "+15141111111",
            source: "caller_verified",
            status: "unverified",
            confidence: 90,
            updated_at: "2025-01-01T00:00:00Z",
          },
          {
            id: "phone-B",
            contact_id: "contact-B",
            e164: "+15142222222",
            source: "caller_verified",
            status: "unverified",
            confidence: 85,
            updated_at: "2025-02-01T00:00:00Z",
          },
        ],
        error: null,
      }),
    });

    const result = await tryCrossContactPortfolioMatch(sb, BASE_CTX);
    expect(result.hit).toBe(false);
    expect(result.ambiguous).toBe(true);
    expect(result.candidateContactIds).toHaveLength(2);
    expect(result.candidateContactIds).toContain("contact-A");
    expect(result.candidateContactIds).toContain("contact-B");
  });

  it("returns hit:true on company_name match when fullName does not match", async () => {
    const ctx = {
      ...BASE_CTX,
      fullName: null,                       // no full name — use company name only
      companyName: "Gestion Tremblay Inc",
    };

    const { sb } = makeSb({
      contacts: async () => ({
        data: [
          {
            id: "contact-other",
            full_name: null,
            company_name: "Gestion Tremblay Inc",
            mailing_postal: "H2X 3Z9",
          },
        ],
        error: null,
      }),
      phones: async () => ({
        data: [
          {
            id: "phone-other-001",
            contact_id: "contact-other",
            e164: "+15145559999",
            source: "enrichment_other",
            status: "valid",              // valid → trusted
            confidence: 80,
            updated_at: "2025-01-01T00:00:00Z",
          },
        ],
        error: null,
      }),
    });

    const result = await tryCrossContactPortfolioMatch(sb, ctx);
    expect(result.hit).toBe(true);
    expect(result.matchField).toBe("companyName");
    expect(result.phoneE164).toBe("+15145559999");
  });

  it("normalizes names before comparing (accents, casing)", async () => {
    // ctx has "Éric Beauchamp", other contact has "eric beauchamp" — should match
    const ctx = { ...BASE_CTX, fullName: "Éric Beauchamp" };

    const { sb } = makeSb({
      contacts: async () => ({
        data: [
          {
            id: "contact-other",
            full_name: "ERIC BEAUCHAMP",  // all-caps, no accent
            company_name: null,
            mailing_postal: "H2X 1Z1",
          },
        ],
        error: null,
      }),
      phones: async () => ({
        data: [
          {
            id: "phone-eric",
            contact_id: "contact-other",
            e164: "+15143334444",
            source: "caller_verified",
            status: "unverified",
            confidence: 92,
            updated_at: "2025-01-01T00:00:00Z",
          },
        ],
        error: null,
      }),
    });

    const result = await tryCrossContactPortfolioMatch(sb, ctx);
    expect(result.hit).toBe(true);
    expect(result.matchField).toBe("fullName");
  });
});
