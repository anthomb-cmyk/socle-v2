// POST /api/import/upload
// multipart/form-data: file (xlsx), [campaignName], [city]
// Returns: { jobId, format, totalRows, preview, errors }

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { parseRoleFile, type RoleFormat } from "@/lib/role-parser";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { llmSuggestFormat } from "@/lib/llm/format-detection";

const VALID_FORMATS = new Set<RoleFormat>(["role_a", "role_b", "role_c", "role_d"]);

export const runtime = "nodejs";
export const maxDuration = 60;

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

  // Parse XLSX
  const buffer = Buffer.from(await file.arrayBuffer());
  let parse;
  try {
    parse = await parseRoleFile(buffer, { formatOverride });
  } catch (err) {
    return NextResponse.json({ ok: false, error: `Parse failed: ${(err as Error).message}` }, { status: 400 });
  }

  // v3: refuse to proceed when format is unknown and the user hasn't picked one.
  // As a best-effort UX improvement, try to suggest a format via Haiku so the
  // UI can prompt the user with a pre-filled suggestion instead of just blocking.
  if (parse.format === "unknown" && !formatOverride) {
    const firstRows = parse.rows.slice(0, 3).map(r => r.property.raw_role_row);
    const suggestion = await llmSuggestFormat(parse.detected_columns, firstRows).catch(() => null);
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
    for (const row of parse.rows) {
      let found = false;
      if (row.property.matricule) {
        const { data } = await admin.from("properties").select("id").eq("matricule", row.property.matricule).maybeSingle();
        if (data) { found = true; }
      }
      if (!found) {
        const q = admin.from("properties").select("id").eq("address", row.property.address);
        const rowCity = row.property.city ? row.property.city : null;
        if (rowCity) q.eq("city", rowCity);
        const { data } = await q.maybeSingle();
        if (data) found = true;
      }
      if (found) propertiesExisting++;
    }
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
    raw_meta: { uploaded_size_bytes: buffer.byteLength },
  }).select("id, status").single();

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
