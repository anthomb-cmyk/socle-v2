import { describe, expect, it } from "vitest";
import {
  buildEmailQueries,
  contextAroundEmail,
  extractEmailsFromText,
  scoreEmailCandidate,
} from "../email-search";

const ctx = {
  full_name: "Anthony Makeen",
  company_name: "Socle Acquisitions Inc",
  mailing_address: "123 Rue Saint-Paul",
  mailing_city: "Montreal",
  mailing_postal: "H2Y 1A1",
  property_city: "Montreal",
};

describe("email-search", () => {
  it("builds email-specific Brave queries", () => {
    const queries = buildEmailQueries(ctx);
    expect(queries).toContain('"Socle Acquisitions Inc" "Montreal" courriel');
    expect(queries).toContain('"Socle Acquisitions Inc" contact courriel');
    expect(queries.some((q) => q.includes("téléphone"))).toBe(false);
  });

  it("extracts direct and lightly obfuscated emails", () => {
    const emails = extractEmailsFromText(
      "Contact info@socleacquisitions.ca or anthony [at] socleacquisitions.ca. Do not use noreply@example.com.",
    );
    expect(emails).toContain("info@socleacquisitions.ca");
    expect(emails).toContain("anthony@socleacquisitions.ca");
    expect(emails).not.toContain("noreply@example.com");
  });

  it("scores company-domain page emails as reviewable", () => {
    const result = scoreEmailCandidate({
      haystack: "Socle Acquisitions Inc - Nous joindre. Courriel: info@socleacquisitions.ca. Montreal office.",
      domain: "socleacquisitions.ca",
      email: "info@socleacquisitions.ca",
      context: ctx,
      source: "page",
    });
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.reasons).toContain("company_domain");
  });

  it("keeps unrelated email snippets below the review threshold", () => {
    const result = scoreEmailCandidate({
      haystack: "Generic directory page with no matching company or city.",
      domain: "random-directory.ca",
      email: "hello@unrelated.ca",
      context: ctx,
      source: "snippet",
    });
    expect(result.score).toBeLessThan(50);
  });

  it("returns a compact context window around the email", () => {
    const text = "A".repeat(200) + " Contact: info@socleacquisitions.ca " + "B".repeat(200);
    const context = contextAroundEmail(text, "info@socleacquisitions.ca", 20);
    expect(context).toContain("info@socleacquisitions.ca");
    expect(context.length).toBeLessThan(90);
  });
});
