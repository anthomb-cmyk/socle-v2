// Shared types for the multi-stage phone enrichment pipeline.

export type PipelineStage = "brave" | "directory_411" | "place_api" | "openclaw";

export type CandidateStatus =
  | "candidate_found"
  | "validating_with_openclaw"
  | "likely_match"
  | "unlikely_match"
  | "uncertain"
  | "rejected_by_openclaw"
  | "needs_anthony_review"
  | "approved_by_anthony"
  | "rejected_by_anthony";

export type OpenclawVerdict = "likely_match" | "unlikely_match" | "uncertain";

export type EnrichmentEventType =
  | "enrichment_started"
  | "brave_search_started"
  | "brave_search_complete"
  | "directory_search_started"
  | "directory_search_complete"
  | "place_api_search_started"
  | "place_api_search_complete"
  | "openclaw_search_started"
  | "openclaw_search_complete"
  | "phone_candidate_found"
  | "openclaw_validation_started"
  | "openclaw_validation_complete"
  | "phone_candidate_needs_review"
  | "phone_approved_by_anthony"
  | "phone_rejected_by_anthony"
  | "unresolved_after_all_sources"
  | "lead_status_updated";

// ── Input context fed to each stage ─────────────────────────────────────────

export interface LeadContext {
  leadId: string;
  contactId: string;
  enrichmentJobId: string;

  // Identity
  fullName: string | null;       // primary contact full name
  companyName: string | null;    // company owner name if any
  secondaryName: string | null;  // secondary contact if any

  // Addresses
  propertyAddress: string | null;
  propertyCity: string | null;
  mailingAddress: string | null;
  mailingCity: string | null;
  mailingPostal: string | null;

  // Extras
  matricule: string | null;
  numUnits: number | null;
}

// ── What a stage returns ─────────────────────────────────────────────────────

export interface PhoneCandidate {
  phoneRaw: string;
  phoneE164: string | null;
  stage: PipelineStage;
  sourceLabel: string;
  sourceUrl: string | null;
  snippet: string | null;
  initialConfidence: number;   // 0-100
}

export type StageResult =
  | { found: true;  candidates: PhoneCandidate[] }
  | { found: false; reason?: string };

// ── OpenClaw validation result ───────────────────────────────────────────────

export interface OpenclawValidationResult {
  verdict: OpenclawVerdict;
  confidence: number;   // 0-100
  evidence: string;
  reasoning: string;
}

// ── High-confidence threshold ────────────────────────────────────────────────
// Candidates at or above this confidence bypass OpenClaw validation and
// go directly to Anthony review.

export const HIGH_CONFIDENCE_THRESHOLD = 75;

// ── Lead status values used by the pipeline ──────────────────────────────────

export type PipelineLeadStatus =
  | "enrichment_pending"
  | "enrichment_running"
  | "unresolved_after_brave"
  | "unresolved_after_411"
  | "unresolved_after_places"
  | "needs_human_review"
  | "phone_verified"
  | "unresolved_after_all_sources";
