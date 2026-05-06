"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import NextStepBanner from "@/components/next-step-banner";
import type { ImportDoneCounts } from "@/components/next-step-banner";

type PreviewSummary = {
  jobId: string;
  campaignId: string | null;
  format: string;
  totalRows: number;
  summary: { properties: number; owners: number; phones: number; cities: string[] };
  previewRows: Array<{
    row: number; address: string; city: string | null;
    postal_code?: string; matricule?: string;
    num_units?: number; year_built?: number; evaluation_total?: number;
    owners: Array<{ kind: string; name: string; company_name?: string; phones: string[] }>;
    errors: string[];
  }>;
  errorsCount: number;
  dedupe?: { properties_existing: number; properties_new: number; leads_would_be_created: number };
  warnings?: string[];
};

// Shape returned by GET /api/import/[jobId] while polling
type JobPollData = {
  id: string;
  status: string;
  total_rows: number | null;
  properties_created: number | null;
  contacts_created: number | null;
  phones_created: number | null;
  leads_created: number | null;
  errors_count: number | null;
  completed_at: string | null;
  created_at: string;
};

type Counts = {
  properties_created: number; properties_updated: number;
  contacts_created: number; contacts_updated: number;
  phones_created: number; leads_created: number; leads_updated: number;
  duplicates_seen: number; errors: { row: number; message: string }[];
};

type User = { user_id: string; display_name: string; role: string };

const POLL_INTERVAL_MS = 1500;

export default function ImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Counts | null>(null);
  const [errorsOpen, setErrorsOpen] = useState(false);

  // Confirmer / polling state
  const [confirming, setConfirming] = useState(false);
  const [pollData, setPollData] = useState<JobPollData | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const confirmStartRef = useRef<number | null>(null);

  // Post-import quick-assign state
  const [users, setUsers] = useState<User[]>([]);
  const [assignTarget, setAssignTarget] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<{ count: number; name: string } | null>(null);
  const [newLeadIds, setNewLeadIds] = useState<string[]>([]);
  const [campaignIdForResult, setCampaignIdForResult] = useState<string | null>(null);

  // Auto-enrich checkbox (Improvement 7)
  const [autoEnrich, setAutoEnrich] = useState(false);

  // Post-import enrichment via banner
  const [enrichBusy, setEnrichBusy] = useState(false);

  // Banner data when import is done
  const [importDoneCounts, setImportDoneCounts] = useState<ImportDoneCounts | null>(null);

  useEffect(() => {
    fetch("/api/users").then(r => r.json()).then(j => {
      if (j.ok) setUsers(j.data.filter((u: User) => u.role === "caller" || u.role === "cold_caller"));
    });
  }, []);

  // Stop polling helper
  function stopPolling() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // Start polling /api/import/[jobId] every 1.5 s
  function startPolling(jobId: string, campaignId: string | null) {
    stopPolling();
    confirmStartRef.current = Date.now();

    let consecutivePollFailures = 0;
    const MAX_TOLERATED_FAILURES = 5;   // ~7-8s outage tolerated silently
    const MAX_TOTAL_FAILURES = 30;       // ~45s — give up
    const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 min hard ceiling

    pollRef.current = setInterval(async () => {
      // Hard ceiling — if we've polled for more than 10 min and never seen completed/failed, stop
      if (confirmStartRef.current && Date.now() - confirmStartRef.current > MAX_POLL_DURATION_MS) {
        stopPolling();
        setConfirming(false);
        setError("Le suivi de l'import a expiré. Vérifiez /admin/enrichment ou les logs Railway.");
        return;
      }

      try {
        const resp = await fetch(`/api/import/${jobId}`);
        if (!resp.ok) {
          consecutivePollFailures++;
          if (consecutivePollFailures >= MAX_TOTAL_FAILURES) {
            stopPolling();
            setConfirming(false);
            setError("Connexion perdue pendant le suivi de l'import. L'import peut quand même être en cours côté serveur — vérifiez /admin/enrichment dans une minute.");
          }
          return;
        }
        const json = await resp.json();
        if (!json.ok) return;
        consecutivePollFailures = 0; // reset on any successful poll
        const job: JobPollData = json.data;
        setPollData(job);

        if (job.status === "completed" || job.status === "failed") {
          stopPolling();
          setConfirming(false);

          if (job.status === "completed") {
            // Fetch final result to get all fields including *_updated
            const finalResp = await fetch(`/api/import/${jobId}`);
            const finalJson = await finalResp.json();
            const finalJob: JobPollData = finalJson.ok ? finalJson.data : job;

            const fakeCounts: Counts = {
              properties_created: finalJob.properties_created ?? 0,
              properties_updated: 0,
              contacts_created: finalJob.contacts_created ?? 0,
              contacts_updated: 0,
              phones_created: finalJob.phones_created ?? 0,
              leads_created: finalJob.leads_created ?? 0,
              leads_updated: 0,
              duplicates_seen: 0,
              errors: [],
            };
            setResult(fakeCounts);
            setCampaignIdForResult(campaignId);

            // Build banner counts
            setImportDoneCounts({
              leadsCreated: finalJob.leads_created ?? 0,
              propertiesCreated: finalJob.properties_created ?? 0,
              contactsCreated: finalJob.contacts_created ?? 0,
              phonesCreated: finalJob.phones_created ?? 0,
              errorsCount: finalJob.errors_count ?? 0,
              campaignName: campaignName || null,
              campaignId,
            });

            // Fetch newly created lead IDs for quick-assign
            if (campaignId) {
              const leadsResp = await fetch(`/api/leads?campaign_id=${campaignId}&limit=500`);
              const leadsJson = await leadsResp.json();
              if (leadsJson.ok) {
                setNewLeadIds(leadsJson.data.leads.map((l: { lead_id: string }) => l.lead_id));
              }
            }
          } else {
            // failed
            setError("L'import a échoué. Vérifiez les logs ou réessayez.");
          }
        }
      } catch {
        // Network hiccup — count it but keep polling
        consecutivePollFailures++;
        if (consecutivePollFailures >= MAX_TOTAL_FAILURES) {
          stopPolling();
          setConfirming(false);
          setError("Connexion perdue pendant le suivi de l'import. L'import peut quand même être en cours côté serveur — vérifiez /admin/enrichment dans une minute.");
        }
      }
    }, POLL_INTERVAL_MS);
  }

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null); setBusy(true); setPreview(null); setResult(null);
    setAssignResult(null); setNewLeadIds([]); setImportDoneCounts(null); setPollData(null);

    const fd = new FormData();
    fd.append("file", file);
    if (campaignName.trim()) fd.append("campaignName", campaignName.trim());
    if (city.trim()) fd.append("city", city.trim());

    const resp = await fetch("/api/import/upload", { method: "POST", body: fd });
    const json = await resp.json();
    setBusy(false);
    if (!json.ok) { setError(json.error); return; }
    setPreview({ ...json.data, campaignId: json.data.campaignId ?? null });
  }

  async function onConfirm() {
    if (!preview || confirming) return;
    setConfirming(true);
    setError(null);
    setPollData(null);

    const { jobId, campaignId } = preview;

    // Start polling immediately (before the POST resolves)
    startPolling(jobId, campaignId);

    // Fire POST — it will run for up to 5 minutes server-side.
    // We don't await in a way that blocks UI; the interval above handles state.
    fetch(`/api/import/${jobId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoEnrich }),
    }).then(async resp => {
      let json: { ok: boolean; error?: string } = { ok: true };
      try { json = await resp.json(); } catch { /* non-JSON response — keep polling */ }
      if (!json.ok) {
        // If the server returned a 'wrong status' error, the import is
        // already running — keep polling, just surface a friendlier note
        // (the polling will pick up the completed state shortly).
        const errStr = String(json.error ?? "");
        if (/processing|preview/i.test(errStr) && /expected|status/i.test(errStr)) {
          // Don't tear down — the prior import is in flight, polling will catch it
          return;
        }
        // Real error — stop polling and surface it
        stopPolling();
        setConfirming(false);
        setError(json.error ?? "Erreur lors de la confirmation.");
      }
      // On success the polling interval will have already transitioned the UI
      // once it sees status === 'completed'. We just let it run.
    }).catch(() => {
      // Connection drop on the LONG confirm POST is normal during a Railway
      // redeploy or transient network blip. The job is almost certainly still
      // running server-side. Don't tear down — let the polling loop confirm
      // completion (or fail it via the polling-side failure counter).
    });
  }

  async function quickEnrich() {
    if (newLeadIds.length === 0 || !importDoneCounts) return;
    setEnrichBusy(true);
    try {
      await fetch("/api/enrichment-jobs/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: newLeadIds, jobType: "find_phone", force: false }),
      });
      const dest = campaignIdForResult
        ? `/leads?campaign_id=${campaignIdForResult}&_just_enriched=1`
        : "/leads?_just_enriched=1";
      router.push(dest as never);
    } catch {
      setEnrichBusy(false);
    }
  }

  async function quickAssign() {
    if (!assignTarget || newLeadIds.length === 0) return;
    setAssigning(true);
    const resp = await fetch("/api/leads/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadIds: newLeadIds, userId: assignTarget }),
    });
    const json = await resp.json();
    setAssigning(false);
    if (!json.ok) { setError(json.error); return; }
    const name = users.find(u => u.user_id === assignTarget)?.display_name ?? "caller";
    setAssignResult({ count: newLeadIds.length, name });
  }

  // Progress bar helpers
  const totalRows = preview?.totalRows ?? pollData?.total_rows ?? 0;
  const leadsProcessed = pollData?.leads_created ?? 0;
  const progressPct = totalRows > 0 ? Math.min(100, Math.round((leadsProcessed / totalRows) * 100)) : 0;
  const elapsedSec = confirmStartRef.current ? Math.round((Date.now() - confirmStartRef.current) / 1000) : 0;

  return (
    <main className="crm-page-narrow" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ marginBottom: 4 }}>
        <h1 className="crm-page-title">Import d&rsquo;un rôle</h1>
        <p className="crm-page-sub">
          Importez un fichier XLSX du rôle d&rsquo;évaluation du Québec. Prévisualisez d&rsquo;abord, puis confirmez pour écrire en base.
        </p>
      </div>

      {/* ─── Upload form ─── */}
      {!result && !confirming && (
        <form onSubmit={onUpload} className="crm-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="crm-f-row">
            <label className="crm-f-lbl">
              Fichier XLSX <span style={{ color: "var(--crm-red)" }}>*</span>
            </label>
            <input type="file" accept=".xlsx,.xls"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              style={{ fontSize: 13 }} required />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div className="crm-f-row" style={{ marginBottom: 0 }}>
              <label className="crm-f-lbl">
                Nom de campagne <span style={{ fontSize: 10, color: "var(--crm-text3)", fontWeight: 400 }}>(recommandé — groupe les leads)</span>
              </label>
              <input type="text" value={campaignName} onChange={e => setCampaignName(e.target.value)}
                placeholder="ex. Granby rôle avril 2026"
                style={{ border: "1px solid var(--crm-card-border)", borderRadius: 8, padding: "7px 10px", fontSize: 13, background: "#fff", width: "100%" }} />
            </div>
            <div className="crm-f-row" style={{ marginBottom: 0 }}>
              <label className="crm-f-lbl">Ville <span style={{ fontSize: 10, color: "var(--crm-text3)", fontWeight: 400 }}>(indice optionnel)</span></label>
              <input type="text" value={city} onChange={e => setCity(e.target.value)}
                placeholder="ex. Granby"
                style={{ border: "1px solid var(--crm-card-border)", borderRadius: 8, padding: "7px 10px", fontSize: 13, background: "#fff", width: "100%" }} />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button type="submit" disabled={busy || !file} className="crm-btn crm-btn-dark" style={{ opacity: (busy || !file) ? 0.5 : 1 }}>
              {busy ? "Analyse en cours…" : "Analyser et prévisualiser"}
            </button>
            {preview && (
              <button type="button" onClick={() => { setPreview(null); setFile(null); setResult(null); }}
                style={{ fontSize: 13, color: "var(--crm-text3)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                Réinitialiser
              </button>
            )}
          </div>
          {error && <p style={{ fontSize: 13, color: "var(--crm-red)" }}>{error}</p>}
        </form>
      )}

      {/* ─── Preview ─── */}
      {preview && !result && !confirming && (
        <div className="crm-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--crm-text)", marginBottom: 4 }}>Prévisualisation</h2>
            <p style={{ fontSize: 12, color: "var(--crm-text3)" }}>
              Format : <code style={{ background: "var(--crm-bg-alt)", padding: "1px 5px", borderRadius: 4 }}>{preview.format}</code> · {preview.totalRows} lignes scannées
              {!campaignName && (
                <span style={{ marginLeft: 8, color: "var(--crm-amber)" }}>Aucun nom de campagne — les leads n&rsquo;auront pas de tag</span>
              )}
            </p>
          </div>

          <dl style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <StatBox label="Propriétés" value={preview.summary.properties} />
            <StatBox label="Propriétaires / leads" value={preview.summary.owners} />
            <StatBox label="Avec tél. (appelables)" value={preview.summary.phones} highlight />
            <StatBox label="Erreurs parseur" value={preview.errorsCount} negative={preview.errorsCount > 0} />
          </dl>

          {preview.summary.cities.length > 0 && (
            <p style={{ fontSize: 12, color: "var(--crm-text2)" }}>
              Villes : {preview.summary.cities.slice(0, 8).join(", ")}{preview.summary.cities.length > 8 ? "…" : ""}
            </p>
          )}

          {/* Improvement 2: Phone-less file warning */}
          {preview.warnings && preview.warnings.length > 0 && (
            <div style={{ background: "var(--crm-amber-light, #FEF9EC)", border: "1px solid var(--crm-amber)", borderRadius: 8, padding: "10px 14px" }}>
              {preview.warnings.map((w, i) => (
                <p key={i} style={{ fontSize: 13, color: "var(--crm-amber)", margin: 0 }}>⚠ {w}</p>
              ))}
            </div>
          )}

          {/* Improvement 1: Pre-import dedupe notice */}
          {preview.dedupe && (
            <div style={{ background: "var(--crm-bg-alt)", border: "1px solid var(--crm-card-border)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "var(--crm-text2)" }}>
              <strong style={{ color: "var(--crm-text)" }}>Doublons détectés :</strong>{" "}
              {preview.dedupe.properties_existing} propriété{preview.dedupe.properties_existing !== 1 ? "s" : ""} déjà dans la base ·{" "}
              {preview.dedupe.properties_new} nouvelle{preview.dedupe.properties_new !== 1 ? "s" : ""} ·{" "}
              environ <strong>{preview.dedupe.leads_would_be_created}</strong> lead{preview.dedupe.leads_would_be_created !== 1 ? "s" : ""} seraient créés.
            </div>
          )}

          {/* Preview table */}
          <div style={{ border: "1px solid var(--crm-card-border)", borderRadius: 10, overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, whiteSpace: "nowrap", borderCollapse: "collapse" }}>
              <thead style={{ background: "var(--crm-bg-alt)", color: "var(--crm-text3)", fontSize: 10, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase" }}>
                <tr>
                  <th style={{ textAlign: "left", padding: "7px 10px" }}>#</th>
                  <th style={{ textAlign: "left", padding: "7px 10px" }}>Adresse</th>
                  <th style={{ textAlign: "left", padding: "7px 10px" }}>Ville</th>
                  <th style={{ textAlign: "left", padding: "7px 10px" }}>Mat.</th>
                  <th style={{ textAlign: "left", padding: "7px 10px" }}>Log.</th>
                  <th style={{ textAlign: "left", padding: "7px 10px" }}>Const.</th>
                  <th style={{ textAlign: "left", padding: "7px 10px" }}>Éval. ($)</th>
                  <th style={{ textAlign: "left", padding: "7px 10px" }}>Propriétaires</th>
                  <th style={{ textAlign: "left", padding: "7px 10px" }}>Téléphones</th>
                </tr>
              </thead>
              <tbody>
                {preview.previewRows.map(r => (
                  <tr key={r.row} style={{ borderTop: "1px solid var(--crm-card-border)" }}
                    className="hover:bg-[var(--crm-bg-alt)]">
                    <td style={{ padding: "6px 10px", color: "var(--crm-text3)" }}>{r.row}</td>
                    <td style={{ padding: "6px 10px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }} title={r.address}>{r.address}</td>
                    <td style={{ padding: "6px 10px" }}>{r.city ?? <span style={{ color: "var(--crm-text3)" }}>—</span>}</td>
                    <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 10, color: "var(--crm-text3)" }}>
                      {r.matricule ?? <span style={{ color: "var(--crm-card-border)" }}>—</span>}
                    </td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>{r.num_units ?? <span style={{ color: "var(--crm-text3)" }}>—</span>}</td>
                    <td style={{ padding: "6px 10px" }}>{r.year_built ?? <span style={{ color: "var(--crm-text3)" }}>—</span>}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right" }}>
                      {r.evaluation_total != null
                        ? r.evaluation_total.toLocaleString("fr-CA")
                        : <span style={{ color: "var(--crm-text3)" }}>—</span>}
                    </td>
                    <td style={{ padding: "6px 10px", maxWidth: 160 }}>
                      {r.owners.length === 0
                        ? <span style={{ color: "var(--crm-text3)" }}>aucun</span>
                        : r.owners.map((o, i) => (
                          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 6 }}>
                            <span style={{
                              display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                              background: (o.kind === "company" || o.kind === "numbered_co") ? "#7C3AED" : "#2563EB"
                            }} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 100 }} title={o.company_name || o.name}>
                              {o.company_name ? o.company_name.slice(0, 18) : o.name.slice(0, 18)}
                            </span>
                          </span>
                        ))
                      }
                    </td>
                    <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 11, color: "var(--crm-green)" }}>
                      {r.owners.flatMap(o => o.phones).slice(0, 2).join(" ") || <span style={{ color: "var(--crm-text3)" }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.totalRows > 10 && (
              <p style={{ padding: "6px 10px", fontSize: 11, color: "var(--crm-text3)", background: "var(--crm-bg-alt)" }}>
                Affichage des 10 premières lignes sur {preview.totalRows}. <span>● bleu = personne  ● violet = compagnie</span>
              </p>
            )}
          </div>

          {preview.errorsCount > 0 && (
            <div>
              <button onClick={() => setErrorsOpen(o => !o)}
                style={{ fontSize: 12, color: "var(--crm-amber)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                {errorsOpen ? "▾" : "▸"} {preview.errorsCount} erreur{preview.errorsCount === 1 ? "" : "s"} de parseur (soft — les lignes s&rsquo;importent quand même avec les données disponibles)
              </button>
            </div>
          )}

          {/* Improvement 7: Auto-enrich checkbox */}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", color: "var(--crm-text2)" }}>
            <input
              type="checkbox"
              checked={autoEnrich}
              onChange={e => setAutoEnrich(e.target.checked)}
              style={{ width: 15, height: 15, cursor: "pointer" }}
            />
            Enrichissement auto après import (utilise Brave + Anthropic) — max 50 leads
          </label>

          <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
            {/* Fix B: button disabled while confirming */}
            <button
              onClick={onConfirm}
              disabled={confirming}
              className="crm-btn crm-btn-gold"
              style={{ opacity: confirming ? 0.6 : 1 }}
            >
              {confirming ? "Confirmation en cours…" : "Confirmer l'import"}
            </button>
            <button onClick={() => { setPreview(null); setFile(null); }} disabled={confirming} className="crm-btn">
              Annuler
            </button>
          </div>
          {error && <p style={{ fontSize: 13, color: "var(--crm-red)" }}>{error}</p>}
        </div>
      )}

      {/* ─── Fix A: Live progress while confirming ─── */}
      {confirming && (
        <div className="crm-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--crm-text)", margin: 0 }}>Import en cours…</h2>

          {/* Progress bar */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{
              height: 10, borderRadius: 5, background: "var(--crm-bg-alt)",
              overflow: "hidden", border: "1px solid var(--crm-card-border)"
            }}>
              <div style={{
                height: "100%",
                width: `${progressPct}%`,
                background: "linear-gradient(90deg, #059669, #10b981)",
                transition: "width 0.8s ease",
                borderRadius: 5,
              }} />
            </div>
            <p style={{ fontSize: 13, color: "var(--crm-text2)", margin: 0 }}>
              {leadsProcessed} / {totalRows} leads
              {elapsedSec > 0 && (
                <span style={{ color: "var(--crm-text3)", marginLeft: 12 }}>
                  Démarré il y a {elapsedSec} s
                </span>
              )}
            </p>
          </div>

          {pollData && (
            <p style={{ fontSize: 12, color: "var(--crm-text3)", margin: 0 }}>
              {pollData.properties_created ?? 0} propriétés
              {" · "}{pollData.contacts_created ?? 0} contacts
              {" · "}{pollData.leads_created ?? 0} leads
              {" · "}{pollData.phones_created ?? 0} téléphones
              {" · "}{pollData.errors_count ?? 0} erreurs
            </p>
          )}

          <div>
            <button
              onClick={() => {
                stopPolling();
                setConfirming(false);
              }}
              className="crm-btn"
              style={{ fontSize: 12 }}
            >
              Annuler le suivi (l&rsquo;import continue en arrière-plan)
            </button>
          </div>
          {error && <p style={{ fontSize: 13, color: "var(--crm-red)" }}>{error}</p>}
        </div>
      )}

      {/* ─── Fix C: NextStepBanner on import success ─── */}
      {result && importDoneCounts && (
        <NextStepBanner
          kind="import_done"
          importDone={importDoneCounts}
          onEnrichImport={quickEnrich}
          enrichImportBusy={enrichBusy}
        />
      )}

      {/* ─── Result details + quick assign ─── */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="crm-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 16, borderColor: "var(--crm-gold-border)", background: "var(--crm-surface)" }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--crm-green)", margin: 0 }}>Import terminé</h2>
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }} className="sm:grid-cols-4">
              <StatBox label="Propriétés créées" value={result.properties_created} />
              <StatBox label="Propriétés mises à jour" value={result.properties_updated} />
              <StatBox label="Contacts créés" value={result.contacts_created} />
              <StatBox label="Contacts mis à jour" value={result.contacts_updated} />
              <StatBox label="Téléphones (appelables)" value={result.phones_created} highlight />
              <StatBox label="Leads créés" value={result.leads_created} />
              <StatBox label="Leads mis à jour" value={result.leads_updated} />
              <StatBox label="Erreurs" value={result.errors.length} negative={result.errors.length > 0} />
            </dl>
            {result.errors.length > 0 && (
              <details style={{ fontSize: 13 }}>
                <summary style={{ cursor: "pointer", color: "var(--crm-amber)" }}>
                  {result.errors.length} erreur{result.errors.length === 1 ? "" : "s"} de ligne
                </summary>
                <ul style={{ marginTop: 8, fontSize: 11, color: "var(--crm-text2)" }}>
                  {result.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>Ligne {e.row}: {e.message}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {/* Quick assign panel */}
          {newLeadIds.length > 0 && !assignResult && (
            <div className="crm-card" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 12, borderColor: "var(--crm-gold-border)" }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--crm-text)", margin: 0 }}>Assigner les leads à un appelant</h2>
              <p style={{ fontSize: 13, color: "var(--crm-text2)" }}>
                {newLeadIds.length} leads prêts à assigner (de cette campagne).
                {result.phones_created > 0 && (
                  <> <strong>{result.phones_created}</strong> ont un numéro de téléphone et sont immédiatement appelables.</>
                )}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <select value={assignTarget} onChange={e => setAssignTarget(e.target.value)}
                  style={{ border: "1px solid var(--crm-card-border)", borderRadius: 8, padding: "7px 10px", fontSize: 13, background: "#fff", minWidth: 180 }}>
                  <option value="">Sélectionner un appelant…</option>
                  {users.map(u => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}
                </select>
                <button onClick={quickAssign} disabled={assigning || !assignTarget} className="crm-btn crm-btn-gold" style={{ opacity: (assigning || !assignTarget) ? 0.5 : 1 }}>
                  {assigning ? "Assignation…" : `Assigner ${newLeadIds.length} leads`}
                </button>
                <button onClick={() => router.push(campaignIdForResult ? `/leads?campaign_id=${campaignIdForResult}` : "/leads")}
                  style={{ fontSize: 13, color: "var(--crm-text3)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                  Passer → voir les leads
                </button>
              </div>
              {error && <p style={{ fontSize: 13, color: "var(--crm-red)" }}>{error}</p>}
            </div>
          )}

          {/* Assignment done */}
          {assignResult && (
            <div className="crm-card" style={{ padding: "20px 24px", borderColor: "var(--crm-green)" }}>
              <p style={{ fontWeight: 700, color: "var(--crm-green)", fontSize: 14 }}>
                {assignResult.count} leads assignés à {assignResult.name}
              </p>
              <p style={{ fontSize: 13, color: "var(--crm-text2)", marginTop: 4 }}>
                {assignResult.name} verra ces leads dans sa file d&rsquo;appels immédiatement.
              </p>
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => router.push(campaignIdForResult ? `/leads?campaign_id=${campaignIdForResult}` : "/leads")}
              className="crm-btn crm-btn-dark">
              Voir les leads →
            </button>
            {assignResult && (
              <button onClick={() => router.push("/calls/queue")} className="crm-btn crm-btn-gold">
                Ouvrir la file d&rsquo;appels →
              </button>
            )}
            <button onClick={() => {
              setPreview(null); setResult(null); setFile(null);
              setCampaignName(""); setCity(""); setAssignResult(null); setNewLeadIds([]);
              setImportDoneCounts(null); setPollData(null);
            }} className="crm-btn">
              Importer un autre fichier
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function StatBox({ label, value, negative = false, highlight = false }: {
  label: string; value: number; negative?: boolean; highlight?: boolean;
}) {
  return (
    <div style={{
      borderRadius: 10,
      padding: "10px 12px",
      background: highlight ? "var(--crm-gold-light)" : "var(--crm-bg-alt)",
    }}>
      <dt style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 2 }}>{label}</dt>
      <dd style={{
        fontSize: 22,
        fontWeight: 700,
        color: negative ? "var(--crm-red)" : highlight ? "var(--crm-amber)" : "var(--crm-text)",
        margin: 0,
      }}>
        {value}
      </dd>
    </div>
  );
}
