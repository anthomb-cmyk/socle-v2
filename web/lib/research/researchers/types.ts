/**
 * Shared types for Pipeline A researchers.
 *
 * EvidenceCandidate is the value each researcher returns for each phone found.
 * The pipeline orchestrator aggregates these into hypotheses.
 */

export type ResearcherSource =
  | "req_phone"
  | "company_website"
  | "pages_jaunes_business"
  | "twilio_caller_name"
  | "reverse_address"
  | "name_postal_directory"
  | "cross_property";

export interface EvidenceCandidate {
  /** UUID of the inserted evidence row (may be undefined if insert was skipped). */
  evidenceId: string | undefined;
  /** Which researcher produced this candidate. */
  source: ResearcherSource;
  /** Normalised E.164 phone number. */
  phone: string;
  /**
   * True when the phone came from an authoritative source (government registry,
   * direct REQ data, or caller-ID name match).
   */
  isAuthoritative: boolean;
  /** URL of the page where the phone was found (null for REQ / Twilio sources). */
  sourceUrl?: string | null;
}
