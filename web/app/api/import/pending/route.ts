// GET /api/import/pending
//
// Returns the most recent import_job in status="preview" for the current
// user (within the last 24h), in the SAME shape as POST /api/import/upload's
// response so the import page can rehydrate its preview state cleanly.
//
// Used by the import page on mount to recover from accidental refreshes
// that wipe React state but leave the preview row in the DB.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const admin = createSupabaseAdminClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("import_jobs")
    .select("id, campaign_id, file_name, format_detected, total_rows, errors_count, preview_data, created_at")
    .eq("status", "preview")
    .eq("uploaded_by", user.id)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: true, data: null });

  // Reshape into the same payload that /api/import/upload returns so the
  // client's setPreview() works unchanged.
  const pd = (data.preview_data ?? {}) as {
    rows?: unknown[];
    summary?: { properties: number; owners: number; phones: number; cities: string[] };
    parsed_full?: unknown;
    dedupe?: unknown;
    warnings?: string[];
  };

  return NextResponse.json({
    ok: true,
    data: {
      jobId:        data.id,
      campaignId:   data.campaign_id,
      fileName:     data.file_name,
      format:       data.format_detected ?? "unknown",
      totalRows:    data.total_rows ?? 0,
      summary:      pd.summary ?? { properties: 0, owners: 0, phones: 0, cities: [] },
      previewRows:  pd.rows ?? [],
      errorsCount:  data.errors_count ?? 0,
      dedupe:       pd.dedupe ?? null,
      warnings:     pd.warnings ?? [],
      createdAt:    data.created_at,
    },
  });
}
