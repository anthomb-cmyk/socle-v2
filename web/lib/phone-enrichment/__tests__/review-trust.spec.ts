import { describe, expect, it } from "vitest";
import { classifyPhoneReviewTrust } from "../review-trust";

describe("phone review trust classification", () => {
  it("treats req_address_lookup as an owner link, not a phone source by itself", () => {
    const result = classifyPhoneReviewTrust({
      candidate_status: "weak_review",
      source_label: "req_address_lookup",
      source_url: null,
      initial_confidence: 80,
      openclaw_verdict: "likely_match",
    });

    expect(result.ownerLinkSource.label).toBe("Lien REQ");
    expect(result.phoneEvidenceSource.phoneBearing).toBe(false);
    expect(result.reviewPriority).toBe("judgment");
  });

  it("keeps name_postal_directory phone-bearing but review-only", () => {
    const result = classifyPhoneReviewTrust({
      candidate_status: "needs_anthony_review",
      source_label: "name_postal_directory",
      source_url: "https://www.canada411.ca/search/si/1/Tremblay/J2S",
      initial_confidence: 82,
      openclaw_verdict: "likely_match",
    });

    expect(result.phoneEvidenceSource.kind).toBe("directory");
    expect(result.phoneEvidenceSource.phoneBearing).toBe(true);
    expect(result.reviewPriority).toBe("judgment");
  });

  it("marks PDF and generic dump evidence as likely noise", () => {
    const result = classifyPhoneReviewTrust({
      candidate_status: "weak_review",
      source_label: "company_website",
      source_url: "https://example.com/wp-content/uploads/phones.pdf",
      snippet: "Tel 450 555 0001 Tel 450 555 0002 Tel 450 555 0003 Tel 450 555 0004",
      initial_confidence: 72,
    });

    expect(result.reviewPriority).toBe("noisy");
    expect(result.noisyReason).toBeTruthy();
  });

  it("allows a clean specific web source to become priority", () => {
    const result = classifyPhoneReviewTrust({
      candidate_status: "needs_anthony_review",
      source_label: "company_website",
      source_url: "https://gestion-example.ca/contact",
      initial_confidence: 76,
      openclaw_verdict: "uncertain",
    });

    expect(result.phoneEvidenceSource.kind).toBe("business_site");
    expect(result.reviewPriority).toBe("priority");
  });

  it("does not treat a REQ URL as phone-bearing unless the evidence shows a phone", () => {
    const result = classifyPhoneReviewTrust({
      candidate_status: "needs_anthony_review",
      source_label: "company_website",
      source_url: "https://www.registreentreprises.gouv.qc.ca/fiche",
      snippet: "Entreprise active, adresse postale seulement",
      initial_confidence: 91,
      openclaw_verdict: "likely_match",
    });

    expect(result.phoneEvidenceSource.phoneBearing).toBe(false);
    expect(result.reviewPriority).toBe("judgment");
  });
});
