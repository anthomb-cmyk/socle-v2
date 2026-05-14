// /admin/imports — import history list (server component)
// Lists all import_jobs ordered by created_at desc.

import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

type ImportJob = {
  id: string;
  file_name: string | null;
  status: string;
  format_detected: string | null;
  total_rows: number | null;
  properties_created: number | null;
  contacts_created: number | null;
  leads_created: number | null;
  phones_created: number | null;
  errors_count: number | null;
  created_at: string;
};

export const dynamic = "force-dynamic";

export default async function AdminImportsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "admin") redirect("/login");

  const admin = createSupabaseAdminClient();
  const { data: jobs } = await admin
    .from("import_jobs")
    .select("id, file_name, status, format_detected, total_rows, properties_created, contacts_created, leads_created, phones_created, errors_count, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const imports: ImportJob[] = (jobs ?? []) as ImportJob[];

  function statusColor(status: string): string {
    if (status === "completed") return "var(--crm-green)";
    if (status === "failed") return "var(--crm-red)";
    if (status === "processing") return "var(--crm-amber)";
    return "var(--crm-text3)";
  }

  return (
    <main className="crm-page-narrow" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 className="crm-page-title">Historique des imports</h1>
        <p className="crm-page-sub">Tous les fichiers importés, du plus récent au plus ancien.</p>
      </div>

      <div className="crm-card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12, whiteSpace: "nowrap", borderCollapse: "collapse" }}>
          <thead style={{ background: "var(--crm-bg-alt)", color: "var(--crm-text3)", fontSize: 10, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase" }}>
            <tr>
              <th style={{ textAlign: "left", padding: "8px 12px" }}>Fichier</th>
              <th style={{ textAlign: "left", padding: "8px 12px" }}>Statut</th>
              <th style={{ textAlign: "left", padding: "8px 12px" }}>Format</th>
              <th style={{ textAlign: "right", padding: "8px 12px" }}>Propriétés</th>
              <th style={{ textAlign: "right", padding: "8px 12px" }}>Contacts</th>
              <th style={{ textAlign: "right", padding: "8px 12px" }}>Leads</th>
              <th style={{ textAlign: "right", padding: "8px 12px" }}>Téléphones</th>
              <th style={{ textAlign: "right", padding: "8px 12px" }}>Erreurs</th>
              <th style={{ textAlign: "left", padding: "8px 12px" }}>Date</th>
              <th style={{ textAlign: "left", padding: "8px 12px" }}></th>
            </tr>
          </thead>
          <tbody>
            {imports.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: "24px", textAlign: "center", color: "var(--crm-text3)" }}>
                  Aucun import trouvé.
                </td>
              </tr>
            )}
            {imports.map(job => (
              <tr key={job.id} style={{ borderTop: "1px solid var(--crm-card-border)" }}>
                <td style={{ padding: "8px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                  <span title={job.file_name ?? "—"}>{job.file_name ?? "—"}</span>
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{ color: statusColor(job.status), fontWeight: 600 }}>{job.status}</span>
                </td>
                <td style={{ padding: "8px 12px", color: "var(--crm-text3)", fontFamily: "monospace", fontSize: 11 }}>
                  {job.format_detected ?? "—"}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}>{job.properties_created ?? "—"}</td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}>{job.contacts_created ?? "—"}</td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}>{job.leads_created ?? "—"}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", color: (job.phones_created ?? 0) > 0 ? "var(--crm-green)" : undefined }}>
                  {job.phones_created ?? "—"}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right", color: (job.errors_count ?? 0) > 0 ? "var(--crm-red)" : undefined }}>
                  {job.errors_count ?? "—"}
                </td>
                <td style={{ padding: "8px 12px", color: "var(--crm-text3)", fontSize: 11 }}>
                  {new Date(job.created_at).toLocaleString("fr-CA", { dateStyle: "short", timeStyle: "short" })}
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <Link
                    href={`/admin/imports/${job.id}` as never}
                    style={{ fontSize: 11, color: "var(--crm-gold)", textDecoration: "underline", whiteSpace: "nowrap" }}
                  >
                    Voir audit →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
