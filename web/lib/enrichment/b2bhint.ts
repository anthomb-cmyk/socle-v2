// Stage 3 — B2BHint Expansion
//
// B2BHint is a FALLBACK EXPANSION tool — not a first-line search.
// It is only called when address search AND company/person search both found nothing.
//
// B2BHint finds related corporate entities from Québec company registries (REQ, etc.):
//   • Related companies at the same registered/mailing address
//   • Companies with the same director or officer
//   • Alternate legal names or trade names
//   • Companies linked by director across different addresses
//
// For each related entity found, follow-up Brave searches are run:
//   "<related company> téléphone"
//   "<related company> <city> téléphone"
//   "<related company> <address> téléphone"
//   "<director> <related company> téléphone"
//
// Stop as soon as a high-confidence phone is found.
//
// ── CREDENTIAL REQUIRED ──────────────────────────────────────────────────────
// Set B2BHINT_API_KEY in Railway env vars.
// API docs: https://b2bhint.com/api  (or equivalent configured endpoint)
//
// Until the key is set this stage is skipped cleanly.
//
// ── Expected API contract ─────────────────────────────────────────────────────
// POST ${B2BHINT_API_URL}/company/related
//   body: { company_name: string, address?: string, city?: string, postal?: string }
//   response: { entities: RelatedEntity[] }
//
// POST ${B2BHINT_API_URL}/director/related
//   body: { director_name: string, city?: string }
//   response: { entities: RelatedEntity[] }
//
// interface RelatedEntity {
//   name: string;            // company or person name
//   type: "company" | "director" | "same_address";
//   address?: string;        // registered address
//   city?: string;
//   postal?: string;
//   phone?: string;          // sometimes returned directly
//   relation_note?: string;  // e.g. "même adresse postale", "directeur commun"
// }
// ─────────────────────────────────────────────────────────────────────────────

import type { LeadContext, StageResult, PhoneCandidate } from "./types";
import { runAddressSearch, runCompanySearch } from "./brave-search";

// Pseudo-type for what B2BHint returns (replace with real API types when integrated)
interface RelatedEntity {
  name:          string;
  type:          "company" | "director" | "same_address";
  address?:      string;
  city?:         string;
  postal?:       string;
  phone?:        string;
  relation_note?: string;
}

interface B2BHintResponse {
  entities: RelatedEntity[];
}

async function b2bhintQuery(
  endpoint: string,
  apiKey: string,
  body: Record<string, string | undefined>,
): Promise<RelatedEntity[]> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`B2BHint API ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as B2BHintResponse;
  return data.entities ?? [];
}

export async function runB2BHintSearch(ctx: LeadContext): Promise<StageResult> {
  const apiKey = process.env.B2BHINT_API_KEY;
  const apiUrl = process.env.B2BHINT_API_URL ?? "https://api.b2bhint.com/v1";

  if (!apiKey) {
    return {
      found: false,
      reason: "B2BHINT_API_KEY not configured — B2BHint stage skipped",
    };
  }

  const city   = ctx.mailingCity ?? ctx.propertyCity ?? undefined;
  const postal = ctx.mailingPostal ?? undefined;
  const addr   = ctx.mailingAddress ?? ctx.propertyAddress ?? undefined;

  // Gather related entities from B2BHint
  const relatedEntities: RelatedEntity[] = [];

  // Search by company name
  if (ctx.companyName) {
    try {
      const entities = await b2bhintQuery(`${apiUrl}/company/related`, apiKey, {
        company_name: ctx.companyName,
        address: addr,
        city,
        postal,
      });
      relatedEntities.push(...entities);
    } catch (err) {
      console.warn("[b2bhint] company/related failed:", (err as Error).message);
    }
  }

  // Search by director/contact name
  if (ctx.fullName && relatedEntities.length === 0) {
    try {
      const entities = await b2bhintQuery(`${apiUrl}/director/related`, apiKey, {
        director_name: ctx.fullName,
        city,
      });
      relatedEntities.push(...entities);
    } catch (err) {
      console.warn("[b2bhint] director/related failed:", (err as Error).message);
    }
  }

  if (relatedEntities.length === 0) {
    return { found: false, reason: "B2BHint returned no related entities" };
  }

  // For each related entity, run follow-up Brave searches
  const allCandidates: PhoneCandidate[] = [];

  for (const entity of relatedEntities.slice(0, 8)) { // cap at 8 entities
    // If B2BHint returned a phone directly for this entity, use it
    if (entity.phone) {
      // This is a direct result — treat as high-signal candidate
      // (actual confidence will be boosted by address match in Brave scoring)
      // Build a synthetic candidate
      allCandidates.push({
        phoneRaw:          entity.phone,
        phoneE164:         entity.phone, // normalize separately if needed
        stage:             "b2bhint",
        matchedOn:         entity.type === "same_address" ? "b2bhint_same_address"
                         : entity.type === "director"     ? "b2bhint_director"
                         :                                  "b2bhint_related_company",
        sourceLabel:       "b2bhint_direct",
        sourceUrl:         null,
        snippet:           entity.relation_note ?? null,
        searchQuery:       null,
        candidateName:     entity.name,
        candidateAddress:  entity.address ?? null,
        relatedEntityName: entity.name,
        relatedEntityType: entity.type,
        initialConfidence: 65, // B2BHint direct result — medium confidence, needs review
      });
    }

    // Run Brave follow-up searches for this entity
    const entityCtx: LeadContext = {
      ...ctx,
      companyName:    entity.type !== "director" ? entity.name : ctx.companyName,
      fullName:       entity.type === "director" ? entity.name : ctx.fullName,
      mailingAddress: entity.address ?? ctx.mailingAddress,
      mailingCity:    entity.city    ?? ctx.mailingCity,
      mailingPostal:  entity.postal  ?? ctx.mailingPostal,
    };

    // Try address search first on the related entity's address
    if (entity.address) {
      try {
        const addressResult = await runAddressSearch(entityCtx);
        if (addressResult.found) {
          // Annotate candidates with related entity info
          const annotated = addressResult.candidates.map(c => ({
            ...c,
            stage:             "b2bhint" as const,
            matchedOn:         entity.type === "same_address" ? "b2bhint_same_address" as const
                             : entity.type === "director"     ? "b2bhint_director" as const
                             :                                  "b2bhint_related_company" as const,
            relatedEntityName: entity.name,
            relatedEntityType: entity.type,
            // Slightly lower confidence since it's via a related entity
            initialConfidence: Math.max(c.initialConfidence - 10, 40),
          }));
          allCandidates.push(...annotated);
        }
      } catch { /* continue */ }
    }

    // Also try company name search for the related entity
    try {
      const companyResult = await runCompanySearch(entityCtx);
      if (companyResult.found) {
        const annotated = companyResult.candidates.map(c => ({
          ...c,
          stage:             "b2bhint" as const,
          matchedOn:         entity.type === "director" ? "b2bhint_director" as const
                           :                              "b2bhint_related_company" as const,
          relatedEntityName: entity.name,
          relatedEntityType: entity.type,
          initialConfidence: Math.max(c.initialConfidence - 10, 40),
        }));
        allCandidates.push(...annotated);
      }
    } catch { /* continue */ }

    // Stop early if we found a high-confidence phone
    const HIGH = 80;
    if (allCandidates.some(c => c.initialConfidence >= HIGH)) break;
  }

  if (allCandidates.length === 0) {
    return { found: false, reason: "B2BHint expansion found entities but no phone numbers" };
  }

  allCandidates.sort((a, b) => b.initialConfidence - a.initialConfidence);
  return { found: true, candidates: allCandidates };
}
