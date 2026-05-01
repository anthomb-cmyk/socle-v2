// Stage 3 — Place API / Business Lookup
//
// Primarily useful for company-owned properties.
// Searches Google Places Text Search for the company name + city and
// extracts the business phone.
//
// Required env:
//   GOOGLE_PLACES_API_KEY  — Google Cloud Console → Places API (New)
//
// ⚠️  CREDENTIAL NEEDED: Enable "Places API (New)" in Google Cloud Console
//     and add the key as GOOGLE_PLACES_API_KEY in Railway env vars.
//     Billing required (first $200/month free).
//
// If no key is set, the stage is skipped cleanly.

import type { LeadContext, StageResult, PhoneCandidate } from "./types";
import { extractPhonesFromValue } from "@/lib/role-parser/phone-utils";

const PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";

interface PlacesResult {
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  id?: string;
}

interface PlacesResponse {
  places?: PlacesResult[];
}

async function searchPlaces(query: string, apiKey: string): Promise<PlacesResult[]> {
  const res = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.id",
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: "fr",
      regionCode: "CA",
      maxResultCount: 3,
    }),
  });
  if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as PlacesResponse;
  return data.places ?? [];
}

export async function runPlaceApiSearch(ctx: LeadContext): Promise<StageResult> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return {
      found: false,
      reason: "GOOGLE_PLACES_API_KEY not configured — stage skipped",
    };
  }

  // Only meaningful when there's a company name
  const searchName = ctx.companyName ?? ctx.fullName;
  if (!searchName) return { found: false, reason: "no company/person name to search" };

  const city = ctx.propertyCity ?? ctx.mailingCity ?? "Québec";

  const queries = [
    `${searchName} ${city}`,
    `${searchName} Québec`,
  ];
  if (ctx.mailingAddress) queries.push(`${searchName} ${ctx.mailingAddress}`);

  const seenPhones = new Set<string>();
  const candidates: PhoneCandidate[] = [];

  for (const query of queries) {
    let places: PlacesResult[];
    try {
      places = await searchPlaces(query, apiKey);
    } catch {
      continue;
    }

    for (const place of places) {
      const rawPhone =
        place.internationalPhoneNumber ??
        place.nationalPhoneNumber ??
        "";
      if (!rawPhone) continue;

      const e164List = extractPhonesFromValue(rawPhone);
      for (const e164 of e164List) {
        if (seenPhones.has(e164)) continue;
        seenPhones.add(e164);

        // Confidence: 75 if address is in Quebec and name similarity is plausible
        const nameMatch = place.displayName?.text
          ?.toLowerCase()
          .includes(searchName.toLowerCase().split(" ")[0]) ?? false;
        const confidence = nameMatch ? 75 : 60;

        candidates.push({
          phoneRaw: rawPhone,
          phoneE164: e164,
          stage: "place_api",
          sourceLabel: "google_places",
          sourceUrl: place.id
            ? `https://maps.google.com/?cid=${place.id}`
            : null,
          snippet: `${place.displayName?.text ?? ""} — ${place.formattedAddress ?? ""}`.slice(0, 400),
          initialConfidence: confidence,
        });
      }
    }

    if (candidates.length >= 2) break;
  }

  if (candidates.length === 0) return { found: false };
  return { found: true, candidates };
}
