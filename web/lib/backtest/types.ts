/**
 * types.ts — Backtest harness shared types.
 */

/** One lead entry from ground_truth_v0.json */
export type SnapshotLead = {
  lead_id: string;
  contact_id: string | null;
  status: string | null;
  lead_source: string | null;
  owner_full_name: string | null;
  company_name: string | null;
  mailing_address: string | null;
  mailing_city: string | null;
  mailing_province: string | null;
  mailing_postal: string | null;
  mailing_country: string | null;
  property_address: string | null;
  property_city: string | null;
  property_province: string | null;
  property_postal: string | null;
  num_units: number | null;
  property_type: string | null;
  evaluation_total: number | null;
  current_phone: string | null;
  phone_status: string | null;
  phone_source: string | null;
  phone_confidence: number | null;
  candidate_count: number;
  source_file_name: string | null;
};

/** Top-level structure of ground_truth_v0.json */
export type Snapshot = {
  generated_at: string;
  count: number;
  leads: SnapshotLead[];
};

/** What the pipeline returns for each lead */
export type PipelineResult = {
  outcome: "released" | "held" | "unresolved";
  phone_e164?: string | null;
  tier?: string | null;
  by_pipeline?: "A" | "B";
  reason?: string;
  [key: string]: unknown;
};

/**
 * A pipeline function receives a SnapshotLead and a shadow Supabase client.
 * It must return a PipelineResult.
 */
export type PipelineFn = (
  lead: SnapshotLead,
  sb: ShadowSupabaseClient
) => Promise<PipelineResult>;

/**
 * Shadow Supabase client type — wraps the real client but blocks
 * writes to forbidden tables. Allowed tables are the new pipeline tables;
 * the old enrichment/phone tables are read-only in shadow mode.
 */
export type ShadowSupabaseClient = {
  from: (table: string) => ShadowQueryBuilder;
};

export type ShadowQueryBuilder = {
  select: (...args: unknown[]) => ShadowQueryBuilder;
  insert: (data: unknown) => Promise<{ data: unknown; error: null | { message: string } }>;
  update: (data: unknown) => ShadowQueryBuilder;
  upsert: (data: unknown) => Promise<{ data: unknown; error: null | { message: string } }>;
  delete: () => ShadowQueryBuilder;
  eq: (col: string, val: unknown) => ShadowQueryBuilder;
  in: (col: string, vals: unknown[]) => ShadowQueryBuilder;
  limit: (n: number) => ShadowQueryBuilder;
  order: (col: string, opts?: unknown) => ShadowQueryBuilder;
  single: () => Promise<{ data: unknown; error: null | { message: string } }>;
  then: Promise<{ data: unknown; error: null | { message: string } }>["then"];
};

/** Aggregate counts per pipeline variant */
export type PipelineBreakdown = {
  evaluated: number;
  released: number;
  held: number;
  unresolved: number;
};

/** Full backtest report */
export type BacktestReport = {
  run_at: string;
  leads_evaluated: number;
  released_count: number;
  held_count: number;
  unresolved_count: number;

  /** Pipeline released a phone that matches snapshot's existing phone */
  released_correct: number;
  /** Pipeline released a phone but snapshot had a different phone (or snapshot had none and we can't verify) */
  released_wrong: number;
  /** Pipeline released a phone and snapshot had no phone (unverifiable, counted separately) */
  released_unverifiable: number;

  /** Pipeline held the lead and snapshot also had no valid phone */
  held_correctly: number;
  /** Pipeline held the lead but snapshot already had a valid phone */
  held_when_should_release: number;

  /** Pipeline accuracy: released_correct / (released_correct + released_wrong) when denominator > 0 */
  precision: number | null;

  by_pipeline: {
    A: PipelineBreakdown;
    B: PipelineBreakdown;
    unspecified: PipelineBreakdown;
  };

  /** Per-lead detail (optional, large) */
  details?: Array<{
    lead_id: string;
    outcome: string;
    phone_e164?: string | null;
    tier?: string | null;
    by_pipeline?: string;
    snapshot_phone: string | null;
    correct: boolean | null;
  }>;
};

/** Options for runBacktest */
export type BacktestOptions = {
  /** Include per-lead details in report (default: false) */
  includeDetails?: boolean;
  /** Concurrency limit for pipeline calls (default: 1 = sequential) */
  concurrency?: number;
};
