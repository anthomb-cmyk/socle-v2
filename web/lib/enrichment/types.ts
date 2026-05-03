// Shared types for the address-first phone enrichment pipeline (v2).
//
// Stage order:
//   0. Existing phone gate     — skip if already has any phone
//   1. Address search          — mailing address first, then property address
//   2. Company/person search   — company name + director name queries
//   3. OpenClaw fallback       — automated browser research (async, no API key required)
//
// Stop-early rule:
//   HIGH confidence (≥ HIGH_CONFIDENCE_THRESHOLD) → auto-attach → ready_to_call → STOP
//   MEDIUM confidence (≥ MEDIUM_CONFIDENCE_THRESHOLD) → needs_phone_review → STOP advancing
//   LOW confidence  → continue to next stage

// ── Pipeline stages ──────────────────────────────────────────────────────────

export type PipelineStage =
  | "address_search"  // Stage 1: Brave queries on mailing/property address
  | "company_search"  // Stage 2: Brave queries on company name + director
  | "openclaw";       // Stage 3: OpenClaw automated browser research (async)

// DB enum value mapping — the pipeline_stage enum in Postgres
// must match these values after migration 0008 is applied.
export const DB_STAGE_MAP: Record<PipelineStage, string> = {
  address_search: "address_search",
  company_search: "company_search",
  openclaw:       "openclaw",
};

// ── Confidence thresholds ────────────────────────────────────────────────────

/** Auto-attach phone and mark ready_to_call. Stop pipeline. */
export const HIGH_CONFIDENCE_THRESHOLD = 80;

/** Route to phone review queue. Stop advancing to next stage. */
export const MEDIUM_CONFIDENCE_THRESHOLD = 50;

// ── What matched the phone to the lead ──────────────────────────────────────

export type MatchedOn =
  // Stage 1 — address search
  | "mailing_address"         // phone tied to exact mailing address
  | "mailing_postal"          // phone tied to same postal code
  | "address_company"         // company found AT the mailing/property address has a phone
  | "property_address"        // matched via property address (fallback when no mailing)
  // Stage 2 — company/person search
  | "company_name"            // company name search returned this phone
  | "director_name"           // director/officer name search returned this phone
  // Stage 3 — OpenClaw automated research
  | "related_company"         // OpenClaw found a related company at same address
  | "same_address_company"    // OpenClaw found another business registered at the address
  | "public_directory"        // OpenClaw found it in a public directory (411, Canada411, etc.)
  | "company_website"         // OpenClaw found it on the company's own website
  | "public_b2bhint_page"     // OpenClaw read the public B2BHint page (no API — browser only)
  | "openclaw";               // OpenClaw deep search (generic fallback label)

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
  | "openclaw_dispatched"          // fired when webhook POST returns 200
  | "openclaw_callback_received"   // fired when /api/enrichment/openclaw-callback is called
  | "openclaw_search_started"      // legacy alias — kept for backward compat
  | "openclaw_search_complete"     // legacy alias — kept for backward compat
  | "phone_candidate_found"
  | "phone_auto_attached"
  | "openclaw_validation_started"
  | "openclaw_validation_complete"
  | "phone_candidate_needs_review"
  | "phone_approved_by_anthony"
  | "phone_rejected_by_anthony"
  | "unresolved_after_openclaw"
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

  // Related entity fields (populated when found via entity expansion)
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
  | "openclaw_researching"        // Stage 3: OpenClaw automated research in progress
  | "unresolved_after_openclaw"   // Stage 3: OpenClaw returned nothing
  // Outcomes
  | "ready_to_call"               // high-confidence auto-attach
  | "needs_phone_review"          // medium-confidence → human review queue
  | "enrichment_failed";
