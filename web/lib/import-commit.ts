// Commit a parsed import: write properties, contacts, property_contacts, phones, leads.
// Idempotent: re-running with the same data updates instead of duplicating.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCity } from "./cities";
import { formatDisplay } from "./role-parser/phone-utils";
import type { ParseResult, ParsedRow, ParsedOwner } from "./role-parser/types";
import { refreshPortfolioFlags } from "./portfolio/detector";
import { enqueue } from "./queue/enqueue";

// Flush incremental counters to import_jobs every N rows so the client can poll progress.
const INCREMENTAL_FLUSH_EVERY = 5;

// Normalise a contact name for dedup matching.
// Rôle exports are ALL-CAPS; other sources may be title-cased.
// We title-case before both lookup AND storage so the same person matches
// regardless of the capitalisation in the source file.
function normaliseName(s: string): string {
  if (!s) return s;
  return s
    .trim()
    .toLowerCase()
    .replace(/(^|\s|-|')(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

export interface CommitCounts {
  properties_created: number;
  properties_updated: number;
  contacts_created: number;
  contacts_updated: number;
  phones_created: number;
  leads_created: number;
  leads_updated: number;
  duplicates_seen: number;
  errors: { row: number; message: string }[];
}

export async function commitImport(
  supabase: SupabaseClient,
  parse: ParseResult,
  opts: { importJobId: string; campaignId: string | null }
): Promise<CommitCounts> {
  const counts: CommitCounts = {
    properties_created: 0, properties_updated: 0,
    contacts_created: 0, contacts_updated: 0,
    phones_created: 0,
    leads_created: 0, leads_updated: 0,
    duplicates_seen: 0,
    errors: [...parse.errors],
  };

  for (let i = 0; i < parse.rows.length; i++) {
    const row = parse.rows[i];

    // v3: partial-row import — instead of hard-blocking the whole row when any
    // owner fails validation, we split owners into "good" and "blocked" sets
    // and import the good ones. Blocked owners still get a contact record (for
    // the family/co-ownership graph) but their lead is marked unsuitable.
    const hasAuditBlocking = row.audit && row.audit.blocking.length > 0;
    const hasOwnerBlocking = row.audit && row.audit.owners.some(o =>
      o.mailing_parse_quality === "missing_civic" ||
      o.mailing_parse_quality === "unparseable",
    );

    const isFullBlock = hasAuditBlocking && !hasOwnerBlocking;

    if (isFullBlock) {
      // Entire row is invalid (e.g. property data missing) — block as before.
      counts.errors.push({ row: row.row_number, message: `BLOCKED: ${row.audit!.blocking.join("; ")}` });
      await supabase.from("import_row_audits").insert({
        import_job_id: opts.importJobId,
        row_number:    row.row_number,
        outcome:       "blocked",
        blocking:      row.audit!.blocking,
        warnings:      row.audit!.warnings,
        owners:        row.audit!.owners,
      });
      continue;
    }

    try {
      await commitRow(supabase, row, opts, counts);
      if (row.audit) {
        const hasWarnings = row.audit.warnings.length > 0;
        const hasPartialBlock = row.audit.owners.some(o =>
          o.mailing_parse_quality === "missing_civic" ||
          o.mailing_parse_quality === "unparseable",
        );
        await supabase.from("import_row_audits").insert({
          import_job_id: opts.importJobId,
          row_number:    row.row_number,
          outcome:       hasPartialBlock ? "imported_with_warnings" : hasWarnings ? "imported_with_warnings" : "imported_clean",
          blocking:      row.audit.blocking,
          warnings:      row.audit.warnings,
          owners:        row.audit.owners,
        });
      }
    } catch (err) {
      counts.errors.push({ row: row.row_number, message: (err as Error).message });
      if (row.audit) {
        await supabase.from("import_row_audits").insert({
          import_job_id: opts.importJobId,
          row_number:    row.row_number,
          outcome:       "error",
          blocking:      [`commit error: ${(err as Error).message}`],
          warnings:      row.audit.warnings,
          owners:        row.audit.owners,
        });
      }
    }

    // Every N rows, flush current counters so the client polling can see progress.
    if ((i + 1) % INCREMENTAL_FLUSH_EVERY === 0) {
      await supabase.from("import_jobs").update({
        properties_created: counts.properties_created,
        properties_updated: counts.properties_updated,
        contacts_created:   counts.contacts_created,
        contacts_updated:   counts.contacts_updated,
        leads_created:      counts.leads_created,
        leads_updated:      counts.leads_updated,
        phones_created:     counts.phones_created,
        duplicates_seen:    counts.duplicates_seen,
        errors_count:       counts.errors.length,
        updated_at:         new Date().toISOString(),
      }).eq("id", opts.importJobId);
    }
  }

  // Fire-and-forget: refresh portfolio flags so is_portfolio_owner stays current
  // after each import. Never block — errors are logged but don't affect counts.
  void (async () => {
    try {
      await refreshPortfolioFlags(supabase);
    } catch (err) {
      console.error("[import-commit] refreshPortfolioFlags failed:", err);
    }
  })();

  return counts;
}

async function commitRow(
  supabase: SupabaseClient,
  row: ParsedRow,
  opts: { importJobId: string; campaignId: string | null },
  counts: CommitCounts,
) {
  const { property, owners } = row;
  const city = normalizeCity(property.city);

  // 1. Find or create property (match by matricule first, fallback to address+city)
  let propertyId: string | null = null;
  if (property.matricule) {
    const { data } = await supabase.from("properties").select("id").eq("matricule", property.matricule).maybeSingle();
    if (data) propertyId = data.id;
  }
  if (!propertyId) {
    const q = supabase.from("properties").select("id").eq("address", property.address);
    if (city) q.eq("city", city);
    const { data } = await q.maybeSingle();
    if (data) propertyId = data.id;
  }

  const propPayload = {
    address: property.address,
    city,
    postal_code: property.postal_code ?? null,
    matricule: property.matricule || null,
    year_built: property.year_built ?? null,
    num_units: property.num_units ?? null,
    evaluation_total: property.evaluation_total ?? null,
    evaluation_land: property.evaluation_land ?? null,
    evaluation_bldg: property.evaluation_bldg ?? null,
    evaluation_year: property.evaluation_year ?? null,
    raw_role_row: property.raw_role_row,
    source_import_job_id: opts.importJobId,
    source_row_number: row.row_number,
  };

  if (propertyId) {
    const { error } = await supabase.from("properties").update(propPayload).eq("id", propertyId);
    if (error) throw new Error(`property update: ${error.message}`);
    counts.properties_updated++;
    counts.duplicates_seen++;
  } else {
    const { data, error } = await supabase.from("properties").insert(propPayload).select("id").single();
    if (error) throw new Error(`property insert: ${error.message}`);
    propertyId = data!.id;
    counts.properties_created++;
  }

  // 2. For each owner: find or create contact.
  //    Owners with an unparseable/missing-civic address are still created as
  //    contacts (preserves co-ownership graph) but their lead is marked
  //    unsuitable_for_phone_enrichment instead of "new".
  for (const owner of owners) {
    // Determine if this specific owner's address is blocked.
    const ownerQuality = owner.mailing_parse_quality;
    const isOwnerAddressBlocked =
      ownerQuality === "missing_civic" || ownerQuality === "unparseable";

    const contactId = await upsertContact(supabase, owner, opts.importJobId, counts);
    if (!contactId) continue;

    // 3. property_contacts (M2M with relationship)
    await supabase.from("property_contacts").upsert({
      property_id: propertyId,
      contact_id: contactId,
      relationship: "owner",
      share_pct: owner.share_pct ?? null,
      raw_role_data: owner,
      source_import_job_id: opts.importJobId,
    }, { onConflict: "property_id,contact_id,relationship", ignoreDuplicates: true });

    // 4. Phones — one row per E.164 per contact (skipped for blocked owners who have none)
    for (const e164 of owner.phones) {
      const { error } = await supabase.from("phones").upsert({
        contact_id: contactId,
        e164,
        display: formatDisplay(e164),
        status: "unverified",
        source: "role",
        confidence: 80,
        evidence: `from rôle import — ${owner.source_columns.phone || "phone column"}`,
        source_column: owner.source_columns.phone,
        source_import_job_id: opts.importJobId,
      }, { onConflict: "contact_id,e164", ignoreDuplicates: true });
      if (!error) counts.phones_created++;
    }

    // 5. Lead per (campaign, property, contact)
    const leadStatus: string = isOwnerAddressBlocked
      ? "unsuitable_for_phone_enrichment"
      : "new";

    const leadPayload = {
      campaign_id: opts.campaignId,
      property_id: propertyId,
      contact_id: contactId,
      status: leadStatus,
      source: "role_import",
      source_import_job_id: opts.importJobId,
    };

    const { data: existingLead } = await supabase.from("leads")
      .select("id, status")
      .eq("campaign_id", opts.campaignId ?? "")
      .eq("property_id", propertyId)
      .eq("contact_id", contactId)
      .maybeSingle();

    let leadId: string | null = null;

    if (existingLead) {
      await supabase.from("leads").update({ source_import_job_id: opts.importJobId }).eq("id", existingLead.id);
      counts.leads_updated++;
      leadId = existingLead.id;
    } else {
      const { data: newLead, error } = await supabase.from("leads").insert(leadPayload).select("id").single();
      if (!error && newLead) {
        counts.leads_created++;
        leadId = (newLead as { id: string }).id;
      } else if (error?.code === "23505") {
        counts.leads_updated++;
      } else if (error) {
        counts.errors.push({ row: row.row_number, message: `lead: ${error.message}` });
      }
    }

    // 6. If the owner's address is blocked, log an enrichment event so the banner
    //    on /leads/[id] can surface the failure reason.
    if (isOwnerAddressBlocked && leadId) {
      await supabase.from("enrichment_events").insert({
        lead_id:    leadId,
        event_type: "lead_status_updated",
        stage:      null,
        payload: {
          to:       "unsuitable_for_phone_enrichment",
          failures: [`mailing_parse_quality=${ownerQuality}`],
          reason:   `Adresse postale incomplète lors de l'import (${ownerQuality})`,
        },
      });
    }

    // 7. Enqueue post-processing tasks for the lead.
    if (leadId) {
      if (owner.phones.length === 0 && !isOwnerAddressBlocked) {
        // No phone yet — prioritize phone search ahead of slower post-import chores.
        await enqueue(supabase, leadId, "enrichment", 1);
      } else if (owner.phones.length > 0) {
        // Phone already attached via role import — skip enrichment, run lower-priority chores.
        await enqueue(supabase, leadId, "briefing", 7);
        await enqueue(supabase, leadId, "fit_score", 7);
      }
      // Blocked owners: no enrichment tasks (address incomplete)
    }
  }
}

async function upsertContact(
  supabase: SupabaseClient,
  owner: ParsedOwner,
  importJobId: string,
  counts: CommitCounts,
): Promise<string | null> {
  // Try to find by company_name (for entities) or full_name (for persons).
  // Normalise to title-case before both lookup and storage so that
  // "TREMBLAY, JEAN" from one file matches "Tremblay, Jean" from another.
  const lookupField = owner.kind === "person" ? "full_name" : "company_name";
  const rawLookup = owner.kind === "person" ? owner.full_name : (owner.company_name || owner.full_name);
  if (!rawLookup) return null;
  const lookupVal = normaliseName(rawLookup);

  const { data: existing } = await supabase.from("contacts")
    .select("id")
    .eq(lookupField, lookupVal)
    .maybeSingle();

  const payload = {
    kind: owner.kind,
    first_name: owner.first_name ? normaliseName(owner.first_name) : null,
    last_name: owner.last_name ? normaliseName(owner.last_name) : null,
    full_name: normaliseName(owner.full_name),
    company_name: owner.company_name ? normaliseName(owner.company_name) : null,
    numbered_co_id: owner.numbered_co_id ?? null,
    mailing_address: owner.mailing_address ?? null,
    mailing_city: owner.mailing_city ? normalizeCity(owner.mailing_city) : null,
    mailing_postal: owner.mailing_postal ?? null,
    // v3 structured mailing fields (parsed by import-validator)
    mailing_civic:        owner.mailing_civic ?? null,
    mailing_street:       owner.mailing_street ?? null,
    mailing_unit:         owner.mailing_unit ?? null,
    mailing_province:     owner.mailing_province ?? null,
    mailing_postal_fsa:   owner.mailing_postal_fsa ?? null,
    mailing_parsed_at:    new Date().toISOString(),
    mailing_parse_quality: owner.mailing_parse_quality ?? null,
    // v3 name parser audit
    middle_names:         owner.middle_names ?? [],
    name_was_inverted:    !!owner.name_was_inverted,
    name_parse_quality:   owner.name_parse_quality ?? null,
    source: "role_import",
    source_meta: { import_job_id: importJobId },
  };

  if (existing) {
    await supabase.from("contacts").update(payload).eq("id", existing.id);
    counts.contacts_updated++;
    return existing.id;
  } else {
    const { data, error } = await supabase.from("contacts").insert(payload).select("id").single();
    if (error) {
      counts.errors.push({ row: 0, message: `contact: ${error.message}` });
      return null;
    }
    counts.contacts_created++;
    return data.id;
  }
}
