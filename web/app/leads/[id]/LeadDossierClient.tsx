"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";

// Grouped status lists — keep in sync with ALL_LEAD_STATUSES in /api/leads/[id]/route.ts
const STATUS_GROUPS = [
  {
    label: "Calling workflow",
    statuses: ["new", "ready_to_call", "in_outreach", "no_answer", "meeting_set", "qualified", "rejected", "do_not_contact"],
  },
  {
    label: "Enrichment pipeline",
    statuses: [
      "needs_enrichment",
      "brave_queued", "unresolved_after_brave",
      "directory_411_queued", "unresolved_after_411",
      "places_queued", "unresolved_after_places",
      "openclaw_queued", "needs_human_review", "no_contact_found",
    ],
  },
  {
    label: "Legacy / misc",
    statuses: ["enriching"],
  },
] as const;

const ALL_STATUSES = STATUS_GROUPS.flatMap(g => g.statuses);

type User = { user_id: string; display_name: string | null; role: string };
type EnrichJob = { id: string; job_type: string; status: string; started_at: string | null; completed_at: string | null; error_message: string | null; created_at: string };
type EnrichResult = { id: string; kind: string; value: string; source: string; source_url: string | null; confidence: number; evidence: string | null; status: string; created_at: string; found_in_job_id: string | null };

const JOB_TYPES = ["find_phone", "verify_phone", "find_email", "find_website", "owner_identity", "property_context", "general_research"] as const;

export default function LeadDossierClient({
  leadId, initialNotes, initialStatus, initialPriority, initialAssignedTo, users, canEdit,
  initialEnrichmentJobs = [], initialEnrichmentResults = [],
}: {
  leadId: string;
  initialNotes: string;
  initialStatus: string;
  initialPriority: number;
  initialAssignedTo: string | null;
  users: User[];
  canEdit: boolean;
  initialEnrichmentJobs?: EnrichJob[];
  initialEnrichmentResults?: EnrichResult[];
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [status, setStatus] = useState(initialStatus);
  const [priority, setPriority] = useState(initialPriority);
  const [assignedTo, setAssignedTo] = useState<string | null>(initialAssignedTo);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  // Follow-up quick-add
  const [fuOpen, setFuOpen] = useState(false);
  const [fuDate, setFuDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [fuNote, setFuNote] = useState("");

  async function patch(body: Record<string, unknown>, label: string) {
    setBusy(label); setError(null);
    const r = await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    setBusy(null);
    if (!j.ok) { setError(j.error); return false; }
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1500);
    router.refresh();
    return true;
  }

  async function createFollowUp() {
    if (!fuNote.trim()) { setError("Follow-up note required"); return; }
    setBusy("fu"); setError(null);
    const r = await fetch("/api/follow-ups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadId,
        dueAt: new Date(fuDate).toISOString(),
        note: fuNote,
        priority: 70,
        source: "web_app",
      }),
    });
    const j = await r.json();
    setBusy(null);
    if (!j.ok) { setError(j.error); return; }
    setFuOpen(false);
    setFuNote("");
    router.refresh();
  }

  if (!canEdit) {
    return (
      <section className="crm-card" style={{ padding: 16, fontSize: 13 }}>
        <p style={{ color: "var(--crm-text3)" }}>Lecture seule — actions admin désactivées.</p>
      </section>
    );
  }

  const inputStyle: React.CSSProperties = {
    border: "1px solid var(--crm-card-border)",
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 13,
    background: "#fff",
    width: "100%",
  };

  return (
    <section className="crm-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "var(--crm-text3)", margin: 0 }}>Actions</h2>
        {savedTick && <span style={{ fontSize: 11, color: "var(--crm-green)" }}>enregistré ✓</span>}
        {error && <span style={{ fontSize: 11, color: "var(--crm-red)" }}>{error}</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <Field label="Statut">
          <select
            value={status}
            onChange={e => { setStatus(e.target.value); patch({ status: e.target.value }, "status"); }}
            disabled={busy !== null}
            style={inputStyle}>
            {!ALL_STATUSES.includes(status as typeof ALL_STATUSES[number]) && (
              <option value={status}>{status} (actuel)</option>
            )}
            {STATUS_GROUPS.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.statuses.map(s => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label={`Priorité (${priority})`}>
          <input
            type="range" min={0} max={100} value={priority}
            onChange={e => setPriority(parseInt(e.target.value, 10))}
            onMouseUp={() => patch({ priority }, "priority")}
            onTouchEnd={() => patch({ priority }, "priority")}
            disabled={busy !== null}
            style={{ width: "100%", accentColor: "var(--crm-gold)" }} />
        </Field>
        <Field label="Assigné à">
          <select
            value={assignedTo ?? ""}
            onChange={e => {
              const v = e.target.value || null;
              setAssignedTo(v);
              patch({ assignedToUserId: v }, "assignment");
            }}
            disabled={busy !== null}
            style={inputStyle}>
            <option value="">— non assigné —</option>
            {users.map(u => <option key={u.user_id} value={u.user_id}>{u.display_name} ({u.role})</option>)}
          </select>
        </Field>
      </div>

      <Field label="Notes sur le lead">
        <textarea
          value={notes} onChange={e => setNotes(e.target.value)}
          onBlur={() => notes !== initialNotes && patch({ notes }, "notes")}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
          placeholder="Contexte, stratégie, points à retenir sur ce lead." />
      </Field>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button onClick={() => setFuOpen(o => !o)} className="crm-btn">
          {fuOpen ? "× Annuler" : "+ Suivi"}
        </button>
        <button onClick={() => patch({ status: "qualified" }, "qualify")}
          disabled={busy !== null}
          className="crm-btn crm-btn-gold" style={{ opacity: busy !== null ? 0.5 : 1 }}>
          Marquer qualifié
        </button>
        <button onClick={() => patch({ status: "rejected" }, "reject")}
          disabled={busy !== null}
          className="crm-btn crm-btn-dark" style={{ opacity: busy !== null ? 0.5 : 1 }}>
          Mort
        </button>
        <button onClick={() => patch({ status: "do_not_contact" }, "dnc")}
          disabled={busy !== null}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            border: "1px solid var(--crm-red)", background: "var(--crm-red-light)",
            color: "var(--crm-red)", padding: "7px 12px", borderRadius: 10,
            fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: busy !== null ? 0.5 : 1,
          }}>
          Ne pas contacter
        </button>
      </div>

      {fuOpen && (
        <div style={{ background: "var(--crm-bg-alt)", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Échéance">
              <input type="datetime-local" value={fuDate} onChange={e => setFuDate(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Note">
              <input value={fuNote} onChange={e => setFuNote(e.target.value)} style={inputStyle}
                placeholder="Quoi faire à ce moment-là" />
            </Field>
          </div>
          <button onClick={createFollowUp} disabled={busy === "fu"} className="crm-btn crm-btn-dark"
            style={{ alignSelf: "flex-start", opacity: busy === "fu" ? 0.5 : 1 }}>
            {busy === "fu" ? "Création…" : "Créer le suivi"}
          </button>
        </div>
      )}

      <EnrichmentSection
        leadId={leadId}
        initialJobs={initialEnrichmentJobs}
        initialResults={initialEnrichmentResults}
      />
    </section>
  );
}

function EnrichmentSection({
  leadId, initialJobs, initialResults,
}: { leadId: string; initialJobs: EnrichJob[]; initialResults: EnrichResult[] }) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [results, setResults] = useState(initialResults);
  const [showJobMenu, setShowJobMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function sendJob(jobType: string) {
    setBusy("send"); setMsg(null);
    const r = await fetch("/api/enrichment-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, jobType }),
    });
    const j = await r.json();
    setBusy(null); setShowJobMenu(false);
    if (!j.ok) { setMsg(`✗ ${j.error}`); return; }
    setMsg(`✓ Job created (${jobType}). ${j.data.message}`);
    // Refresh jobs list optimistically
    setJobs([{ id: j.data.jobId, job_type: jobType, status: j.data.webhookCalled ? "running" : "pending", started_at: null, completed_at: null, error_message: null, created_at: new Date().toISOString() }, ...jobs]);
    router.refresh();
  }

  async function reviewResult(id: string, action: "approve" | "reject") {
    setBusy(id); setMsg(null);
    const r = await fetch(`/api/enrichment-results/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const j = await r.json();
    setBusy(null);
    if (!j.ok) { setMsg(`✗ ${j.error}`); return; }
    setResults(results.map(r => r.id === id ? { ...r, status: action === "approve" ? "verified" : "invalid" } : r));
    router.refresh();
  }

  const pending = results.filter(r => r.status === "unverified");
  const reviewed = results.filter(r => r.status !== "unverified");

  return (
    <div style={{ borderTop: "1px solid var(--crm-card-border)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "var(--crm-text3)", margin: 0 }}>Enrichissement</h3>
        <div style={{ position: "relative" }}>
          <button onClick={() => setShowJobMenu(s => !s)} disabled={busy === "send"}
            className="crm-btn" style={{ opacity: busy === "send" ? 0.5 : 1, background: "var(--crm-blue-light)", color: "var(--crm-blue)", borderColor: "var(--crm-blue-light)" }}>
            {busy === "send" ? "Envoi…" : "Envoyer à l'enrichissement"}
          </button>
          {showJobMenu && (
            <div style={{
              position: "absolute", right: 0, marginTop: 4, background: "#fff",
              border: "1px solid var(--crm-card-border)", borderRadius: 10,
              boxShadow: "0 6px 20px rgba(0,0,0,.08)", padding: "4px 0", zIndex: 10, minWidth: 180,
            }}>
              {JOB_TYPES.map(jt => (
                <button key={jt} onClick={() => sendJob(jt)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", fontSize: 13, color: "var(--crm-text2)", background: "none", border: "none", cursor: "pointer" }}
                  className="hover:bg-[var(--crm-bg)]">
                  {jt.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {msg && <p style={{ fontSize: 11, color: "var(--crm-text2)" }}>{msg}</p>}

      {jobs.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 6 }}>Jobs récents</div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {jobs.slice(0, 5).map(j => (
              <li key={j.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ fontFamily: "monospace", color: "var(--crm-text2)" }}>{j.job_type}</span>
                <span style={{ color: j.status === "failed" ? "var(--crm-red)" : j.status === "completed" ? "var(--crm-green)" : "var(--crm-text3)" }}>
                  {j.status}{j.error_message ? ` · ${j.error_message}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-amber)", marginBottom: 6 }}>En attente de revue ({pending.length})</div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {pending.map(r => (
              <li key={r.id} style={{ background: "var(--crm-amber-light)", border: "1px solid var(--crm-gold-border)", borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", background: "var(--crm-gold-light)", color: "var(--crm-amber)", borderRadius: 4, padding: "2px 6px", marginRight: 6 }}>{r.kind}</span>
                      <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{r.value}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--crm-text2)", marginTop: 4 }}>
                      {r.source}{r.confidence ? ` · conf ${r.confidence}` : ""}
                      {r.source_url && <> · <a href={r.source_url} target="_blank" rel="noreferrer" style={{ color: "var(--crm-blue)", textDecoration: "none" }}>source</a></>}
                    </div>
                    {r.evidence && <div style={{ fontSize: 11, color: "var(--crm-text3)", marginTop: 2 }}>{r.evidence}</div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <button onClick={() => reviewResult(r.id, "approve")} disabled={busy === r.id}
                      className="crm-btn crm-btn-gold" style={{ fontSize: 11, padding: "4px 10px", opacity: busy === r.id ? 0.5 : 1 }}>
                      {busy === r.id ? "…" : "✓ Approuver"}
                    </button>
                    <button onClick={() => reviewResult(r.id, "reject")} disabled={busy === r.id}
                      className="crm-btn" style={{ fontSize: 11, padding: "4px 10px", opacity: busy === r.id ? 0.5 : 1 }}>
                      Rejeter
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reviewed.length > 0 && (
        <details style={{ fontSize: 11 }}>
          <summary style={{ cursor: "pointer", color: "var(--crm-text3)" }}>Résultats révisés ({reviewed.length})</summary>
          <ul style={{ marginTop: 8, listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {reviewed.map(r => (
              <li key={r.id} style={{ display: "flex", justifyContent: "space-between", color: "var(--crm-text2)" }}>
                <span><span style={{ color: "var(--crm-text3)" }}>{r.kind}:</span> <span style={{ fontFamily: "monospace" }}>{r.value}</span></span>
                <span>{r.status}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {jobs.length === 0 && results.length === 0 && (
        <p style={{ fontSize: 11, color: "var(--crm-text3)" }}>Aucune activité d&rsquo;enrichissement pour ce lead.</p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}
