"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Job = {
  id: string; lead_id: string | null; contact_id: string | null;
  job_type: string; workflow_id: string; workflow_run_id: string | null;
  status: string; attempts: number;
  started_at: string | null; completed_at: string | null;
  error_message: string | null; raw_output: unknown | null; cost_usd: number | null;
  created_at: string;
};

function summarizeRawOutput(raw: unknown): string {
  if (raw == null || typeof raw !== "object") return "";
  const r = raw as Record<string, unknown>;
  // OpenClaw callback shape: { candidates: number, reasoning_summary: string }
  if (typeof r.candidates === "number") {
    const n = r.candidates;
    const reason = typeof r.reasoning_summary === "string" ? r.reasoning_summary : "";
    return n === 0
      ? `0 candidates — ${reason || "no phones found"}`
      : `${n} candidate${n === 1 ? "" : "s"}${reason ? ` — ${reason}` : ""}`;
  }
  if (typeof r.results_count === "number") {
    const n = r.results_count;
    const kind = typeof r.result_type === "string" ? r.result_type : "result";
    const reason = typeof r.reasoning_summary === "string" ? r.reasoning_summary : "";
    return n === 0
      ? `0 ${kind} results${reason ? ` — ${reason}` : ""}`
      : `${n} ${kind} result${n === 1 ? "" : "s"}${reason ? ` — ${reason}` : ""}`;
  }
  // /api/n8n/lead-status shape: { outcome, lead_status, summary }
  if (typeof r.summary === "string") {
    const tag = typeof r.outcome === "string" ? `[${r.outcome}] ` : "";
    return `${tag}${r.summary}`;
  }
  // Fallback: short JSON peek
  try {
    const s = JSON.stringify(r);
    return s.length > 80 ? s.slice(0, 77) + "…" : s;
  } catch { return ""; }
}
type Result = {
  id: string; lead_id: string | null; contact_id: string | null;
  kind: string; value: string; source: string; source_url: string | null;
  confidence: number; evidence: string | null; status: string; created_at: string;
};

const STATUSES = ["", "pending", "running", "processing", "success", "failed", "skipped", "cancelled"] as const;
const JOB_TYPES = ["", "find_phone", "verify_phone", "find_email", "find_website", "owner_identity", "property_context", "general_research"] as const;

export default function EnrichmentDashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    const [jobsRes, resultsRes] = await Promise.all([
      fetch(`/api/enrichment-jobs?${params}`),
      fetch(`/api/enrichment-results?status=unverified`),
    ]);
    const jobsJ = await jobsRes.json();
    const resultsJ = await resultsRes.json();
    setLoading(false);
    if (!jobsJ.ok) { setError(jobsJ.error); return; }
    let j = (jobsJ.data ?? []) as Job[];
    if (typeFilter) j = j.filter(x => x.job_type === typeFilter);
    setJobs(j);
    setResults((resultsJ.data ?? []) as Result[]);
  }, [statusFilter, typeFilter]);

  useEffect(() => { refresh(); }, [refresh]);

  async function action(jobId: string, kind: "retry" | "cancel") {
    setBusy(jobId); setMsg(null); setError(null);
    const r = await fetch(`/api/enrichment-jobs/${jobId}/${kind}`, { method: "POST" });
    const j = await r.json();
    setBusy(null);
    if (!j.ok) { setError(j.error); return; }
    setMsg(`${kind} → ${jobId.slice(0, 8)}…`);
    refresh();
  }

  async function runWatchdog(minutes: number) {
    setBusy("watchdog"); setMsg(null); setError(null);
    const r = await fetch(`/api/enrichment/watchdog?minutes=${minutes}`, { method: "POST" });
    const j = await r.json();
    setBusy(null);
    if (!j.ok) { setError(j.error); return; }
    const n = j.data?.timed_out ?? 0;
    setMsg(n > 0
      ? `Watchdog: marked ${n} stuck OpenClaw job${n === 1 ? "" : "s"} failed (no_callback_timeout)`
      : `Watchdog: no stuck OpenClaw jobs older than ${minutes} min`);
    refresh();
  }

  async function bulkRerun(maxConfidence: number) {
    setBusy("bulk-rerun"); setMsg(null); setError(null);
    const r = await fetch("/api/enrichment/bulk-rerun", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxConfidence }),
    });
    const j = await r.json();
    setBusy(null);
    if (!j.ok) { setError(j.error ?? "Bulk re-run failed"); return; }
    const d = j.data;
    if (d.queued === 0) {
      setMsg(`Bulk re-run: no leads found below ${maxConfidence}% confidence.`);
    } else {
      setMsg(
        `Bulk re-run: ${d.queued} leads queued in background` +
        ` (${d.breakdown?.lowConfidenceReview ?? 0} low-conf + ${d.breakdown?.unresolvedOpenClaw ?? 0} unresolved).` +
        ` Check phone-review in a few minutes.`
      );
    }
  }

  async function reviewResult(id: string, action: "approve" | "reject") {
    setBusy(id); setError(null);
    const r = await fetch(`/api/enrichment-results/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const j = await r.json();
    setBusy(null);
    if (!j.ok) { setError(j.error); return; }
    refresh();
  }

  const counts = {
    pending: jobs.filter(j => j.status === "pending").length,
    running: jobs.filter(j => j.status === "running").length,
    success: jobs.filter(j => j.status === "success").length,
    failed: jobs.filter(j => j.status === "failed").length,
    cancelled: jobs.filter(j => j.status === "cancelled").length,
  };

  // Stuck heuristic:
  //   pending    > 30 min  → never picked up by n8n
  //   running    > 60 min  → n8n picked up but no callback
  //   processing > 60 min  → force-openclaw dispatched, n8n never called back
  const now = Date.now();
  const stuckJobs = jobs.filter(j => {
    if (j.status === "pending") {
      return now - new Date(j.created_at).getTime() > 30 * 60_000;
    }
    if ((j.status === "running" || j.status === "processing") && j.started_at) {
      return now - new Date(j.started_at).getTime() > 60 * 60_000;
    }
    return false;
  });

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Tile label="Pending" n={counts.pending} highlight={counts.pending > 0} />
        <Tile label="Running" n={counts.running} />
        <Tile label="Success" n={counts.success} />
        <Tile label="Failed" n={counts.failed} highlight={counts.failed > 0} negative />
        <Tile label="Cancelled" n={counts.cancelled} />
      </section>

      {stuckJobs.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <h2 className="text-sm font-semibold text-amber-900">Stuck jobs ({stuckJobs.length})</h2>
              <p className="text-xs text-amber-800 mt-1">
                Pending {">"} 30 min OR processing {">"} 60 min. Likely the n8n workflow didn&rsquo;t pick up the trigger or crashed without reporting back.
              </p>
            </div>
            <button
              onClick={() => runWatchdog(10)}
              disabled={busy === "watchdog"}
              className="text-xs bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded px-2 py-1 whitespace-nowrap">
              {busy === "watchdog" ? "Running…" : "Mark stale OpenClaw jobs failed (>10 min)"}
            </button>
          </div>
          <ul className="text-sm space-y-1">
            {stuckJobs.map(j => (
              <li key={j.id} className="flex justify-between">
                <span><code className="font-mono text-xs">{j.id.slice(0, 8)}…</code> {j.job_type} · <span className="text-zinc-600">{j.workflow_id}</span></span>
                <span className="text-xs">{j.status} since {new Date(j.started_at ?? j.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Bulk re-run panel ── */}
      <section className="bg-white rounded-2xl border border-zinc-200 p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-zinc-800">Re-run low-confidence leads</h2>
            <p className="text-xs text-zinc-500 mt-1 max-w-lg">
              Finds leads in <em>needs_phone_review</em> where all candidates are below the confidence threshold,
              plus all <em>unresolved_after_openclaw</em> leads. Clears their weak candidates and
              re-runs the improved enrichment pipeline in the background. The queue will update in a few minutes.
            </p>
          </div>
          <div className="flex gap-2 items-center flex-shrink-0">
            <button
              onClick={() => bulkRerun(60)}
              disabled={busy === "bulk-rerun"}
              className="text-sm bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2 whitespace-nowrap"
            >
              {busy === "bulk-rerun" ? "Queueing…" : "Re-run all below 60%"}
            </button>
            <button
              onClick={() => bulkRerun(80)}
              disabled={busy === "bulk-rerun"}
              className="text-sm bg-zinc-700 hover:bg-zinc-800 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2 whitespace-nowrap"
            >
              {busy === "bulk-rerun" ? "Queueing…" : "Re-run all below 80%"}
            </button>
          </div>
        </div>
        {msg && msg.startsWith("Bulk re-run") && (
          <p className="text-sm text-emerald-700 mt-3 border-t border-zinc-100 pt-3">{msg}</p>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-zinc-200 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-zinc-700">Pending results awaiting review ({results.length})</h2>
        </div>
        {results.length === 0 ? (
          <p className="text-sm text-zinc-400">Nothing to review.</p>
        ) : (
          <ul className="space-y-2">
            {results.map(r => (
              <li key={r.id} className="bg-amber-50 border border-amber-200 rounded p-3">
                <div className="flex justify-between items-start gap-3">
                  <div className="flex-1">
                    <div className="text-sm">
                      <span className="text-xs uppercase tracking-wide rounded px-1 py-0.5 bg-amber-200 text-amber-900 mr-2">{r.kind}</span>
                      <span className="font-mono">{r.value}</span>
                    </div>
                    <div className="text-xs text-zinc-600 mt-1">
                      {r.source} · conf {r.confidence}
                      {r.source_url && <> · <a href={r.source_url} target="_blank" rel="noreferrer" className="underline">source</a></>}
                      {r.lead_id && <> · <Link href={`/leads/${r.lead_id}` as never} className="underline">lead →</Link></>}
                    </div>
                    {r.evidence && <div className="text-xs text-zinc-500 mt-1">{r.evidence}</div>}
                  </div>
                  <div className="flex flex-col gap-1">
                    <button onClick={() => reviewResult(r.id, "approve")} disabled={busy === r.id}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded px-2 py-1 disabled:opacity-50">
                      {busy === r.id ? "…" : "Approve"}
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
        )}
      </section>

      <section className="bg-white rounded-2xl border border-zinc-200 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-zinc-700">Jobs ({jobs.length})</h2>
          <div className="flex gap-2">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="border border-zinc-300 rounded-lg px-2 py-1 text-sm">
              {STATUSES.map(s => <option key={s} value={s}>{s || "all statuses"}</option>)}
            </select>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
              className="border border-zinc-300 rounded-lg px-2 py-1 text-sm">
              {JOB_TYPES.map(t => <option key={t} value={t}>{t || "all types"}</option>)}
            </select>
            <button onClick={refresh} className="bg-zinc-100 hover:bg-zinc-200 rounded-lg px-3 py-1 text-sm">Refresh</button>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-600 text-xs">
              <tr>
                <th className="text-left p-2">Job</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Lead</th>
                <th className="text-left p-2">Created</th>
                <th className="text-left p-2">Result / Error</th>
                <th className="text-left p-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="p-4 text-center text-zinc-400">Loading…</td></tr>}
              {!loading && jobs.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-zinc-400">No jobs match the filters.</td></tr>}
              {jobs.map(j => (
                <tr key={j.id} className="border-t border-zinc-100">
                  <td className="p-2 font-mono text-xs">{j.id.slice(0, 8)}…{j.attempts > 1 && <> · attempt {j.attempts}</>}</td>
                  <td className="p-2 text-xs">{j.job_type}</td>
                  <td className="p-2"><JobStatusPill s={j.status} /></td>
                  <td className="p-2">
                    {j.lead_id ? (
                      <span className="flex gap-2">
                        <Link href={`/leads/${j.lead_id}` as never} className="underline text-xs">lead →</Link>
                        <Link href={`/admin/enrichment/${j.lead_id}` as never} className="underline text-xs text-amber-700">details →</Link>
                      </span>
                    ) : "—"}
                  </td>
                  <td className="p-2 text-xs text-zinc-500">{new Date(j.created_at).toLocaleString()}</td>
                  <td className="p-2 text-xs max-w-xs truncate" title={j.error_message ?? summarizeRawOutput(j.raw_output)}>
                    {j.error_message
                      ? <span className="text-red-700">{j.error_message}</span>
                      : <span className="text-zinc-600">{summarizeRawOutput(j.raw_output)}</span>}
                  </td>
                  <td className="p-2 text-right">
                    {(j.status === "failed" || j.status === "cancelled" || j.status === "success") && (
                      <button onClick={() => action(j.id, "retry")} disabled={busy === j.id}
                        className="text-xs underline text-zinc-700 mr-2 disabled:opacity-50">Retry</button>
                    )}
                    {(j.status === "pending" || j.status === "running" || j.status === "processing") && (
                      <button onClick={() => action(j.id, "cancel")} disabled={busy === j.id}
                        className="text-xs underline text-red-700 disabled:opacity-50">Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Tile({ label, n, highlight, negative }: { label: string; n: number; highlight?: boolean; negative?: boolean }) {
  const cls = negative && highlight ? "bg-red-50 border-red-200 text-red-900"
    : highlight ? "bg-amber-50 border-amber-200 text-amber-900"
    : "bg-white border-zinc-200 text-zinc-900";
  return (
    <div className={`rounded-2xl border p-3 ${cls}`}>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{n}</div>
    </div>
  );
}

function JobStatusPill({ s }: { s: string }) {
  const c: Record<string, string> = {
    pending:    "bg-blue-100 text-blue-800",
    running:    "bg-amber-100 text-amber-800",
    processing: "bg-purple-100 text-purple-800",
    success:    "bg-emerald-100 text-emerald-800",
    completed:  "bg-emerald-100 text-emerald-800",
    failed:     "bg-red-100 text-red-800",
    cancelled:  "bg-zinc-200 text-zinc-700",
    skipped:    "bg-zinc-100 text-zinc-500",
  };
  return <span className={`text-xs uppercase tracking-wide rounded px-1.5 py-0.5 ${c[s] ?? "bg-zinc-100"}`}>{s}</span>;
}
