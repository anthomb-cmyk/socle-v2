// Stage 0 and Stage 0.5 short-circuit helpers for the enrichment pipeline.
//
// Both functions are PURE QUERIES — they only read from the DB.
// All side effects (logging, status updates, phone insert, enqueue) live
// in pipeline.ts to keep these functions easy to unit-test.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadContext } from "./types";
import { normalizeName } from "./normalize";

// ── Stage 0 — same-contact existing-phone gate ────────────────────────────────

export interface ExistingPhoneResult {
  hit: boolean;
  phoneE164?: string;
  source?: string;
  status?: string;
  confidence?: number;
}

/**
 * Check whether the current contact already has at least one phone row.
 *
 * Preference order for "best" phone:
 *   1. source = 'caller_verified' (Anthony called and confirmed)
 *   2. status = 'valid'
 *   3. highest confidence
 *   4. most recent updated_at
 *
 * Returns hit:false when no rows exist for this contact.
 */
export async function tryExistingPhoneShortCircuit(
  sb: SupabaseClient,
  ctx: LeadContext,
): Promise<ExistingPhoneResult> {
  const { data, error } = await sb
    .from("phones")
    .select("e164, source, status, confidence, updated_at")
    .eq("contact_id", ctx.contactId)
    .order("updated_at", { ascending: false });

  if (error || !data || data.length === 0) {
    return { hit: false };
  }

  // Pick best phone by priority: caller_verified > valid status > confidence > recency
  type PhoneRow = { e164: string; source: string; status: string; confidence: number; updated_at: string };
  const rows = data as PhoneRow[];

  const best = rows.reduce((winner, row) => {
    if (!winner) return row;
    // 1. caller_verified wins over everything
    if (row.source === "caller_verified" && winner.source !== "caller_verified") return row;
    if (winner.source === "caller_verified" && row.source !== "caller_verified") return winner;
    // 2. valid status wins
    if (row.status === "valid" && winner.status !== "valid") return row;
    if (winner.status === "valid" && row.status !== "valid") return winner;
    // 3. higher confidence wins
    if (row.confidence > winner.confidence) return row;
    if (winner.confidence > row.confidence) return winner;
    // 4. most recent wins (updated_at already sorted desc, so winner is more recent)
    return winner;
  }, null as PhoneRow | null)!;

  return {
    hit: true,
    phoneE164: best.e164,
    source: best.source,
    status: best.status,
    confidence: best.confidence,
  };
}

// ── Stage 0.5 — cross-contact portfolio match ────────────────────────────────

export interface PortfolioMatchResult {
  hit: boolean;
  ambiguous?: boolean;
  candidateContactIds?: string[];
  matchedContactId?: string;
  matchedPhoneId?: string;
  phoneE164?: string;
  fsa?: string;
  matchField?: "fullName" | "companyName";
}

/**
 * Look for other contacts that represent the SAME OWNER and already have a
 * trusted phone (caller_verified OR status=valid).
 *
 * Match criteria (both must be true):
 *   1. Name match: normalized full_name OR company_name equals ctx.fullName or ctx.companyName
 *   2. Geographic proximity: same mailing_postal_fsa (first 3 chars of postal code)
 *
 * Returns hit:false when:
 *   - ctx.mailingPostal is null (no FSA available — skip entirely)
 *   - no contacts match
 *   - matching contacts only have unverified/untrusted phones
 *
 * Returns ambiguous:true when 2+ distinct qualifying contacts match.
 */
export async function tryCrossContactPortfolioMatch(
  sb: SupabaseClient,
  ctx: LeadContext,
): Promise<PortfolioMatchResult> {
  // Skip entirely when we have no postal code to constrain the FSA match
  if (!ctx.mailingPostal) {
    return { hit: false };
  }

  const fsa = ctx.mailingPostal.trim().slice(0, 3).toUpperCase();
  if (fsa.length < 3) {
    return { hit: false };
  }

  const normalizedFullName = normalizeName(ctx.fullName);
  const normalizedCompanyName = normalizeName(ctx.companyName);

  // Need at least one name to match on
  if (!normalizedFullName && !normalizedCompanyName) {
    return { hit: false };
  }

  // Fetch other contacts in the same FSA (excluding current contact)
  // We pull all contacts whose mailing_postal starts with the FSA prefix.
  // The trust filtering happens after, in memory, to keep the query simple.
  const { data: contactRows, error: contactErr } = await sb
    .from("contacts")
    .select("id, full_name, company_name, mailing_postal")
    .neq("id", ctx.contactId)
    .like("mailing_postal", `${fsa}%`);

  if (contactErr || !contactRows || contactRows.length === 0) {
    return { hit: false };
  }

  type ContactRow = { id: string; full_name: string | null; company_name: string | null; mailing_postal: string | null };

  // Filter to contacts that name-match AND are in the same FSA
  const nameMatches: Array<{ contact: ContactRow; matchField: "fullName" | "companyName" }> = [];

  for (const contact of contactRows as ContactRow[]) {
    // Confirm FSA (the LIKE might give us adjacent FSAs in edge cases if the DB
    // stores differently — re-check explicitly)
    const contactFsa = contact.mailing_postal?.trim().slice(0, 3).toUpperCase();
    if (contactFsa !== fsa) continue;

    let matchField: "fullName" | "companyName" | null = null;

    if (normalizedFullName) {
      const otherNorm = normalizeName(contact.full_name);
      if (otherNorm && otherNorm === normalizedFullName) {
        matchField = "fullName";
      }
    }

    if (!matchField && normalizedCompanyName) {
      const otherNorm = normalizeName(contact.company_name);
      if (otherNorm && otherNorm === normalizedCompanyName) {
        matchField = "companyName";
      }
    }

    if (matchField) {
      nameMatches.push({ contact, matchField });
    }
  }

  if (nameMatches.length === 0) {
    return { hit: false };
  }

  // For each name-matched contact, check whether it has a trusted phone
  type PhoneRow = { id: string; contact_id: string; e164: string; source: string; status: string; confidence: number; updated_at: string };

  const matchedContactIds = nameMatches.map(m => m.contact.id);

  const { data: phoneRows, error: phoneErr } = await sb
    .from("phones")
    .select("id, contact_id, e164, source, status, confidence, updated_at")
    .in("contact_id", matchedContactIds);

  if (phoneErr || !phoneRows) {
    return { hit: false };
  }

  // Trust criteria: caller_verified OR status = valid
  const trustedPhones = (phoneRows as PhoneRow[]).filter(
    p => p.source === "caller_verified" || p.status === "valid",
  );

  if (trustedPhones.length === 0) {
    return { hit: false };
  }

  // Collect the distinct contact_ids that have at least one trusted phone
  const qualifyingContactIds = [...new Set(trustedPhones.map(p => p.contact_id))];

  if (qualifyingContactIds.length > 1) {
    // Ambiguous — two or more distinct contacts qualify; fall through to Brave
    return {
      hit: false,
      ambiguous: true,
      candidateContactIds: qualifyingContactIds,
    };
  }

  // Exactly one qualifying contact
  const matchedContactId = qualifyingContactIds[0];
  const matchEntry = nameMatches.find(m => m.contact.id === matchedContactId)!;

  // Pick the best trusted phone for this contact (same priority as Stage 0)
  const contactTrustedPhones = trustedPhones.filter(p => p.contact_id === matchedContactId);
  const bestPhone = contactTrustedPhones.reduce((winner, row) => {
    if (!winner) return row;
    if (row.source === "caller_verified" && winner.source !== "caller_verified") return row;
    if (winner.source === "caller_verified" && row.source !== "caller_verified") return winner;
    if (row.status === "valid" && winner.status !== "valid") return row;
    if (winner.status === "valid" && row.status !== "valid") return winner;
    if (row.confidence > winner.confidence) return row;
    if (winner.confidence > row.confidence) return winner;
    return winner;
  }, null as PhoneRow | null)!;

  return {
    hit: true,
    matchedContactId,
    matchedPhoneId: bestPhone.id,
    phoneE164: bestPhone.e164,
    fsa,
    matchField: matchEntry.matchField,
  };
}
