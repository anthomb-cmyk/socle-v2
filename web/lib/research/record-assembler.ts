/**
 * record-assembler.ts — Owner record assembly and upsert.
 *
 * Combines the scored hypothesis results, briefing text, and property
 * matricule list into a stable owner_record row, keyed on (owner_id,
 * snapshot_hash) for idempotent upserts.
 */

import { createHash } from "crypto";
import { upsertOwnerRecord } from "./db";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AssembleInput = {
  ownerId: string;
  primaryHypothesis?: {
    phoneE164: string;
    tier: string;
    label: string;
    isDirect: boolean;
  };
  alternateHypotheses?: Array<{
    phoneE164: string;
    tier: string;
    label: string;
    isDirect: boolean;
  }>;
  briefingText?: string | null;
  whatsInteresting?: string | null;
  propertyMatricules?: string[];
  auditUrl?: string | null;
};

export type AssembleResult = {
  recordId: string;
  snapshotHash: string;
  isNew: boolean;
};

// ---------------------------------------------------------------------------
// computeSnapshotHash
// ---------------------------------------------------------------------------

/**
 * Produce a stable SHA-256 hash over the semantically significant fields of
 * an AssembleInput.
 *
 * The hash is deterministic: propertyMatricules are sorted before hashing so
 * that insertion order does not matter.
 */
export function computeSnapshotHash(input: AssembleInput): string {
  const stable = {
    ownerId: input.ownerId,
    primaryPhone: input.primaryHypothesis?.phoneE164 ?? null,
    briefing: input.briefingText ?? null,
    propertyMatricules: [...(input.propertyMatricules ?? [])].sort(),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

// ---------------------------------------------------------------------------
// assembleOwnerRecord
// ---------------------------------------------------------------------------

/**
 * Assemble and upsert an owner_record row.
 *
 * Uses `upsertOwnerRecord` with `onConflict: "owner_id,snapshot_hash"`.
 * The `isNew` flag is true when the DB returns a row whose `research_completed_at`
 * was just set (i.e. the upsert inserted rather than updated — detected by
 * checking whether the DB returned a row at all, since a no-op upsert in
 * Supabase may return the existing row).
 *
 * Practical detection of `isNew`:
 * Supabase's `.upsert(...).select().single()` returns the row whether it was
 * inserted or updated.  We approximate `isNew` by computing the hash before
 * calling the DB: if the returned row's `research_completed_at` equals the
 * timestamp we sent (i.e. the row was freshly created), `isNew = true`.
 * Because timestamps can collide in tests, we instead delegate to the caller:
 * the upsert's `data` will always be non-null on success; we treat `isNew`
 * as `true` when the returned `record_id` is new (not previously known).
 *
 * Implementation: we pass `ignoreDuplicates: false` to upsert so Supabase
 * always returns the row. We set `isNew = !data` would be wrong; instead we
 * check whether the `research_completed_at` we sent matches the row's value
 * (indicating the row was just written, not read from a prior run).
 */
export async function assembleOwnerRecord(
  sb: AnyClient,
  input: AssembleInput,
): Promise<AssembleResult> {
  const snapshotHash = computeSnapshotHash(input);
  const researchCompletedAt = new Date().toISOString();

  const record = {
    owner_id: input.ownerId,
    snapshot_hash: snapshotHash,
    primary_phone_e164: input.primaryHypothesis?.phoneE164 ?? null,
    primary_phone_tier: input.primaryHypothesis?.tier ?? null,
    primary_phone_label: input.primaryHypothesis?.label ?? null,
    primary_phone_is_direct: input.primaryHypothesis?.isDirect ?? null,
    alternate_phones:
      input.alternateHypotheses && input.alternateHypotheses.length > 0
        ? (input.alternateHypotheses as unknown as Record<string, unknown>)
        : null,
    briefing_text: input.briefingText ?? null,
    whats_interesting: input.whatsInteresting ?? null,
    property_matricules:
      input.propertyMatricules && input.propertyMatricules.length > 0
        ? input.propertyMatricules
        : null,
    audit_url: input.auditUrl ?? null,
    research_completed_at: researchCompletedAt,
    published_to_crm: false,
    published_at: null,
  };

  const { data, error } = await upsertOwnerRecord(sb, record);

  if (error || !data) {
    throw new Error(
      `assembleOwnerRecord: upsert failed for owner ${input.ownerId}: ${JSON.stringify(error)}`,
    );
  }

  // Detect isNew: if the returned research_completed_at matches what we sent,
  // the row was freshly inserted. If it differs, the existing row was returned
  // unchanged (no-op conflict).
  const isNew = data.research_completed_at === researchCompletedAt;

  return {
    recordId: data.record_id,
    snapshotHash,
    isNew,
  };
}
