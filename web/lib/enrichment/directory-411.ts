// Stage — 411 / Directory Lookup (stub)
//
// ⚠️  NOT WIRED INTO THE ACTIVE PIPELINE.
// The v2 pipeline uses address_search → company_search → b2bhint → openclaw.
// This module is retained as a future hook for Canada411 / Pages Jaunes APIs
// once a subscription is confirmed.
//
// To activate: set DIRECTORY_411_API_URL + DIRECTORY_411_API_KEY,
// then insert a call to runDirectorySearch() between company_search and b2bhint
// in pipeline.ts.
//
// Credential options for Québec:
//   • Canada411 (Rogers) — https://www.canada411.ca
//   • Pages Jaunes API   — https://developer.pagesjaunes.ca
//   • AnnuaireQC         — local Québec directory

import type { LeadContext, StageResult } from "./types";

export async function runDirectorySearch(ctx: LeadContext): Promise<StageResult> {
  const apiUrl = process.env.DIRECTORY_411_API_URL;
  const apiKey = process.env.DIRECTORY_411_API_KEY;

  if (!apiUrl || !apiKey) {
    return {
      found: false,
      reason: "DIRECTORY_411_API_URL / DIRECTORY_411_API_KEY not configured — stage skipped",
    };
  }

  // ── STUB ── Replace with real implementation when credentials are available.
  //
  // Search order (most specific first):
  //   1. company name + mailing city + mailing postal
  //   2. company name + property city
  //   3. contact full name + mailing city
  //   4. secondary name + city
  //
  // For each result extract:
  //   phoneRaw, phoneE164, candidateName, candidateAddress
  //   confidence = 70 (directory more authoritative than web search)
  //   matchedOn: "company_name" | "director_name"
  //
  // Example skeleton:
  //
  // const searchName = ctx.companyName ?? ctx.fullName ?? "";
  // const searchCity = ctx.mailingCity ?? ctx.propertyCity ?? "";
  // const r = await fetch(`${apiUrl}/business?name=${encodeURIComponent(searchName)}&city=${encodeURIComponent(searchCity)}`, {
  //   headers: { "X-Api-Key": apiKey },
  // });
  // const data = await r.json();
  // if (data.results?.length) {
  //   return {
  //     found: true,
  //     candidates: data.results.map((item: unknown) => ({
  //       phoneRaw:          item.phone,
  //       phoneE164:         item.phone_e164 ?? null,
  //       stage:             "company_search" as const,
  //       matchedOn:         "company_name" as const,
  //       sourceLabel:       "canada411",
  //       sourceUrl:         item.profile_url ?? null,
  //       snippet:           `${item.name} — ${item.address}`,
  //       searchQuery:       searchName,
  //       candidateName:     item.name,
  //       candidateAddress:  item.address,
  //       relatedEntityName: null,
  //       relatedEntityType: null,
  //       initialConfidence: 70,
  //     })),
  //   };
  // }

  void ctx;
  return { found: false, reason: "directory 411 stub — not yet implemented" };
}
