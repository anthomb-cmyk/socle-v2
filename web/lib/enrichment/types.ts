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
  | "weak_review"             // v3: gate-passing but low score; collapsible in UI
  | "quarantined"             // v3: failed at least one gate; not shown by default
  | "pipeline_rejected"       // v3: hard reject (NEQ, fax, invalid format) — audit only
  | "approved_by_anthony"
  | "rejected_by_anthony"
  | "approved_by_codex"
  | "rejected_by_codex";

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
  | "phone_approved_by_codex"
  | "phone_rejected_by_codex"
  | "unresolved_after_openclaw"
  | "lead_status_updated"
  // ── v3 gate-engine events ──────────────────────────────────────────────
  | "preflight_failed"             // mailing address invalid/incomplete
  | "preflight_passed"             // mailing address parsed cleanly
  | "query_built"                  // structured query emitted
  | "source_classified"            // Brave result was classified into a source class
  | "candidate_quarantined"        // candidate failed a gate
  | "candidate_pipeline_rejected"  // hard reject (NEQ/fax/etc.)
  | "phone_extraction_rejected"    // phone-shape rejection (NEQ, fax, area code)
  | "haiku_validation_started"
  | "haiku_validation_complete"
  | "candidates_reclassified"      // one-time backfill
  // ── Stage 0 short-circuit events ──────────────────────────────────────
  | "portfolio_short_circuit_hit"  // cross-contact portfolio match resolved the lead
  | "portfolio_match_ambiguous";   // 2+ qualifying contacts matched — fell through to Brave

// ── Lead context fed to each stage ───────────────────────────────────────────

export interface LeadContext {
  leadId: string;
  contactId: string;
  enrichmentJobId: string;

  // Identity
  fullName: string | null;        // primary contact / director full name
  companyName: string | null;     // legal company owner name
  secondaryName: string | null;   // secondary contact if any
  relatedOwnerNames?: string[];   // all owner names linked to the same property

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
  | "unsuitable_for_phone_enrichment"  // v3: pre-flight failed (incomplete mailing address)
  | "enrichment_failed";

// ── v3 — Source classification (Layer C) ────────────────────────────────────

/** Page-shape classifier output for a single Brave/web result. */
export type SourceClass =
  | "directory_authoritative"   // Per-entity detail page (Canada411 person page, REQ entreprise, B2BHint detail, OACIQ broker, etc.)
  | "directory_aggregate"       // Category/result/list/locator page ("All retailers in X", "Succursales par province")
  | "municipal_or_institutional" // City/government contact pages, public bodies
  | "bulk_document"             // PDFs, CSVs, Scribd, postal-code lists, member directories
  | "commerce_unrelated"        // eBay, Amazon, Kijiji product pages
  | "social"                    // LinkedIn/Facebook/Twitter (caution)
  | "company_website"           // The owner's own website (highest authority for B2B)
  | "web_other";                // Anything else

export interface SourceClassification {
  sourceClass: SourceClass;
  /** Per-result confidence in the classification, 0–1 */
  confidence: number;
  /** Why this class was chosen — appears in audit log */
  reason: string;
  /** Hostname (e.g. "fr.canada411.ca") */
  host: string;
  /** Was a domain hint applied (in addition to page-shape signals)? */
  domainHintApplied: boolean;
}

// ── v3 — Address parsing (Layer A) ──────────────────────────────────────────

export interface ParsedAddress {
  raw: string;
  /** "3720" — civic number; null if missing */
  civicNumber: string | null;
  /** "3720-3722" — civic range form; null if not a range */
  civicRange: string | null;
  /** "Avenue Kent" — normalized street name (no diacritic-folding here) */
  streetName: string | null;
  /** "Apt 408" / "Bureau 12" / "408" — extracted unit, if any */
  unit: string | null;
  /** "Montréal" */
  city: string | null;
  /** "QC" / "ON" / etc. */
  province: string | null;
  /** "H3S 1N3" — uppercase, single-spaced */
  postal: string | null;
  /** "H3S" */
  postalFsa: string | null;
}

export interface PreflightResult {
  ok: boolean;
  parsed: ParsedAddress | null;
  /** Coherence between mailing_city field and parsed address; null if N/A */
  cityMatch: "match" | "mismatch" | "missing" | null;
  /** Specific failure reasons (multiple possible) */
  failures: string[];
}

// ── v3 — Gate engine (Layer E) ──────────────────────────────────────────────

export type GateName = "G1_phone_shape" | "G2_source_class" | "G3_address_match" | "G4_owner_match" | "G5_negative_signals" | "G6_haiku_validation";

export interface GateOutcome {
  gate: GateName;
  pass: boolean;
  reason: string;
  /** Auxiliary signal used to decide (for audit/debug) */
  signal?: Record<string, unknown>;
}

export interface GateReport {
  outcomes: GateOutcome[];
  passed: boolean;
  /** First failing gate, or null if all passed */
  firstFailure: GateName | null;
  /** Final disposition: how the candidate should be stored */
  disposition: "auto_attached" | "needs_anthony_review" | "weak_review" | "quarantined" | "pipeline_rejected";
  /** Final score 0–100 (only meaningful when passed === true) */
  score: number;
  /** Multiplicative score factors, for audit */
  scoreFactors?: { source: number; address: number; name: number; phoneAuthority: number };
  /** Optional Haiku verdict (when G6 ran) */
  haiku?: { isOwnersPhone: boolean; confidence: number; reasoning: string; nameInSource: boolean; addressInSource: boolean };
}

// ── v3 — Phone extraction context (Layer D) ─────────────────────────────────

export interface PhoneExtractionResult {
  e164: string;
  display: string;
  /** ±40 char window around the matched digits (for audit) */
  window: string;
  /** Was this number labelled "fax/télécopieur" within the window? */
  isFax: boolean;
  /** Was the number contiguous with NEQ / business-id markers? */
  hasBusinessIdContext: boolean;
  /** True if this is a known Quebec/Canadian area code */
  isInRegion: boolean;
}

export interface PhoneExtractionRejection {
  reason: "neq_context" | "fax_context" | "out_of_region_non_authoritative" | "invalid_nanp" | "matricule" | "cadastre" | "numbered_company";
  rawDigits: string;
  window: string;
}
