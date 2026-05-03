// Google Places API — optional supplement to company search.
//
// ⚠️  NOT WIRED INTO THE ACTIVE PIPELINE.
// The v2 pipeline uses address_search → company_search (Brave) → b2bhint → openclaw.
// This module is retained as an optional enhancement for company_search:
// if Brave finds nothing for a company name, Google Places can confirm
// whether that company has a listed business phone.
//
// To activate: set GOOGLE_PLACES_API_KEY in Railway env vars,
// then call runPlaceApiSearch() as a second pass inside company_search,
// or as an additional stage between company_search and b2bhint.
//
// Billing: Google Cloud Console → Places API (New). First $200/month free.

import type { LeadContext, StageResult, PhoneCandidate } from "./types";
import { extractPhonesFromValue } from "@/lib/role-parser/phone-utils";

const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

interface PlacesResult {
  displayName?:           { text?: string };
  formattedAddress?:      string;
  nationalPhoneNumber?:   string;
  internationalPhoneNumber?: string;
  websiteUri?:            string;
  id?:                    string;
}
interface PlacesResponse {
  places?: PlacesResult[];
}

async function searchPlaces(query: string, apiKey: string): Promise<PlacesResult[]> {
  const res = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "X-Goog-Api-Key":  apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.nationalPhoneNumber," +
        "places.internationalPhoneNumber,places.websiteUri,places.id",
    },
    body: JSON.stringify({
      textQuery:       query,
      languageCode:    "fr",
      regionCode:      "CA",
      maxResultCount:  3,
    }),
  });
  if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as PlacesResponse;
  return data.places ?? [];
}

export async function runPlaceApiSearch(ctx: LeadContext): Promise<StageResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return { found: false, reason: "GOOGLE_PLACES_API_KEY not configured — stage skipped" };
  }

  const searchName = ctx.companyName ?? ctx.fullName;
  if (!searchName) return { found: false, reason: "no company/person name to search" };

  const city = ctx.mailingCity ?? ctx.propertyCity ?? "Québec";

  const queries = [`${searchName} ${city}`, `${searchName} Québec`];
  if (ctx.mailingAddress) queries.push(`${searchName} ${ctx.mailingAddress}`);

  const seen = new Set<string>();
  const candidates: PhoneCandidate[] = [];

  for (const query of queries) {
    let places: PlacesResult[];
    try { places = await searchPlaces(query, apiKey); }
    catch { continue; }

    for (const place of places) {
      const rawPhone =
        place.internationalPhoneNumber ??
        place.nationalPhoneNumber ?? "";
      if (!rawPhone) continue;

      const e164List = extractPhonesFromValue(rawPhone);
      for (const e164 of e164List) {
        if (seen.has(e164)) continue;
        seen.add(e164);

        const nameMatch = place.displayName?.text
          ?.toLowerCase()
          .includes(searchName.toLowerCase().split(" ")[0]) ?? false;
        const confidence = nameMatch ? 75 : 60;

        candidates.push({
          phoneRaw:          rawPhone,
          phoneE164:         e164,
          stage:             "company_search",
          matchedOn:         "company_name",
          sourceLabel:       "google_places",
          sourceUrl:         place.id ? `https://maps.google.com/?cid=${place.id}` : null,
          snippet:           `${place.displayName?.text ?? ""} — ${place.formattedAddress ?? ""}`.slice(0, 400),
          searchQuery:       query,
          candidateName:     place.displayName?.text ?? null,
          candidateAddress:  place.formattedAddress ?? null,
          relatedEntityName: null,
          relatedEntityType: null,
          initialConfidence: confidence,
        });
      }
    }

    if (candidates.length >= 2) break;
  }

  if (candidates.length === 0) return { found: false };
  return { found: true, candidates };
}
