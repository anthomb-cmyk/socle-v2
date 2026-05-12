// POST /api/import/upload
// multipart/form-data: file (xlsx), [campaignName], [city]
// Returns: { jobId, format, totalRows, preview, errors }

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { parseRoleFile, type RoleFormat } from "@/lib/role-parser";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { llmSuggestFormat } from "@/lib/llm/format-detection";

const VALID_FORMATS = new Set<RoleFormat>(["role_a", "role_b", "role_c", "role_d"]);
const FORMAT_SUGGESTION_TIMEOUT_MS = 8_000;
const DEDUPE_BATCH_SIZE = 500;

export const runtime = "nodejs";
export const maxDuration = 60;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function addressCityKey(address: string, city: string | null | undefined): string {
  return `${address}\u0000${city ?? ""}`;
}

async function nullableTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let settled = false;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      });
  });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
  }
  const campaignName = (form.get("campaignName") as string | null)?.trim() || null;
  const city = (form.get("city") as string | null)?.trim() || null;
  // v3: optional explicit format override when the importer's auto-detection failed.
  const formatOverrideRaw = (form.get("formatOverride") as string | null)?.trim() || null;
  const formatOverride = formatOverrideRaw && VALID_FORMATS.has(formatOverrideRaw as RoleFormat)
    ? (formatOverrideRaw as RoleFormat) : undefined;

  const timings = {
    read_file_ms: 0,
    parse_ms: 0,
    format_suggestion_ms: 0,
    campaign_ms: 0,
    dedupe_ms: 0,
    insert_job_ms: 0,
  };

  // Parse XLSX
  let sectionStartedAt = Date.now();
  const buffer = Buffer.from(await file.arrayBuffer());
  timings.read_file_ms = Date.now() - sectionStartedAt;

  let parse;
  try {
    sectionStartedAt = Date.now();
    parse = await parseRoleFile(buffer, { formatOverride });
    timings.parse_ms = Date.now() - sectionStartedAt;
  } catch (err) {
    return NextResponse.json({ ok: false, error: `Parse failed: ${(err as Error).message}` }, { status: 400 });
  }

  // v3: refuse to proceed when format is unknown and the user hasn't picked one.
  // As a best-effort UX improvement, try to suggest a format via Haiku so the
  // UI can prompt the user with a pre-filled suggestion instead of just blocking.
  if (parse.format === "unknown" && !formatOverride) {
    const firstRows = parse.rows.slice(0, 3).map(r => r.property.raw_role_row);
    sectionStartedAt = Date.now();
    const suggestion = await nullableTimeout(
      llmSuggestFormat(parse.detected_columns, firstRows),
      FORMAT_SUGGESTION_TIMEOUT_MS,
    );
    timings.format_suggestion_ms = Date.now() - sectionStartedAt;
    return NextResponse.json({
      ok: false,
      error: "format_unknown",
      detail: "Could not auto-detect the rôle format. Please re-upload and pick a format manually.",
      data: {
        detectedColumns: parse.detected_columns,
        errors: parse.errors,
        ...(suggestion ? { suggestion } : {}),
      },
    }, { status: 400 });
  }

  // Inject city into rows that have no city detected (e.g. Sherbrooke-Commercial
  // files have no "Ville" column — the city must come from the upload form).
  if (city) {
    for (const row of parse.rows) {
      if (!row.property.city) row.property.city = city;
    }
  }

  // Use service-role client to write the import_jobs row regardless of RLS.
  const admin = createSupabaseAdminClient();

  // Find or create campaign
  sectionStartedAt = Date.now();
  let campaignId: string | null = null;
  if (campaignName) {
    const { data: existing } = await admin.from("campaigns").select("id").eq("name", campaignName).maybeSingle();
    if (existing) campaignId = existing.id;
    else {
      const { data, error } = await admin.from("campaigns")
        .insert({ name: campaignName, city, created_by: user.id })
        .select("id").single();
      if (error) return NextResponse.json({ ok: false, error: `campaign: ${error.message}` }, { status: 500 });
      campaignId = data.id;
    }
  }
  timings.campaign_ms = Date.now() - sectionStartedAt;

  // Build a lightweight preview (counts + first 10 rows + errors)
  const ownerCount = parse.rows.reduce((n, r) => n + r.owners.length, 0);
  const phoneCount = parse.rows.reduce((n, r) => n + r.owners.reduce((a, o) => a + o.phones.length, 0), 0);
  const cities = [...new Set(parse.rows.map(r => r.property.city).filter(Boolean))];
  const previewRows = parse.rows.slice(0, 10).map(r => ({
    row: r.row_number,
    address: r.property.address,
    city: r.property.city,
    postal_code: r.property.postal_code,
    matricule: r.property.matricule,
    num_units: r.property.num_units,
    year_built: r.property.year_built,
    evaluation_total: r.property.evaluation_total,
    owners: r.owners.map(o => ({
      kind: o.kind,
      name: o.full_name,
      company_name: o.company_name,
      phones: o.phones,
    })),
    errors: r.errors,
  }));

  // Improvement 2: Phone-less file detection
  const ownersWithPhone = parse.rows.reduce(
    (n, r) => n + r.owners.filter(o => (o.phones ?? []).length > 0).length,
    0,
  );
  const uploadWarnings: string[] = [];
  if (ownerCount > 0 && ownersWithPhone === 0) {
    uploadWarnings.push("This file has no phone numbers; every contact will need enrichment.");
  }

  // Improvement 1: Pre-import dedupe check — count how many parsed properties already exist.
  let propertiesExisting = 0;
  try {
    sectionStartedAt = Date.now();
    const matricules = [
      ...new Set(parse.rows.map(row => row.property.matricule).filter((m): m is string => Boolean(m))),
    ];
    const existingMatricules = new Set<string>();
    for (const group of chunk(matricules, DEDUPE_BATCH_SIZE)) {
      const { data } = await admin
        .from("properties")
        .select("matricule")
        .in("matricule", group);
      for (const row of data ?? []) {
        const matricule = (row as { matricule: string | null }).matricule;
        if (matricule) existingMatricules.add(matricule);
      }
    }

    const addresses = [
      ...new Set(parse.rows.map(row => row.property.address).filter((a): a is string => Boolean(a))),
    ];
    const existingAddressesAnyCity = new Set<string>();
    const existingAddressCityPairs = new Set<string>();
    for (const group of chunk(addresses, DEDUPE_BATCH_SIZE)) {
      const { data } = await admin
        .from("properties")
        .select("address, city")
        .in("address", group);
      for (const row of data ?? []) {
        const property = row as { address: string | null; city: string | null };
        if (!property.address) continue;
        existingAddressesAnyCity.add(property.address);
        existingAddressCityPairs.add(addressCityKey(property.address, property.city));
      }
    }

    for (const row of parse.rows) {
      let found = false;
      if (row.property.matricule && existingMatricules.has(row.property.matricule)) found = true;
      if (!found && row.property.address) {
        const rowCity = row.property.city ? row.property.city : null;
        found = rowCity
          ? existingAddressCityPairs.has(addressCityKey(row.property.address, rowCity))
          : existingAddressesAnyCity.has(row.property.address);
      }
      if (found) propertiesExisting++;
    }
    timings.dedupe_ms = Date.now() - sectionStartedAt;
  } catch {
    // Non-critical — proceed without dedupe info
  }
  const propertiesNew = parse.rows.length - propertiesExisting;
  // Each new property creates leads for its owners; existing properties may also create new leads
  // (we approximate: owners on new properties all become leads)
  const leadsWouldBeCreated = ownerCount;
  const dedupeInfo = {
    properties_existing: propertiesExisting,
    properties_new: propertiesNew,
    leads_would_be_created: leadsWouldBeCreated,
  };

  sectionStartedAt = Date.now();
  const { data: job, error: jobErr } = await admin.from("import_jobs").insert({
    campaign_id: campaignId,
    uploaded_by: user.id,
    file_name: file.name,
    format_detected: parse.format,
    status: "preview",
    total_rows: parse.total_rows,
    errors_count: parse.errors.length,
    errors: parse.errors,
    preview_data: {
      rows: previewRows,
      summary: {
        properties: parse.rows.length,
        owners: ownerCount,
        phones: phoneCount,
        cities,
      },
      // Stash full parsed result for confirm step. Note: jsonb cap is 1GB,
      // typical rôle file is well under 5MB here.
      parsed_full: parse,
    },
    raw_meta: {
      uploaded_size_bytes: buffer.byteLength,
      analysis_timings_ms: timings,
      dedupe_mode: "batched",
    },
  }).select("id, status").single();
  timings.insert_job_ms = Date.now() - sectionStartedAt;

  if (jobErr) return NextResponse.json({ ok: false, error: jobErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    data: {
      jobId: job!.id,
      campaignId,
      format: parse.format,
      totalRows: parse.total_rows,
      summary: { properties: parse.rows.length, owners: ownerCount, phones: phoneCount, cities },
      previewRows,
      errorsCount: parse.errors.length,
      dedupe: dedupeInfo,
      warnings: uploadWarnings,
    },
  });
}
