// POST /api/import/upload
// multipart/form-data: file (xlsx), [campaignName], [city]
// Returns: { jobId, format, totalRows, preview, errors }

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { parseRoleFile } from "@/lib/role-parser";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

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

  // Parse XLSX
  const buffer = Buffer.from(await file.arrayBuffer());
  let parse;
  try {
    parse = parseRoleFile(buffer);
  } catch (err) {
    return NextResponse.json({ ok: false, error: `Parse failed: ${(err as Error).message}` }, { status: 400 });
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
      format: parse.format,
      totalRows: parse.total_rows,
      summary: { properties: parse.rows.length, owners: ownerCount, phones: phoneCount, cities },
      previewRows,
      errorsCount: parse.errors.length,
    },
  });
}
