// Shared types for the address-first phone enrichment pipeline (v2).
//
// Stage order:
//   0. Existing phone gate     — skip if already has any phone
//   1. Address search          — mailing address first, then property address
//   2. Company/person search   — company name + director name queries
//   3. B2BHint expansion       — related companies, directors, same-address entities
//   4. OpenClaw fallback       — async deep search for unresolved/conflicting cases
//
// Stop-early rule:
//   HIGH confidence (≥ HIGH_CONFIDENCE_THRESHOLD) → auto-attach → ready_to_call → STOP
//   MEDIUM confidence (≥ MEDIUM_CONFIDENCE_THRESHOLD) → needs_phone_review → STOP advancing
//   LOW confidence  → continue to next stage

// ── Pipeline stages ──────────────────────────────────────────────────────────

export type PipelineStage =
  | "address_search"  // Stage 1: Brave queries on mailing/property address
  | "company_search"  // Stage 2: Brave queries on company name + director
  | "b2bhint"         // Stage 3: B2BHint API expansion (stub until key provided)
  | "openclaw";       // Stage 4: OpenClaw async deep search fallback

// DB enum value mapping — the pipeline_stage enum in Postgres
// must match these values after migration 0008 is applied.
export const DB_STAGE_MAP: Record<PipelineStage, string> = {
  address_search: "address_search",
  company_search: "company_search",
  b2bhint:        "b2bhint",
  openclaw:       "openclaw",
};

// ── Confidence thresholds ────────────────────────────────────────────────────

/** Auto-attach phone and mark ready_to_call. Stop pipeline. */
export const HIGH_CONFIDENCE_THRESHOLD = 80;

/** Route to phone review queue. Stop advancing to next stage. */
export const MEDIUM_CONFIDENCE_THRESHOLD = 50;

// ── What matched the phone to the lead ──────────────────────────────────────

export type MatchedOn =
  | "mailing_address"         // phone tied to exact mailing address
  | "mailing_postal"          // phone tied to same postal code
  | "address_company"         // company found AT the mailing/property address has a phone
  | "property_address"        // matched via property address (fallback when no mailing)
  | "company_name"            // company name search returned this phone
  | "director_name"           // director/officer name search returned this phone
  | "b2bhint_related_company" // related company found via B2BHint
  | "b2bhint_director"        // director link found via B2BHint
  | "b2bhint_same_address"    // same-address entity found via B2BHint
  | "openclaw";               // OpenClaw deep search found it

// ── Candidate and candidate lifecycle ───────────────────────────────────────

export type CandidateStatus =
  | "candidate_found"
  | "auto_attached"           // high-confidence, attached to lead without review
  | "validating_with_openclaw"
  | "likely_match"
  | "unlikely_match"
  | "uncertain"
  | "rejected_by_openclaw"
  | "needs_anthony_review"    // medium-confidence → phone review queue
  | "approved_by_anthony"
  | "rejected_by_anthony";

export type OpenclawVerdict = "likely_match" | "unlikely_match" | "uncertain";

// ── Event types ──────────────────────────────────────────────────────────────

export type EnrichmentEventType =
  | "enrichment_started"
  | "existing_phone_found"
  | "address_search_started"
  | "address_search_complete"
  | "company_search_started"
  | "company_search_complete"
  | "b2bhint_search_started"
  | "b2bhint_search_complete"
  | "openclaw_search_started"
  | "openclaw_search_complete"
  | "phone_candidate_found"
  | "phone_auto_attached"
  | "openclaw_validation_started"
  | "openclaw_validation_complete"
  | "phone_candidate_needs_review"
  | "phone_approved_by_anthony"
  | "phone_rejected_by_anthony"
  | "unresolved_after_all_sources"
  | "lead_status_updated";

// ── Lead context fed to each stage ───────────────────────────────────────────

export interface LeadContext {
  leadId: string;
  contactId: string;
  enrichmentJobId: string;

  // Identity
  fullName: string | null;        // primary contact / director full name
  companyName: string | null;     // legal company owner name
  secondaryName: string | null;   // secondary contact if any

  // Property address
  propertyAddress: string | null;
  propertyCity: string | null;

  // Mailing / postal address (used first — higher signal)
  mailingAddress: string | null;
  mailingCity: string | null;
  mailingPostal: string | null;

  // Extras
  matricule: string | null;
  numUnits: number | null;
}

// ── What a stage returns ─────────────────────────────────────────────────────

export interface PhoneCandidate {
  // The phone itself
  phoneRaw: string;
  phoneE164: string | null;

  // Provenance
  stage: PipelineStage;
  matchedOn: MatchedOn;
  sourceLabel: string;   // e.g. "brave_search", "google_places"
  sourceUrl: string | null;
  snippet: string | null;
  searchQuery: string | null;  // exact query that found this

  // Evidence about the match
  candidateName: string | null;    // business/person name from source
  candidateAddress: string | null; // address from source

  // B2BHint expansion fields (null for non-B2BHint stages)
  relatedEntityName: string | null;
  relatedEntityType: string | null; // 'related_company' | 'director' | 'same_address'

  // Confidence
  initialConfidence: number; // 0–100
}

export type StageResult =
  | { found: true;  candidates: PhoneCandidate[] }
  | { found: false; reason?: string };

// ── OpenClaw validation result ───────────────────────────────────────────────

export interface OpenclawValidationResult {
  verdict: OpenclawVerdict;
  confidence: number;   // 0–100
  evidence: string;
  reasoning: string;
}

// ── Pipeline lead statuses ───────────────────────────────────────────────────

export type PipelineLeadStatus =
  // Pre-pipeline
  | "needs_enrichment"
  | "enrichment_pending"
  | "enrichment_running"
  // Stage progression
  | "searching_address"
  | "unresolved_after_address"
  | "searching_company"
  | "unresolved_after_company"
  | "searching_b2bhint"
  | "unresolved_after_b2bhint"
  | "openclaw_reviewing"
  // Outcomes
  | "ready_to_call"             // high-confidence auto-attach
  | "needs_phone_review"        // medium-confidence → human review queue
  | "unresolved_after_all_sources"
  | "enrichment_failed";
