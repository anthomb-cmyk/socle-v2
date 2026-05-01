// Stage 2 — 411 / Directory Lookup
//
// Searches a phone directory for the owner by name + city.
// Currently a stub — wire up a real directory API by setting:
//   DIRECTORY_411_API_URL  e.g. https://api.canada411.com/v1/...
//   DIRECTORY_411_API_KEY
//
// ⚠️  CREDENTIAL NEEDED: Choose and configure a 411/directory API.
//     Recommended options for Quebec:
//       • Canada411 (Rogers) — https://www.canada411.ca
//       • Pages Jaunes API   — https://developer.pagesjaunes.ca
//     When configured, replace the stub body below with real API calls.

import type { LeadContext, StageResult } from "./types";

export async function runDirectorySearch(ctx: LeadContext): Promise<StageResult> {
  const apiUrl = process.env.DIRECTORY_411_API_URL;
  const apiKey = process.env.DIRECTORY_411_API_KEY;

  if (!apiUrl || !apiKey) {
    // Not configured — skip this stage cleanly
    return {
      found: false,
      reason: "DIRECTORY_411_API_URL / DIRECTORY_411_API_KEY not configured — stage skipped",
    };
  }

  // ── STUB ── Replace with real implementation once credentials are set.
  //
  // Search targets (in order of specificity):
  //   1. contact full name + mailing city + mailing postal
  //   2. contact full name + property city
  //   3. company name + mailing city
  //   4. company name + property city
  //   5. secondary contact name + city
  //
  // For each result:
  //   - extract E.164 phone
  //   - compare name/address similarity → derive confidence
  //   - assign source_label = "canada411" or "pages_jaunes"
  //   - assign initial_confidence = 70 (directory is more authoritative than web search)
  //
  // Example skeleton:
  //
  // const searchName = ctx.companyName ?? ctx.fullName ?? "";
  // const searchCity = ctx.mailingCity ?? ctx.propertyCity ?? "";
  // const r = await fetch(`${apiUrl}/person?name=${encodeURIComponent(searchName)}&city=${encodeURIComponent(searchCity)}`, {
  //   headers: { "X-Api-Key": apiKey },
  // });
  // const data = await r.json();
  // if (data.results?.length) {
  //   return {
  //     found: true,
  //     candidates: data.results.map((item: unknown) => ({
  //       phoneRaw: ...,
  //       phoneE164: ...,
  //       stage: "directory_411" as const,
  //       sourceLabel: "canada411",
  //       sourceUrl: item.profileUrl ?? null,
  //       snippet: `${item.name} — ${item.address}`,
  //       initialConfidence: 70,
  //     })),
  //   };
  // }

  void ctx; // suppress unused warning until implemented
  return { found: false, reason: "directory 411 stub — not yet implemented" };
}
