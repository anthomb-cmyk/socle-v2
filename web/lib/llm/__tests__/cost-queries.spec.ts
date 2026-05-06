import { describe, it, expect } from "vitest";
import { rangeToSince, rangeToDays } from "../cost-queries";

describe("rangeToSince", () => {
  it("returns null for 'all'", () => {
    expect(rangeToSince("all")).toBeNull();
  });

  it("returns a timestamp roughly 24 hours ago for '24h'", () => {
    const before = Date.now();
    const result = rangeToSince("24h");
    const after = Date.now();
    expect(result).not.toBeNull();
    const ts = new Date(result!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 24 * 60 * 60 * 1000 - 100);
    expect(ts).toBeLessThanOrEqual(after - 24 * 60 * 60 * 1000 + 100);
  });

  it("returns a timestamp roughly 7 days ago for '7d'", () => {
    const before = Date.now();
    const result = rangeToSince("7d");
    const after = Date.now();
    expect(result).not.toBeNull();
    const ts = new Date(result!).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(ts).toBeGreaterThanOrEqual(before - sevenDaysMs - 100);
    expect(ts).toBeLessThanOrEqual(after - sevenDaysMs + 100);
  });

  it("returns a timestamp roughly 30 days ago for '30d'", () => {
    const before = Date.now();
    const result = rangeToSince("30d");
    const after = Date.now();
    expect(result).not.toBeNull();
    const ts = new Date(result!).getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(ts).toBeGreaterThanOrEqual(before - thirtyDaysMs - 100);
    expect(ts).toBeLessThanOrEqual(after - thirtyDaysMs + 100);
  });
});

describe("rangeToDays", () => {
  it("returns 1 for '24h'", () => expect(rangeToDays("24h")).toBe(1));
  it("returns 7 for '7d'", () => expect(rangeToDays("7d")).toBe(7));
  it("returns 30 for '30d'", () => expect(rangeToDays("30d")).toBe(30));
  it("returns 30 for 'all' (projection fallback)", () => expect(rangeToDays("all")).toBe(30));
});
