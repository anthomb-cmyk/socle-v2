"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = ["new", "enriching", "ready_to_call", "in_outreach", "meeting_set", "qualified", "no_answer", "rejected", "do_not_contact"] as const;

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
      <section className="bg-white rounded-2xl border border-zinc-200 p-4 text-sm">
        <p className="text-zinc-500">Read-only — admin actions disabled.</p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-2xl border border-zinc-200 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-700">Actions</h2>
        {savedTick && <span className="text-xs text-emerald-700">saved ✓</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Status">
          <select
            value={status}
            onChange={e => { setStatus(e.target.value); patch({ status: e.target.value }, "status"); }}
            disabled={busy !== null}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm">
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label={`Priority (${priority})`}>
          <input
            type="range" min={0} max={100} value={priority}
            onChange={e => setPriority(parseInt(e.target.value, 10))}
            onMouseUp={() => patch({ priority }, "priority")}
            onTouchEnd={() => patch({ priority }, "priority")}
            disabled={busy !== null}
            className="w-full" />
        </Field>
        <Field label="Assigned to">
          <select
            value={assignedTo ?? ""}
            onChange={e => {
              const v = e.target.value || null;
              setAssignedTo(v);
              patch({ assignedToUserId: v }, "assignment");
            }}
            disabled={busy !== null}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm">
            <option value="">— unassigned —</option>
            {users.map(u => <option key={u.user_id} value={u.user_id}>{u.display_name} ({u.role})</option>)}
          </select>
        </Field>
      </div>

      <Field label="Lead notes">
        <textarea
          value={notes} onChange={e => setNotes(e.target.value)}
          onBlur={() => notes !== initialNotes && patch({ notes }, "notes")}
          rows={3}
          className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
          placeholder="Anthony's notes on this lead — context, strategy, things to remember." />
      </Field>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFuOpen(o => !o)}
          className="bg-zinc-100 hover:bg-zinc-200 rounded-lg px-3 py-1.5 text-sm">
          {fuOpen ? "× Cancel" : "+ Follow-up"}
        </button>
        <button onClick={() => patch({ status: "qualified" }, "qualify")}
          disabled={busy !== null}
          className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-1.5 text-sm">
          Mark qualified
        </button>
        <button onClick={() => patch({ status: "rejected" }, "reject")}
          disabled={busy !== null}
          className="bg-zinc-700 hover:bg-zinc-800 text-white rounded-lg px-3 py-1.5 text-sm">
          Mark dead
        </button>
        <button onClick={() => patch({ status: "do_not_contact" }, "dnc")}
          disabled={busy !== null}
          className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-1.5 text-sm">
          Do not contact
        </button>
      </div>

      {fuOpen && (
        <div className="bg-zinc-50 rounded-lg p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Due">
              <input type="datetime-local" value={fuDate} onChange={e => setFuDate(e.target.value)}
                className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm" />
            </Field>
            <Field label="Note">
              <input value={fuNote} onChange={e => setFuNote(e.target.value)}
                className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
                placeholder="What to do at that time" />
            </Field>
          </div>
          <button onClick={createFollowUp} disabled={busy === "fu"}
            className="bg-zinc-900 text-white rounded-lg px-3 py-1.5 text-sm">
            {busy === "fu" ? "Creating…" : "Create follow-up"}
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
    <div className="border-t border-zinc-200 pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-700">Enrichment</h3>
        <div className="relative">
          <button onClick={() => setShowJobMenu(s => !s)} disabled={busy === "send"}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 text-sm">
            {busy === "send" ? "Sending…" : "Send to enrichment"}
          </button>
          {showJobMenu && (
            <div className="absolute right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg p-1 z-10 min-w-48">
              {JOB_TYPES.map(jt => (
                <button key={jt} onClick={() => sendJob(jt)}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 rounded">
                  {jt.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {msg && <p className="text-xs text-zinc-700">{msg}</p>}

      {jobs.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Recent jobs</div>
          <ul className="text-xs space-y-1">
            {jobs.slice(0, 5).map(j => (
              <li key={j.id} className="flex justify-between">
                <span className="font-mono">{j.job_type}</span>
                <span className={j.status === "failed" ? "text-red-600" : j.status === "success" ? "text-emerald-700" : "text-zinc-500"}>
                  {j.status}{j.error_message ? ` · ${j.error_message}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wide text-amber-700 mb-1">Pending review ({pending.length})</div>
          <ul className="space-y-2">
            {pending.map(r => (
              <li key={r.id} className="bg-amber-50 border border-amber-200 rounded p-3">
                <div className="flex justify-between items-start gap-3">
                  <div className="flex-1">
                    <div className="text-sm">
                      <span className="text-xs uppercase tracking-wide rounded px-1 py-0.5 bg-amber-200 text-amber-900 mr-2">{r.kind}</span>
                      <span className="font-mono">{r.value}</span>
                    </div>
                    <div className="text-xs text-zinc-600 mt-1">
                      {r.source}{r.confidence ? ` · conf ${r.confidence}` : ""}
                      {r.source_url && <> · <a href={r.source_url} target="_blank" rel="noreferrer" className="underline">source</a></>}
                    </div>
                    {r.evidence && <div className="text-xs text-zinc-500 mt-1">{r.evidence}</div>}
                  </div>
                  <div className="flex flex-col gap-1">
                    <button onClick={() => reviewResult(r.id, "approve")} disabled={busy === r.id}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded px-2 py-1 disabled:opacity-50">
                      {busy === r.id ? "…" : "✓ Approve"}
                    </button>
                    <button onClick={() => reviewResult(r.id, "reject")} disabled={busy === r.id}
                      className="border border-zinc-300 hover:bg-zinc-100 text-xs rounded px-2 py-1 disabled:opacity-50">
                      Reject
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reviewed.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-500">Reviewed results ({reviewed.length})</summary>
          <ul className="mt-2 space-y-1">
            {reviewed.map(r => (
              <li key={r.id} className="flex justify-between text-zinc-600">
                <span><span className="text-zinc-400">{r.kind}:</span> <span className="font-mono">{r.value}</span></span>
                <span>{r.status}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {jobs.length === 0 && results.length === 0 && (
        <p className="text-xs text-zinc-400">No enrichment activity yet for this lead.</p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
