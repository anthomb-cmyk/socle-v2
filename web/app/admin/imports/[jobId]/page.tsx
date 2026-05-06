"use client";
// /admin/imports/[jobId] — per-import audit viewer with revert button.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type RowAudit = {
  id: string;
  row_number: number;
  outcome: string;
  blocking: string[];
  warnings: string[];
  owners: Array<{
    kind: string;
    name_parse_quality: string | null;
    name_was_inverted: boolean;
    mailing_parse_quality: string | null;
    phones_extracted: number;
    phones_rejected: number;
  }>;
};

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

function outcomeColor(outcome: string): string {
  if (outcome === "imported_clean") return "var(--crm-green)";
  if (outcome === "imported_with_warnings") return "var(--crm-amber)";
  if (outcome === "blocked") return "var(--crm-red)";
  if (outcome === "error") return "var(--crm-red)";
  return "var(--crm-text3)";
}

export default function ImportJobAuditPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params?.jobId as string;

  const [job, setJob] = useState<ImportJob | null>(null);
  const [rows, setRows] = useState<RowAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Revert modal state
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [revertResult, setRevertResult] = useState<{ reverted: number } | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    (async () => {
      try {
        const [jobResp, rowsResp] = await Promise.all([
          fetch(`/api/admin/imports/${jobId}`),
          fetch(`/api/admin/imports/${jobId}/rows`),
        ]);
        const jobJson = await jobResp.json();
        const rowsJson = await rowsResp.json();
        if (jobJson.ok) setJob(jobJson.data);
        if (rowsJson.ok) setRows(rowsJson.data);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [jobId]);

  async function onRevert() {
    setReverting(true);
    setRevertError(null);
    try {
      const resp = await fetch(`/api/admin/imports/${jobId}/revert`, { method: "POST" });
      const json = await resp.json();
      if (!json.ok) {
        setRevertError(json.error ?? "Erreur lors du revert.");
      } else {
        setRevertResult(json.data);
        setShowRevertModal(false);
      }
    } catch (e) {
      setRevertError((e as Error).message);
    } finally {
      setReverting(false);
    }
  }

  if (loading) {
    return (
      <main className="crm-page-narrow">
        <p style={{ color: "var(--crm-text3)", fontSize: 13 }}>Chargement…</p>
      </main>
    );
  }

  if (error || !job) {
    return (
      <main className="crm-page-narrow">
        <p style={{ color: "var(--crm-red)", fontSize: 13 }}>{error ?? "Import introuvable."}</p>
        <Link href={"/admin/imports" as never} style={{ fontSize: 13, color: "var(--crm-gold)" }}>← Retour</Link>
      </main>
    );
  }

  const leadsCreated = job.leads_created ?? 0;

  return (
    <main className="crm-page-narrow" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <Link href={"/admin/imports" as never} style={{ fontSize: 12, color: "var(--crm-gold)", textDecoration: "underline" }}>
            ← Historique des imports
          </Link>
          <h1 className="crm-page-title" style={{ marginTop: 8 }}>{job.file_name ?? "Import sans nom"}</h1>
          <p style={{ fontSize: 12, color: "var(--crm-text3)", margin: 0 }}>
            {new Date(job.created_at).toLocaleString("fr-CA")} · {job.format_detected ?? "format inconnu"} · statut:{" "}
            <strong style={{ color: outcomeColor(job.status) }}>{job.status}</strong>
          </p>
        </div>

        {leadsCreated > 0 && !revertResult && (
          <button
            onClick={() => setShowRevertModal(true)}
            className="crm-btn"
            style={{ fontSize: 12, borderColor: "var(--crm-red)", color: "var(--crm-red)", whiteSpace: "nowrap" }}
          >
            Annuler cet import
          </button>
        )}
      </div>

      {revertResult && (
        <div style={{ background: "var(--crm-bg-alt)", border: "1px solid var(--crm-card-border)", borderRadius: 8, padding: "12px 16px", fontSize: 13 }}>
          <strong style={{ color: "var(--crm-amber)" }}>Import annulé :</strong> {revertResult.reverted} lead{revertResult.reverted !== 1 ? "s" : ""} marqué{revertResult.reverted !== 1 ? "s" : ""} comme <code>unsuitable_for_phone_enrichment</code>.
          Les données (contacts, propriétés) sont conservées pour l&rsquo;audit.
        </div>
      )}

      {/* Summary stats */}
      <div className="crm-card" style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {[
          { label: "Propriétés", value: job.properties_created },
          { label: "Contacts", value: job.contacts_created },
          { label: "Leads", value: job.leads_created },
          { label: "Téléphones", value: job.phones_created },
          { label: "Erreurs", value: job.errors_count, negative: true },
          { label: "Lignes total", value: job.total_rows },
        ].map(({ label, value, negative }) => (
          <div key={label} style={{ borderRadius: 8, padding: "8px 10px", background: "var(--crm-bg-alt)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: negative && (value ?? 0) > 0 ? "var(--crm-red)" : "var(--crm-text)" }}>
              {value ?? "—"}
            </div>
          </div>
        ))}
      </div>

      {/* Row audit table */}
      <div>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--crm-text)", marginBottom: 8 }}>Audit par ligne ({rows.length})</h2>
        <div className="crm-card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <thead style={{ background: "var(--crm-bg-alt)", color: "var(--crm-text3)", fontSize: 10, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase" }}>
              <tr>
                <th style={{ textAlign: "left", padding: "7px 10px" }}>Ligne</th>
                <th style={{ textAlign: "left", padding: "7px 10px" }}>Résultat</th>
                <th style={{ textAlign: "left", padding: "7px 10px" }}>Propriétaires</th>
                <th style={{ textAlign: "left", padding: "7px 10px" }}>Avertissements</th>
                <th style={{ textAlign: "left", padding: "7px 10px" }}>Blocages</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "20px", textAlign: "center", color: "var(--crm-text3)" }}>
                    Aucun audit de ligne disponible.
                  </td>
                </tr>
              )}
              {rows.map(row => (
                <tr key={row.id} style={{ borderTop: "1px solid var(--crm-card-border)" }}>
                  <td style={{ padding: "6px 10px", fontFamily: "monospace" }}>{row.row_number}</td>
                  <td style={{ padding: "6px 10px" }}>
                    <span style={{ color: outcomeColor(row.outcome), fontWeight: 600 }}>{row.outcome}</span>
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    {row.owners.length === 0 ? (
                      <span style={{ color: "var(--crm-text3)" }}>—</span>
                    ) : (
                      row.owners.map((o, i) => (
                        <span key={i} style={{ display: "block", fontSize: 10 }}>
                          {o.kind} · addr:{o.mailing_parse_quality ?? "?"} · tél:{o.phones_extracted}
                          {o.name_was_inverted && " · inversé"}
                        </span>
                      ))
                    )}
                  </td>
                  <td style={{ padding: "6px 10px", maxWidth: 260, color: "var(--crm-amber)", fontSize: 10 }}>
                    {row.warnings.length === 0 ? (
                      <span style={{ color: "var(--crm-text3)" }}>—</span>
                    ) : (
                      row.warnings.map((w, i) => <div key={i}>{w}</div>)
                    )}
                  </td>
                  <td style={{ padding: "6px 10px", maxWidth: 200, color: "var(--crm-red)", fontSize: 10 }}>
                    {row.blocking.length === 0 ? (
                      <span style={{ color: "var(--crm-text3)" }}>—</span>
                    ) : (
                      row.blocking.map((b, i) => <div key={i}>{b}</div>)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Revert confirmation modal */}
      {showRevertModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 1000,
        }}>
          <div className="crm-card" style={{ padding: "24px", maxWidth: 420, width: "90%", display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--crm-red)", margin: 0 }}>Annuler cet import ?</h2>
            <p style={{ fontSize: 13, color: "var(--crm-text2)", margin: 0 }}>
              Cette action va marquer <strong>{leadsCreated} lead{leadsCreated !== 1 ? "s" : ""}</strong> de cet import
              comme <code>unsuitable_for_phone_enrichment</code> et enregistrer un événement d&rsquo;audit.
              Les contacts et propriétés sont <strong>conservés</strong>.
            </p>
            {revertError && <p style={{ fontSize: 13, color: "var(--crm-red)" }}>{revertError}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={onRevert}
                disabled={reverting}
                className="crm-btn"
                style={{ borderColor: "var(--crm-red)", color: "var(--crm-red)", opacity: reverting ? 0.6 : 1 }}
              >
                {reverting ? "Annulation…" : `Annuler ${leadsCreated} lead${leadsCreated !== 1 ? "s" : ""}`}
              </button>
              <button
                onClick={() => { setShowRevertModal(false); setRevertError(null); }}
                disabled={reverting}
                className="crm-btn"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <button onClick={() => router.back()} className="crm-btn" style={{ fontSize: 12 }}>← Retour</button>
      </div>
    </main>
  );
}
