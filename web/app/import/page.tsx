"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

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
};

type Counts = {
  properties_created: number; properties_updated: number;
  contacts_created: number; contacts_updated: number;
  phones_created: number; leads_created: number; leads_updated: number;
  duplicates_seen: number; errors: { row: number; message: string }[];
};

type User = { user_id: string; display_name: string; role: string };

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

  // Post-import quick-assign state
  const [users, setUsers] = useState<User[]>([]);
  const [assignTarget, setAssignTarget] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<{ count: number; name: string } | null>(null);
  const [newLeadIds, setNewLeadIds] = useState<string[]>([]);
  const [campaignIdForResult, setCampaignIdForResult] = useState<string | null>(null);

  // Post-import enrichment state
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users").then(r => r.json()).then(j => {
      if (j.ok) setUsers(j.data.filter((u: User) => u.role === "caller" || u.role === "cold_caller"));
    });
  }, []);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null); setBusy(true); setPreview(null); setResult(null);
    setAssignResult(null); setNewLeadIds([]);

    const fd = new FormData();
    fd.append("file", file);
    if (campaignName.trim()) fd.append("campaignName", campaignName.trim());
    if (city.trim()) fd.append("city", city.trim());

    const resp = await fetch("/api/import/upload", { method: "POST", body: fd });
    const json = await resp.json();
    setBusy(false);
    if (!json.ok) { setError(json.error); return; }
    setPreview(json.data);
  }

  async function onConfirm() {
    if (!preview) return;
    setBusy(true); setError(null);
    const resp = await fetch(`/api/import/${preview.jobId}/confirm`, { method: "POST" });
    const json = await resp.json();
    setBusy(false);
    if (!json.ok) { setError(json.error); return; }
    setResult(json.data);
    setCampaignIdForResult(preview.campaignId);
    // Fetch the newly created lead IDs so we can assign them
    if (preview.campaignId) {
      const leadsResp = await fetch(`/api/leads?campaign_id=${preview.campaignId}&limit=500`);
      const leadsJson = await leadsResp.json();
      if (leadsJson.ok) {
        setNewLeadIds(leadsJson.data.leads.map((l: { lead_id: string }) => l.lead_id));
      }
    }
  }

  async function quickEnrich() {
    if (newLeadIds.length === 0) return;
    setEnrichBusy(true); setEnrichMsg(null);
    try {
      await fetch("/api/enrichment-jobs/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: newLeadIds, jobType: "find_phone", force: false }),
      });
      router.push("/leads" as never);
    } catch {
      setEnrichMsg("Erreur lors du lancement de l'enrichissement.");
    } finally {
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

  return (
    <main className="crm-page-narrow" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ marginBottom: 4 }}>
        <h1 className="crm-page-title">Import d&rsquo;un rôle</h1>
        <p className="crm-page-sub">
          Importez un fichier XLSX du rôle d&rsquo;évaluation du Québec. Prévisualisez d&rsquo;abord, puis confirmez pour écrire en base.
        </p>
      </div>

      {/* ─── Upload form ─── */}
      {!result && (
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
      {preview && !result && (
        <div className="crm-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--crm-text)", marginBottom: 4 }}>Prévisualisation</h2>
            <p style={{ fontSize: 12, color: "var(--crm-text3)" }}>
              Format : <code style={{ background: "var(--crm-bg-alt)", padding: "1px 5px", borderRadius: 4 }}>{preview.format}</code> · {preview.totalRows} lignes scannées
              {!campaignName && (
                <span style={{ marginLeft: 8, color: "var(--crm-amber)" }}>⚠ Aucun nom de campagne — les leads n&rsquo;auront pas de tag</span>
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

          <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
            <button onClick={onConfirm} disabled={busy} className="crm-btn crm-btn-gold" style={{ opacity: busy ? 0.6 : 1 }}>
              {busy ? "Import en cours…" : "Confirmer l'import"}
            </button>
            <button onClick={() => { setPreview(null); setFile(null); }} disabled={busy} className="crm-btn">
              Annuler
            </button>
          </div>
          {error && <p style={{ fontSize: 13, color: "var(--crm-red)" }}>{error}</p>}
        </div>
      )}

      {/* ─── Result + quick assign ─── */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="crm-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 16, borderColor: "var(--crm-gold-border)", background: "var(--crm-surface)" }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--crm-green)", margin: 0 }}>✓ Import terminé</h2>
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

          {/* Enrichir maintenant banner */}
          {newLeadIds.length > 0 && (
            <div className="crm-card" style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", borderColor: "var(--crm-gold-border)" }}>
              <div style={{ fontSize: 13, color: "var(--crm-text2)", flex: 1 }}>
                <strong>Import réussi · {result.leads_created} lead{result.leads_created !== 1 ? "s" : ""} créés</strong>
              </div>
              <button
                onClick={quickEnrich}
                disabled={enrichBusy}
                className="crm-btn crm-btn-dark"
                style={{ opacity: enrichBusy ? 0.6 : 1 }}
              >
                {enrichBusy ? "Lancement…" : `Enrichir maintenant les ${newLeadIds.length} leads`}
              </button>
              {enrichMsg && <span style={{ fontSize: 12, color: "var(--crm-red)" }}>{enrichMsg}</span>}
            </div>
          )}

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
                ✓ {assignResult.count} leads assignés à {assignResult.name}
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
