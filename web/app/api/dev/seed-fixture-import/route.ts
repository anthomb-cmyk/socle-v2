// POST /api/dev/seed-fixture-import — admin-only.
//
// One-shot import proof:
//   1. Generates the 5-row Granby fixture XLSX in memory (no filesystem)
//   2. Runs it through the real import pipeline (parseRoleFile → commitImport)
//   3. Finds or creates the Gaylord seed caller
//   4. Assigns all newly-created leads to that caller
//   5. Returns jobId + counts + callerId so you can verify /calls/queue
//
// This proves the full path: rôle XLSX → parser → DB write → caller assignment.
// Safe to run multiple times — idempotent (upserts on matricule + full_name).

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { parseRoleFile } from "@/lib/role-parser";
import { commitImport } from "@/lib/import-commit";

export const runtime = "nodejs";
export const maxDuration = 60;

// ─── Fixture data (same 5 rows as web/fixtures/granby-sample-5rows.xlsx) ──
function buildFixtureBuffer(): Buffer {
  const rows = [
    {
      "Adresse": "142 rue Denison Est",
      "Ville": "GRANBY",
      "Matricule": "1490-88-4213-0-000-0001",
      "Logements": 6,
      "Année construction": 1972,
      "Évaluation totale": 875000,
      "Évaluation terrain": 120000,
      "Évaluation bâtiment": 755000,
      "Propriétaire1_Nom": "TREMBLAY, JEAN-PIERRE",
      "Propriétaire1_Téléphone": "(450) 770-1234",
      "Propriétaire1_Adresse": "142 rue Denison Est Granby (Québec) J2G3B8",
    },
    {
      "Adresse": "887 boulevard Leclerc Ouest",
      "Ville": "GRANBY",
      "Matricule": "1490-55-9987-0-000-0002",
      "Logements": 12,
      "Année construction": 1965,
      "Évaluation totale": 1950000,
      "Évaluation terrain": 280000,
      "Évaluation bâtiment": 1670000,
      "Propriétaire1_Nom": "9234-1871 Québec inc.",
      "Propriétaire1_Téléphone": "450-375-5501",
      "Propriétaire1_Adresse": "887 boulevard Leclerc O Granby (Québec) J2H4K2",
    },
    {
      "Adresse": "55 rue Saint-Charles",
      "Ville": "GRANBY",
      "Matricule": "1490-33-7762-0-000-0003",
      "Logements": 4,
      "Année construction": 1989,
      "Évaluation totale": 620000,
      "Propriétaire1_Nom": "GAGNON, MARIE-FRANCE",
      "Propriétaire1_Téléphone": "(450) 375-8812",
      "Propriétaire2_Nom": "GAGNON, RICHARD",
      "Propriétaire2_Téléphone": "(450) 375-8812",
    },
    {
      "Adresse": "301 avenue Dufferin",
      "Ville": "GRANBY",
      "Matricule": "1490-77-2345-0-000-0004",
      "Logements": 8,
      "Année construction": 1978,
      "Évaluation totale": 1100000,
      "Propriétaire1_Nom": "Gestion Immobilière Granby inc.",
      "Propriétaire1_Téléphone": "450-372-0044",
      "Propriétaire1_Adresse": "301 avenue Dufferin Granby (Québec) J2G4P5",
    },
    {
      "Adresse": "29 rue Brodeur",
      "Ville": "GRANBY",
      "Matricule": "1490-21-8834-0-000-0005",
      "Logements": 3,
      "Année construction": 2001,
      "Évaluation totale": 490000,
      "Propriétaire1_Nom": "Fiducie Brodeur",
      "Propriétaire1_Téléphone": "450-375-1122",
    },
  ];
  const sheet = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Rôle");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// ─── Find or create Gaylord seed caller ───────────────────────────────────
async function ensureSeedCaller(
  sb: ReturnType<typeof createSupabaseAdminClient>,
  adminUserId: string,
): Promise<{ userId: string; email: string; displayName: string; created: boolean }> {
  const CALLER_EMAIL = "gaylord+seed@socleacquisitions.com";
  const CALLER_NAME = "Gaylord (seed)";

  // Check users_meta first (cheaper than listing all auth users)
  const { data: meta } = await sb
    .from("users_meta")
    .select("user_id, display_name")
    .eq("role", "caller")
    .limit(1)
    .maybeSingle();

  if (meta) {
    return { userId: meta.user_id, email: CALLER_EMAIL, displayName: meta.display_name ?? CALLER_NAME, created: false };
  }

  // Create via admin API
  const { data: created } = await sb.auth.admin.createUser({
    email: CALLER_EMAIL,
    email_confirm: true,
    user_metadata: { display_name: CALLER_NAME },
    app_metadata: { role: "caller" },
  });

  let userId = created?.user?.id ?? null;

  if (!userId) {
    // Already exists in auth but missing from users_meta
    const list = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list.data?.users?.find((u: { email?: string }) => u.email === CALLER_EMAIL);
    if (existing) userId = existing.id;
  }

  if (!userId) throw new Error("Could not create or find seed caller user");

  await sb.from("users_meta").upsert({ user_id: userId, display_name: CALLER_NAME, role: "caller" });
  await sb.auth.admin.updateUserById(userId, { app_metadata: { role: "caller" } });

  await sb.from("automation_events").insert({
    source: "system", event_type: "seed_caller", status: "success",
    triggered_by: adminUserId,
    payload: { email: CALLER_EMAIL, displayName: CALLER_NAME, created: true, userId },
  });

  return { userId, email: CALLER_EMAIL, displayName: CALLER_NAME, created: true };
}

// ─── Route handler ─────────────────────────────────────────────────────────
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const sb = createSupabaseAdminClient();
  const adminId = auth.user.id;

  // 1. Ensure seed caller exists
  const caller = await ensureSeedCaller(sb, adminId);

  // 2. Find or create campaign (idempotent by name)
  const campaignName = "Granby Sample — fixture";
  const { data: existingCampaign } = await sb
    .from("campaigns").select("id").eq("name", campaignName).maybeSingle();

  let campaignId: string;
  if (existingCampaign) {
    campaignId = existingCampaign.id;
  } else {
    const { data, error } = await sb
      .from("campaigns")
      .insert({ name: campaignName, city: "Granby", source: "dev_seed", created_by: adminId })
      .select("id").single();
    if (error || !data) {
      return NextResponse.json({ ok: false, error: `campaign: ${error?.message}` }, { status: 500 });
    }
    campaignId = data.id;
  }

  // 3. Build + parse fixture in memory
  const buf = buildFixtureBuffer();
  let parse;
  try {
    parse = parseRoleFile(buf);
  } catch (err) {
    return NextResponse.json({ ok: false, error: `parse: ${(err as Error).message}` }, { status: 500 });
  }

  // 4. Create import_job row (status=processing — skip preview step)
  const { data: job, error: jobErr } = await sb
    .from("import_jobs")
    .insert({
      campaign_id: campaignId,
      uploaded_by: adminId,
      file_name: "granby-sample-5rows.xlsx",
      format_detected: parse.format,
      status: "processing",
      total_rows: parse.total_rows,
      errors_count: parse.errors.length,
      started_at: new Date().toISOString(),
      raw_meta: { seed: true, source: "seed-fixture-import" },
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    return NextResponse.json({ ok: false, error: `import_job: ${jobErr?.message}` }, { status: 500 });
  }

  // 5. Commit import (properties + contacts + phones + leads)
  const counts = await commitImport(sb, parse, { importJobId: job.id, campaignId });

  // 6. Mark import_job completed
  await sb.from("import_jobs").update({
    status: counts.errors.length === 0 ? "completed" : "completed",
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
  }).eq("id", job.id);

  // 7. Fetch the lead IDs created by this import job
  const { data: importedLeads } = await sb
    .from("leads")
    .select("id")
    .eq("source_import_job_id", job.id)
    .eq("status", "new");

  const leadIds = (importedLeads ?? []).map((l: { id: string }) => l.id);

  // 8. Assign all new leads to seed caller
  let assignedCount = 0;
  if (leadIds.length > 0) {
    const { count } = await sb
      .from("leads")
      .update({ assigned_to: caller.userId }, { count: "exact" })
      .in("id", leadIds);
    assignedCount = count ?? 0;

    // assignment history
    await sb.from("lead_assignments").insert(
      leadIds.map(lead_id => ({
        lead_id,
        assigned_to: caller.userId,
        assigned_by: adminId,
      })),
    );
  }

  // 9. Audit event
  await sb.from("automation_events").insert({
    source: "web_app",
    event_type: "import_completed",
    status: counts.errors.length > 0 ? "partial" : "success",
    related_import_id: job.id,
    triggered_by: adminId,
    payload: {
      file_name: "granby-sample-5rows.xlsx",
      format: parse.format,
      campaign_id: campaignId,
      seed: true,
      assigned_to: caller.userId,
    },
    result: { ...counts, assignedCount },
  });

  return NextResponse.json({
    ok: true,
    data: {
      jobId: job.id,
      campaignId,
      format: parse.format,
      counts,
      leadIds,
      assignedCount,
      caller: {
        userId: caller.userId,
        email: caller.email,
        displayName: caller.displayName,
        created: caller.created,
      },
      nextSteps: {
        leads: `/leads?campaign=${campaignId}`,
        callerQueue: "/calls/queue",
        importJob: `/admin/events`,
      },
    },
  });
}
