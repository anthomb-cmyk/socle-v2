// Commit a parsed import: write properties, contacts, property_contacts, phones, leads.
// Idempotent: re-running with the same data updates instead of duplicating.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCity } from "./cities";
import { formatDisplay } from "./role-parser/phone-utils";
import type { ParseResult, ParsedRow, ParsedOwner } from "./role-parser/types";

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
    try {
      await commitRow(supabase, row, opts, counts);
    } catch (err) {
      counts.errors.push({ row: row.row_number, message: (err as Error).message });
    }

    // Every N rows, flush current counters so the client polling can see progress.
    if ((i + 1) % INCREMENTAL_FLUSH_EVERY === 0) {
      await supabase.from("import_jobs").update({
        properties_created: counts.properties_created,
        contacts_created:   counts.contacts_created,
        leads_created:      counts.leads_created,
        phones_created:     counts.phones_created,
        errors_count:       counts.errors.length,
        updated_at:         new Date().toISOString(),
      }).eq("id", opts.importJobId);
    }
  }

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

  // 2. For each owner: find or create contact
  for (const owner of owners) {
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

    // 4. Phones — one row per E.164 per contact
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
    const leadPayload = {
      campaign_id: opts.campaignId,
      property_id: propertyId,
      contact_id: contactId,
      status: "new" as const,
      source: "role_import",
      source_import_job_id: opts.importJobId,
    };
    const { data: existingLead } = await supabase.from("leads")
      .select("id")
      .eq("campaign_id", opts.campaignId ?? "")
      .eq("property_id", propertyId)
      .eq("contact_id", contactId)
      .maybeSingle();

    if (existingLead) {
      await supabase.from("leads").update({ source_import_job_id: opts.importJobId }).eq("id", existingLead.id);
      counts.leads_updated++;
    } else {
      // For null campaign_id we have to insert directly (eq with null doesn't work above)
      const { error } = await supabase.from("leads").insert(leadPayload);
      if (!error) counts.leads_created++;
      else if (error.code === "23505") counts.leads_updated++;     // unique violation = already exists
      else counts.errors.push({ row: row.row_number, message: `lead: ${error.message}` });
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
