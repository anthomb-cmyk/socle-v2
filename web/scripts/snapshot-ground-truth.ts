/**
 * snapshot-ground-truth.ts
 *
 * Generates web/data/ground_truth_v0.json — a snapshot of all real leads
 * (test imports excluded) with contact, property, phone, and candidate data.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx web/scripts/snapshot-ground-truth.ts
 *
 * Filter: excludes leads whose source import file_name ILIKE
 *   'socle_phone_enrichment%' OR 'StHyacinthe_test50%'
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { createSupabaseAdminClient } from "../lib/supabase-server";

type LeadRow = {
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

async function main() {
  const admin = createSupabaseAdminClient();

  // Fetch leads with joined contact, property, phone info
  // We use rpc-free approach: fetch leads and join in application layer
  // to stay within Supabase JS SDK capabilities.

  const { data: leads, error: leadsError } = await admin
    .from("leads")
    .select(`
      id,
      contact_id,
      property_id,
      status,
      source,
      source_import_job_id
    `)
    .order("created_at");

  if (leadsError) throw new Error(`Failed to fetch leads: ${leadsError.message}`);
  if (!leads) throw new Error("No leads returned");

  // Fetch import jobs to filter test imports
  const { data: importJobs, error: ijError } = await admin
    .from("import_jobs")
    .select("id, file_name");

  if (ijError) throw new Error(`Failed to fetch import_jobs: ${ijError.message}`);

  const importJobMap = new Map<string, string>(
    (importJobs ?? []).map((ij: { id: string; file_name: string | null }) => [ij.id, ij.file_name ?? ""])
  );

  // Filter out test leads
  const realLeads = leads.filter((l: { source_import_job_id: string | null }) => {
    const fileName = l.source_import_job_id ? importJobMap.get(l.source_import_job_id) ?? "" : "";
    return (
      !fileName.toLowerCase().startsWith("socle_phone_enrichment") &&
      !fileName.toLowerCase().startsWith("sthyacinthe_test50")
    );
  });

  // Fetch contacts, properties, phones, phone_candidates
  const contactIds = [...new Set(realLeads.map((l: { contact_id: string | null }) => l.contact_id).filter(Boolean))] as string[];
  const propertyIds = [...new Set(realLeads.map((l: { property_id: string | null }) => l.property_id).filter(Boolean))] as string[];
  const leadIds = realLeads.map((l: { id: string }) => l.id);

  const [contactsRes, propertiesRes, phonesRes, candidatesRes] = await Promise.all([
    admin.from("contacts").select("id, full_name, company_name, mailing_address, mailing_city, mailing_province, mailing_postal, mailing_country").in("id", contactIds),
    admin.from("properties").select("id, address, city, province, postal_code, num_units, property_type, evaluation_total").in("id", propertyIds),
    admin.from("phones").select("contact_id, e164, status, source, confidence").in("contact_id", contactIds),
    admin.from("phone_candidates").select("lead_id").in("lead_id", leadIds),
  ]);

  if (contactsRes.error) throw new Error(`contacts: ${contactsRes.error.message}`);
  if (propertiesRes.error) throw new Error(`properties: ${propertiesRes.error.message}`);
  if (phonesRes.error) throw new Error(`phones: ${phonesRes.error.message}`);
  if (candidatesRes.error) throw new Error(`phone_candidates: ${candidatesRes.error.message}`);

  type ContactRecord = { id: string; full_name: string | null; company_name: string | null; mailing_address: string | null; mailing_city: string | null; mailing_province: string | null; mailing_postal: string | null; mailing_country: string | null };
  type PropertyRecord = { id: string; address: string | null; city: string | null; province: string | null; postal_code: string | null; num_units: number | null; property_type: string | null; evaluation_total: number | null };
  type PhoneRecord = { contact_id: string; e164: string; status: string; source: string; confidence: number | null };

  const contactMap = new Map<string, ContactRecord>(
    (contactsRes.data ?? []).map((c: ContactRecord) => [c.id, c])
  );
  const propertyMap = new Map<string, PropertyRecord>(
    (propertiesRes.data ?? []).map((p: PropertyRecord) => [p.id, p])
  );

  // For phones: pick first valid phone per contact
  const phoneMap = new Map<string, PhoneRecord>();
  for (const ph of (phonesRes.data ?? []) as PhoneRecord[]) {
    if ((ph.status as string) === "valid" && !phoneMap.has(ph.contact_id)) {
      phoneMap.set(ph.contact_id, ph);
    }
  }

  // candidate counts per lead
  const candidateCount = new Map<string, number>();
  for (const row of (candidatesRes.data ?? []) as { lead_id: string }[]) {
    candidateCount.set(row.lead_id, (candidateCount.get(row.lead_id) ?? 0) + 1);
  }

  const output: LeadRow[] = realLeads.map((l: { id: string; contact_id: string | null; property_id: string | null; status: string | null; source: string | null; source_import_job_id: string | null }) => {
    const contact = l.contact_id ? contactMap.get(l.contact_id) : undefined;
    const property = l.property_id ? propertyMap.get(l.property_id) : undefined;
    const phone = l.contact_id ? phoneMap.get(l.contact_id) : undefined;
    const fileName = l.source_import_job_id ? importJobMap.get(l.source_import_job_id) ?? null : null;

    return {
      lead_id: l.id,
      contact_id: l.contact_id ?? null,
      status: l.status ?? null,
      lead_source: l.source ?? null,
      owner_full_name: contact?.full_name ?? null,
      company_name: contact?.company_name ?? null,
      mailing_address: contact?.mailing_address ?? null,
      mailing_city: contact?.mailing_city ?? null,
      mailing_province: contact?.mailing_province ?? null,
      mailing_postal: contact?.mailing_postal ?? null,
      mailing_country: contact?.mailing_country ?? null,
      property_address: property?.address ?? null,
      property_city: property?.city ?? null,
      property_province: property?.province ?? null,
      property_postal: property?.postal_code ?? null,
      num_units: property?.num_units ?? null,
      property_type: property?.property_type ?? null,
      evaluation_total: property?.evaluation_total ?? null,
      current_phone: phone?.e164 ?? null,
      phone_status: phone ? (phone.status as string) : null,
      phone_source: phone ? (phone.source as string) : null,
      phone_confidence: phone?.confidence ?? null,
      candidate_count: candidateCount.get(l.id) ?? 0,
      source_file_name: fileName,
    };
  });

  const result = {
    generated_at: new Date().toISOString(),
    count: output.length,
    leads: output,
  };

  const outPath = join(__dirname, "../data/ground_truth_v0.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`Written ${output.length} leads to ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
