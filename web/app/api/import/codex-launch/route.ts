// POST /api/import/codex-launch
// Operator-safe single-step import: upload/parse/commit/assign with idempotency.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePhoneEnrichmentOperator } from "@/lib/phone-enrichment/auth";
import { getOperatorEnabled } from "@/lib/phone-enrichment/session";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { parseRoleFile, type ParseResult, type RoleFormat } from "@/lib/role-parser";
import { commitImport } from "@/lib/import-commit";
import { autoAssignCallableLeads } from "@/lib/leads/auto-assign";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const VALID_FORMATS = new Set<RoleFormat>(["role_a", "role_b", "role_c", "role_d"]);

const Fields = z.object({
  idempotency_key: z.string().trim().min(1).max(200).optional(),
  campaignName: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  formatOverride: z.string().trim().optional(),
  autoAssign: z.union([z.literal("true"), z.literal("false")]).optional(),
}).passthrough();

function jsonError(error: string, status = 400, code = "bad_request") {
  return NextResponse.json({ ok: false, error, code }, { status });
}

function maybeFormat(value: string | undefined): RoleFormat | undefined {
  return value && VALID_FORMATS.has(value as RoleFormat) ? (value as RoleFormat) : undefined;
}

function summarizeParse(parse: ParseResult) {
  const ownerCount = parse.rows.reduce((n, row) => n + row.owners.length, 0);
  const phoneCount = parse.rows.reduce(
    (n, row) => n + row.owners.reduce((sum, owner) => sum + owner.phones.length, 0),
    0,
  );
  const cities = [...new Set(parse.rows.map(row => row.property.city).filter(Boolean))];
  return { ownerCount, phoneCount, cities };
}

function previewRows(parse: ParseResult) {
  return parse.rows.slice(0, 10).map(row => ({
    row: row.row_number,
    address: row.property.address,
    city: row.property.city,
    postal_code: row.property.postal_code,
    matricule: row.property.matricule,
    num_units: row.property.num_units,
    year_built: row.property.year_built,
    evaluation_total: row.property.evaluation_total,
    owners: row.owners.map(owner => ({
      kind: owner.kind,
      name: owner.full_name,
      company_name: owner.company_name,
      phones: owner.phones,
    })),
    errors: row.errors,
  }));
}

async function findPriorLaunch(
  sb: ReturnType<typeof createSupabaseAdminClient>,
  idempotencyKey: string | undefined,
) {
  if (!idempotencyKey) return null;

  const { data, error } = await sb
    .from("automation_events")
    .select("id,related_import_id,status,payload,result,error_message,occurred_at")
    .eq("actor_kind", "codex")
    .in("event_type", ["codex_import_completed", "codex_import_failed"])
    .order("occurred_at", { ascending: false })
    .limit(250);

  if (error) throw new Error(error.message);
  return (data ?? []).find((row: { payload?: unknown }) => {
    const payload = (row.payload ?? {}) as { codex?: { idempotency_key?: string } };
    return payload.codex?.idempotency_key === idempotencyKey;
  }) ?? null;
}

async function getOrCreateCampaign(input: {
  sb: ReturnType<typeof createSupabaseAdminClient>;
  campaignName: string | undefined;
  city: string | undefined;
  userId: string | null;
}) {
  if (!input.campaignName) return null;

  const { data: existing, error: existingErr } = await input.sb
    .from("campaigns")
    .select("id")
    .eq("name", input.campaignName)
    .maybeSingle();
  if (existingErr) throw new Error(`campaign lookup: ${existingErr.message}`);
  if (existing) return (existing as { id: string }).id;

  const payload: { name: string; city: string | null; created_by?: string } = {
    name: input.campaignName,
    city: input.city ?? null,
  };
  if (input.userId) payload.created_by = input.userId;

  const { data, error } = await input.sb
    .from("campaigns")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(`campaign create: ${error.message}`);
  return (data as { id: string }).id;
}

export async function POST(request: Request) {
  const auth = await requirePhoneEnrichmentOperator(request);
  if (!auth.ok) return auth.response;
  if (auth.actor !== "admin" && !getOperatorEnabled()) {
    return jsonError("Codex operator mode is disabled. Set SOCLE_CODEX_OPERATOR_ENABLED=true.", 403, "operator_disabled");
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Missing file.", 400, "missing_file");

  const parsedFields = Fields.safeParse(Object.fromEntries(form.entries()));
  if (!parsedFields.success) {
    return NextResponse.json({ ok: false, error: "Bad input", errors: parsedFields.error.issues }, { status: 400 });
  }

  const fields = parsedFields.data;
  const idempotencyKey = fields.idempotency_key;
  const formatOverride = maybeFormat(fields.formatOverride);
  const autoAssign = fields.autoAssign !== "false";
  const sb = createSupabaseAdminClient();

  try {
    const prior = await findPriorLaunch(sb, idempotencyKey);
    if (prior) return NextResponse.json({ ok: true, data: { duplicate: true, priorLaunch: prior } });

    const buffer = Buffer.from(await file.arrayBuffer());
    const parse = await parseRoleFile(buffer, { formatOverride, llmFallback: false });
    if (parse.format === "unknown" && !formatOverride) {
      return jsonError("Could not auto-detect the role format. Retry with formatOverride.", 400, "format_unknown");
    }

    if (fields.city) {
      for (const row of parse.rows) {
        if (!row.property.city) row.property.city = fields.city;
      }
    }

    const campaignId = await getOrCreateCampaign({
      sb,
      campaignName: fields.campaignName,
      city: fields.city,
      userId: auth.userId,
    });
    const summary = summarizeParse(parse);

    const { data: job, error: jobErr } = await sb
      .from("import_jobs")
      .insert({
        campaign_id: campaignId,
        uploaded_by: auth.userId,
        file_name: file.name,
        format_detected: parse.format,
        status: "processing",
        total_rows: parse.total_rows,
        errors_count: parse.errors.length,
        errors: parse.errors,
        started_at: new Date().toISOString(),
        preview_data: {
          rows: previewRows(parse),
          summary: {
            properties: parse.rows.length,
            owners: summary.ownerCount,
            phones: summary.phoneCount,
            cities: summary.cities,
          },
          parsed_full: parse,
        },
        raw_meta: {
          uploaded_size_bytes: buffer.byteLength,
          codex_idempotency_key: idempotencyKey ?? null,
          launched_by: "codex",
          launched_via: "/api/import/codex-launch",
        },
      })
      .select("id")
      .single();
    if (jobErr || !job) throw new Error(jobErr?.message ?? "import_jobs insert failed");

    const jobId = (job as { id: string }).id;
    let counts: Awaited<ReturnType<typeof commitImport>>;
    let assignment: Awaited<ReturnType<typeof autoAssignCallableLeads>> | null = null;

    try {
      counts = await commitImport(sb, parse, { importJobId: jobId, campaignId });
      await sb.from("import_jobs").update({
        status: "completed",
        properties_created: counts.properties_created,
        properties_updated: counts.properties_updated,
        contacts_created: counts.contacts_created,
        contacts_updated: counts.contacts_updated,
        phones_created: counts.phones_created,
        leads_created: counts.leads_created,
        leads_updated: counts.leads_updated,
        duplicates_seen: counts.duplicates_seen,
        errors_count: counts.errors.length,
        errors: counts.errors,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);

      if (autoAssign && counts.leads_created + counts.leads_updated > 0 && auth.userId) {
        assignment = await autoAssignCallableLeads(sb, { importJobId: jobId, assignedBy: auth.userId, limit: 500 });
      }

      const sessionUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/phone-enrichment/sessions/${jobId}`;
      await sb.from("automation_events").insert({
        source: "web_app",
        actor_kind: "codex",
        event_type: "codex_import_completed",
        status: counts.errors.length > 0 ? "partial" : "success",
        related_import_id: jobId,
        triggered_by: auth.userId,
        payload: {
          file_name: file.name,
          campaign_id: campaignId,
          codex: {
            action_type: "launch_import",
            idempotency_key: idempotencyKey ?? null,
            actor: auth.actor,
            auto_assign: autoAssign,
          },
        },
        result: { counts, assignment, sessionUrl },
      });

      return NextResponse.json({
        ok: true,
        data: { jobId, counts, assignment, sessionUrl },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await sb.from("import_jobs").update({
        status: "failed",
        errors_count: 1,
        errors: [{ row: 0, message }],
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
      await sb.from("automation_events").insert({
        source: "web_app",
        actor_kind: "codex",
        event_type: "codex_import_failed",
        status: "failed",
        related_import_id: jobId,
        triggered_by: auth.userId,
        payload: {
          file_name: file.name,
          campaign_id: campaignId,
          codex: {
            action_type: "launch_import",
            idempotency_key: idempotencyKey ?? null,
            actor: auth.actor,
          },
        },
        error_message: message,
      });
      return jsonError(message, 500, "import_failed");
    }
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500, "launch_failed");
  }
}
