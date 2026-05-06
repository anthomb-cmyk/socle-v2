// Tests for lib/portfolio/detector.ts
//
// All Supabase calls are mocked — no real DB connection needed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { refreshPortfolioFlags, getPortfolioInfo } from "../detector";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Bare minimum chainable builder that resolves with the given data/error. */
function resolved<T>(data: T, error: null = null) {
  return { data, error };
}

// ── refreshPortfolioFlags tests ──────────────────────────────────────────────

describe("refreshPortfolioFlags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns updated:0 when property_contacts is empty", async () => {
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "property_contacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue(resolved([])),
            }),
          };
        }
        // contacts.gt query for non-zero contacts
        return {
          select: vi.fn().mockReturnValue({
            gt: vi.fn().mockResolvedValue(resolved([])),
          }),
        };
      }),
    } as unknown as SupabaseClient;

    const result = await refreshPortfolioFlags(sb);
    expect(result.updated).toBe(0);
  });

  it("marks contacts with >= 3 properties as portfolio owners", async () => {
    // Simulate 3 properties owned by contact-A and 1 by contact-B
    const pcRows = [
      { contact_id: "contact-A", property_id: "p1" },
      { contact_id: "contact-A", property_id: "p2" },
      { contact_id: "contact-A", property_id: "p3" },
      { contact_id: "contact-B", property_id: "p4" },
    ];

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const sb = {
      from: vi.fn((table: string) => {
        if (table === "property_contacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue(resolved(pcRows)),
            }),
          };
        }
        if (table === "contacts") {
          return {
            update: updateMock,
            select: vi.fn().mockReturnValue({
              gt: vi.fn().mockResolvedValue(resolved([])),
            }),
          };
        }
        return { select: vi.fn(), update: updateMock };
      }),
    } as unknown as SupabaseClient;

    const result = await refreshPortfolioFlags(sb);
    expect(result.updated).toBe(2); // contact-A and contact-B both updated

    // Check contact-A was flagged as portfolio owner (cnt=3)
    const aCall = updateMock.mock.calls.find((call: unknown[]) => {
      const arg = call[0] as { is_portfolio_owner?: boolean };
      return arg.is_portfolio_owner === true;
    });
    expect(aCall).toBeDefined();

    // Check contact-B was NOT flagged as portfolio owner (cnt=1)
    const bCall = updateMock.mock.calls.find((call: unknown[]) => {
      const arg = call[0] as { is_portfolio_owner?: boolean };
      return arg.is_portfolio_owner === false;
    });
    expect(bCall).toBeDefined();
  });

  it("returns updated:0 when property_contacts query errors", async () => {
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "property_contacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: { message: "table not found" } }),
            }),
          };
        }
        return { select: vi.fn() };
      }),
    } as unknown as SupabaseClient;

    const result = await refreshPortfolioFlags(sb);
    expect(result.updated).toBe(0);
  });
});

// ── getPortfolioInfo tests ───────────────────────────────────────────────────

describe("getPortfolioInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns portfolio data for a contact who owns multiple properties", async () => {
    const contactData = { property_count: 3, is_portfolio_owner: true };
    const pcData = [
      { properties: { address: "10 Rue A", city: "Montréal", num_units: 8 } },
      { properties: { address: "20 Rue B", city: "Laval", num_units: 6 } },
      { properties: { address: "30 Rue C", city: "Montréal", num_units: 12 } },
    ];

    const sb = {
      from: vi.fn((table: string) => {
        if (table === "contacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue(resolved(contactData)),
              }),
            }),
          };
        }
        if (table === "property_contacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue(resolved(pcData)),
              }),
            }),
          };
        }
        return { select: vi.fn() };
      }),
    } as unknown as SupabaseClient;

    const info = await getPortfolioInfo("contact-A", sb);
    expect(info.propertyCount).toBe(3);
    expect(info.isPortfolio).toBe(true);
    expect(info.properties).toHaveLength(3);
    expect(info.properties[0].address).toBe("10 Rue A");
    expect(info.properties[1].city).toBe("Laval");
  });

  it("returns zeroed data for a contact with no properties", async () => {
    const contactData = { property_count: 0, is_portfolio_owner: false };

    const sb = {
      from: vi.fn((table: string) => {
        if (table === "contacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue(resolved(contactData)),
              }),
            }),
          };
        }
        if (table === "property_contacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue(resolved([])),
              }),
            }),
          };
        }
        return { select: vi.fn() };
      }),
    } as unknown as SupabaseClient;

    const info = await getPortfolioInfo("contact-empty", sb);
    expect(info.propertyCount).toBe(0);
    expect(info.isPortfolio).toBe(false);
    expect(info.properties).toHaveLength(0);
  });

  it("handles null contact row gracefully", async () => {
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "contacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue(resolved(null)),
              }),
            }),
          };
        }
        if (table === "property_contacts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue(resolved([])),
              }),
            }),
          };
        }
        return { select: vi.fn() };
      }),
    } as unknown as SupabaseClient;

    const info = await getPortfolioInfo("contact-null", sb);
    expect(info.propertyCount).toBe(0);
    expect(info.isPortfolio).toBe(false);
  });
});
