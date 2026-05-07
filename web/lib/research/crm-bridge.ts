/**
 * crm-bridge.ts — CRM publish bridge for owner_record.
 *
 * Publishes a completed owner_record to the CRM by:
 *   1. Looking up the latest owner_record for the given ownerId.
 *   2. Resolving CRM leads via properties.matricule → leads.property_id.
 *   3. Updating lead status and briefing_text on each resolved lead.
 *   4. Upserting phone rows for the primary (and alternate) phones.
 *   5. Marking the owner_record as published_to_crm=true.
 *
 * Idempotent: if published_to_crm is already true the function returns early
 * with alreadyPublished=true and zero mutation counts.
 *
 * Status mapping (from primary_phone_label):
 *   confirmed / likely  → ready_to_call
 *   connected           → needs_phone_review
 *   weak / null         → unresolved_after_all_sources
 *
 * Note: "unresolved_after_research" does not exist in the lead_status enum.
 * The closest value is "unresolved_after_all_sources" which is used instead.
 *
 * Phones table notes:
 *   - phones.source is a phone_source enum; "enrichment_other" is used for
 *     research-pipeline phones since no "research" value exists.
 *   - phones.confidence is a smallint (0-100); tier A=95, B=80, C=60, D=40, E=20.
 *   - phones.status defaults to "unverified" — we leave the default.
 *   - Upsert key: (contact_id, e164) — we rely on a unique constraint on those
 *     columns existing (standard pattern in this codebase). If no unique
 *     constraint exists, we fall back to insert-or-ignore by catching the error
 *     and logging a warning.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PublishInput = {
  ownerId: string;
};

export type PublishResult = {
  ownerId: string;
  recordId: string;
  snapshotHash: string;
  leadsUpdated: number;
  phonesUpserted: number;
  alreadyPublished: boolean;
  matriculesPublished: string[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Maps primary_phone_label to a lead_status enum value. */
export function labelToLeadStatus(label: string | null | undefined): string {
  switch (label) {
    case "confirmed":
    case "likely":
      return "ready_to_call";
    case "connected":
      return "needs_phone_review";
    default:
      // "weak", null, undefined → closest existing status
      return "unresolved_after_all_sources";
  }
}

/** Maps tier letter to a confidence score (smallint 0-100). */
export function tierToConfidence(tier: string | null | undefined): number {
  switch (tier) {
    case "A":
      return 95;
    case "B":
      return 80;
    case "C":
      return 60;
    case "D":
      return 40;
    case "E":
      return 20;
    default:
      return 50;
  }
}

// ---------------------------------------------------------------------------
// Alternate phone shape (stored as JSONB array in owner_record)
// ---------------------------------------------------------------------------

interface AlternatePhone {
  phoneE164?: string;
  tier?: string;
  label?: string;
  isDirect?: boolean;
}

// ---------------------------------------------------------------------------
// publishOwnerRecordToCrm
// ---------------------------------------------------------------------------

/**
 * Publish the latest owner_record for `ownerId` into the CRM.
 *
 * Throws if no owner_record is found for the given ownerId.
 */
export async function publishOwnerRecordToCrm(
  sb: AnyClient,
  input: PublishInput,
): Promise<PublishResult> {
  const warnings: string[] = [];

  // -------------------------------------------------------------------------
  // Step 1: fetch the latest owner_record
  // -------------------------------------------------------------------------
  const { data: ownerRecord, error: ownerRecordError } = await sb
    .from("owner_record")
    .select("*")
    .eq("owner_id", input.ownerId)
    .order("research_completed_at", { ascending: false })
    .limit(1)
    .single();

  if (ownerRecordError || !ownerRecord) {
    throw new Error(
      `publishOwnerRecordToCrm: no owner_record found for owner ${input.ownerId}: ${JSON.stringify(ownerRecordError)}`,
    );
  }

  // -------------------------------------------------------------------------
  // Step 2: idempotency check
  // -------------------------------------------------------------------------
  if (ownerRecord.published_to_crm === true) {
    return {
      ownerId: input.ownerId,
      recordId: ownerRecord.record_id,
      snapshotHash: ownerRecord.snapshot_hash,
      leadsUpdated: 0,
      phonesUpserted: 0,
      alreadyPublished: true,
      matriculesPublished: [],
      warnings: [],
    };
  }

  // -------------------------------------------------------------------------
  // Step 3: resolve leads from property matricules
  // -------------------------------------------------------------------------
  const matricules: string[] = ownerRecord.property_matricules ?? [];
  let leadsUpdated = 0;
  let phonesUpserted = 0;
  const matriculesPublished: string[] = [];

  const newStatus = labelToLeadStatus(ownerRecord.primary_phone_label);
  const briefingText: string | null = ownerRecord.briefing_text ?? null;
  const primaryE164: string | null = ownerRecord.primary_phone_e164 ?? null;
  const primaryTier: string | null = ownerRecord.primary_phone_tier ?? null;

  for (const matricule of matricules) {
    // -----------------------------------------------------------------------
    // 3a: find the property by matricule
    // -----------------------------------------------------------------------
    const { data: property, error: propError } = await sb
      .from("properties")
      .select("id")
      .eq("matricule", matricule)
      .limit(1)
      .single();

    if (propError || !property) {
      warnings.push(`matricule ${matricule}: property not found`);
      continue;
    }

    // -----------------------------------------------------------------------
    // 3b: find the lead by property_id
    // -----------------------------------------------------------------------
    const { data: lead, error: leadFetchError } = await sb
      .from("leads")
      .select("id, contact_id")
      .eq("property_id", property.id)
      .limit(1)
      .single();

    if (leadFetchError || !lead) {
      warnings.push(`matricule ${matricule}: lead not found for property ${property.id}`);
      continue;
    }

    // -----------------------------------------------------------------------
    // 3c: update lead status + briefing_text
    // -----------------------------------------------------------------------
    const leadUpdate: Record<string, unknown> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };
    if (briefingText !== null) {
      leadUpdate.briefing_text = briefingText;
      leadUpdate.briefing_generated_at = new Date().toISOString();
    }

    const { error: leadUpdateError } = await sb
      .from("leads")
      .update(leadUpdate)
      .eq("id", lead.id);

    if (leadUpdateError) {
      warnings.push(`matricule ${matricule}: failed to update lead ${lead.id}: ${JSON.stringify(leadUpdateError)}`);
      continue;
    }

    leadsUpdated += 1;
    matriculesPublished.push(matricule);

    // -----------------------------------------------------------------------
    // 3d: upsert primary phone (if present)
    // -----------------------------------------------------------------------
    if (primaryE164 && lead.contact_id) {
      const phoneRow = {
        contact_id: lead.contact_id,
        e164: primaryE164,
        source: "enrichment_other" as const,
        confidence: tierToConfidence(primaryTier),
        notes: ownerRecord.primary_phone_label ?? null,
        updated_at: new Date().toISOString(),
      };

      const { error: phoneError } = await sb
        .from("phones")
        .upsert(phoneRow, { onConflict: "contact_id,e164", ignoreDuplicates: false })
        .select()
        .single();

      if (phoneError) {
        warnings.push(`matricule ${matricule}: failed to upsert primary phone for contact ${lead.contact_id}: ${JSON.stringify(phoneError)}`);
      } else {
        phonesUpserted += 1;
      }
    }

    // -----------------------------------------------------------------------
    // 3e: upsert alternate phones (if present)
    // -----------------------------------------------------------------------
    const alternates: AlternatePhone[] = Array.isArray(ownerRecord.alternate_phones)
      ? (ownerRecord.alternate_phones as AlternatePhone[])
      : [];

    for (const alt of alternates) {
      if (!alt.phoneE164 || !lead.contact_id) continue;

      const altRow = {
        contact_id: lead.contact_id,
        e164: alt.phoneE164,
        source: "enrichment_other" as const,
        confidence: tierToConfidence(alt.tier),
        notes: alt.label ?? null,
        updated_at: new Date().toISOString(),
      };

      const { error: altError } = await sb
        .from("phones")
        .upsert(altRow, { onConflict: "contact_id,e164", ignoreDuplicates: false })
        .select()
        .single();

      if (altError) {
        warnings.push(`matricule ${matricule}: failed to upsert alternate phone ${alt.phoneE164}: ${JSON.stringify(altError)}`);
      } else {
        phonesUpserted += 1;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: mark owner_record as published
  // -------------------------------------------------------------------------
  const { error: markError } = await sb
    .from("owner_record")
    .update({ published_to_crm: true, published_at: new Date().toISOString() })
    .eq("record_id", ownerRecord.record_id);

  if (markError) {
    warnings.push(`failed to mark owner_record ${ownerRecord.record_id} as published: ${JSON.stringify(markError)}`);
  }

  return {
    ownerId: input.ownerId,
    recordId: ownerRecord.record_id,
    snapshotHash: ownerRecord.snapshot_hash,
    leadsUpdated,
    phonesUpserted,
    alreadyPublished: false,
    matriculesPublished,
    warnings,
  };
}
