"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Status = "ok" | "warn" | "fail";
type Check = { id: string; label: string; status: Status; detail: string; fix?: string };
type Diag = {
  overall: "ready" | "needs_setup" | "needs_seed" | "missing_env" | "missing_migration";
  stats: { fails: number; warns: number; total: number; ok: number };
  checks: Check[];
  meta?: {
    deployedCommit: string;
    deployedAt: string;
    migrationCheckCount: number;
  };
};

type Seeder = { label: string; endpoint: string; body: Record<string, unknown>; primary?: boolean; importProof?: boolean };
const SEEDERS: Seeder[] = [
  {
    label: "▶ Import proof — 5-row Granby fixture → parser → DB → assign to Gaylord",
    endpoint: "/api/dev/seed-fixture-import",
    body: {},
    importProof: true,
  },
  { label: "Seed everything (one-shot full chain)", endpoint: "/api/dev/seed-everything", body: { city: "Granby", leadCount: 10 }, primary: true },
  { label: "Seed a fake caller user", endpoint: "/api/dev/seed-caller", body: {} },
  { label: "Seed 10 leads in Granby", endpoint: "/api/dev/seed-leads", body: { count: 10, city: "Granby" } },
  { label: "Seed a hot-seller submission", endpoint: "/api/dev/seed-submission", body: {} },
  { label: "Seed a Telegram-style proposed action", endpoint: "/api/dev/seed-proposed-action", body: {} },
];

export default function TestPanel() {
  const [diag, setDiag] = useState<Diag | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [seedOutput, setSeedOutput] = useState<{ label: string; ok: boolean; data: unknown } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await fetch("/api/diagnostics");
    const j = await r.json();
    setLoading(false);
    if (!j.ok) { setError(j.error); return; }
    setDiag(j.data);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function runSeed(s: Seeder) {
    setRunning(s.label);
    setSeedOutput(null);
    const r = await fetch(s.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s.body),
    });
    const j = await r.json();
    setRunning(null);
    setSeedOutput({ label: s.label, ok: !!j.ok, data: j });
    refresh();
  }

  if (loading && !diag) return <p className="text-sm text-zinc-500">Running diagnostics…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!diag) return null;

  // Group checks by category — only render groups that have at least one check
  const allGroups: Record<string, Check[]> = {
    Migrations: diag.checks.filter(c => c.id.startsWith("migration_")),
    Auth: diag.checks.filter(c => c.id === "admin_seeded" || c.id === "jwt_fresh"),
    Environment: diag.checks.filter(c => c.id.startsWith("env_")),
    "Seed data": diag.checks.filter(c => c.id.startsWith("seed_")),
    "Enrichment jobs": diag.checks.filter(c => c.id.startsWith("enrich_")),
    "W7 phone enrichment": diag.checks.filter(c => c.id.startsWith("w7_")),
    "Import pipeline": diag.checks.filter(c => c.id.startsWith("import_")),
    "Alpha loops": diag.checks.filter(c => c.id.startsWith("alpha_")),
  };
  const groups = Object.entries(allGroups).filter(([, checks]) => checks.length > 0);

  return (
    <div className="space-y-6">
      <OverallBanner diag={diag} onRefresh={refresh} />

      {groups.map(([title, checks]) => (
        <section key={title} className="bg-white rounded-2xl border border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-700 mb-3">
            {title}
            <span className="ml-2 text-xs font-normal text-zinc-400">{checks.length} check{checks.length !== 1 ? "s" : ""}</span>
          </h2>
          <ul className="space-y-1">
            {checks.map(c => <CheckRow key={c.id} check={c} />)}
          </ul>
        </section>
      ))}

      {/* ── Import proof seeder — top of page, prominent ── */}
      <section className="bg-blue-50 rounded-2xl border border-blue-200 p-4">
        <h2 className="text-sm font-semibold text-blue-900 mb-1">Import proof (one-click)</h2>
        <p className="text-xs text-blue-700 mb-3">
          Runs the real import pipeline end-to-end: 5-row Granby XLSX → parser → DB → assign to Gaylord caller.
          Safe to re-run (idempotent). After running, open Caller queue to confirm leads appear.
        </p>
        <ImportProofSeeder running={running} setRunning={setRunning} onDone={refresh} />
      </section>

      <section className="bg-zinc-50 rounded-2xl border border-zinc-200 p-4">
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">One-click seeders</h2>
        <p className="text-xs text-zinc-500 mb-3">
          Each seeder runs against the live database. Run &quot;Seed everything&quot; first if starting from empty.
        </p>
        <div className="space-y-2">
          {SEEDERS.filter(s => !s.importProof).map(s => (
            <div key={s.label} className={`flex items-center justify-between gap-3 rounded-lg p-3 ${s.primary ? "bg-emerald-50 border border-emerald-200" : "bg-white border border-zinc-200"}`}>
              <span className="text-sm">{s.label}</span>
              <button onClick={() => runSeed(s)} disabled={running !== null}
                className={`rounded-lg px-3 py-1.5 text-sm whitespace-nowrap disabled:opacity-50 ${s.primary ? "bg-emerald-700 hover:bg-emerald-800 text-white" : "bg-zinc-900 hover:bg-zinc-800 text-white"}`}>
                {running === s.label ? "Running…" : "Run"}
              </button>
            </div>
          ))}
        </div>
        {seedOutput && (
          <div className={`mt-3 rounded-lg p-3 text-sm border ${seedOutput.ok ? "bg-emerald-100 border-emerald-300" : "bg-red-100 border-red-300"}`}>
            <strong>{seedOutput.ok ? "✓" : "✗"} {seedOutput.label}</strong>
            <pre className="text-xs overflow-x-auto bg-white/50 rounded p-2 mt-2">{JSON.stringify(seedOutput.data, null, 2)}</pre>
          </div>
        )}
      </section>

      {/* ── W7 single-lead enrichment test ── */}
      <section className="bg-amber-50 rounded-2xl border border-amber-200 p-4">
        <h2 className="text-sm font-semibold text-amber-900 mb-1">W7 enrichment — single lead test</h2>
        <p className="text-xs text-amber-700 mb-3">
          Picks the first lead in DB with no phone number, runs the full address-first pipeline on it, and shows what was found.
          Safe: runs one lead only. Do <strong>not</strong> use this to bulk-enrich.
        </p>
        <W7EnrichmentTest />
      </section>

      <section className="bg-white rounded-2xl border border-zinc-200 p-4">
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">Verify each surface</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          <Link href="/" className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Dashboard →</Link>
          <Link href="/leads" className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Leads list →</Link>
          <Link href="/import" className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Import rôle →</Link>
          <Link href={"/calls/queue" as never} className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Caller queue →</Link>
          <Link href={"/follow-ups" as never} className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Follow-ups →</Link>
          <Link href={"/calendar" as never} className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Calendar →</Link>
          <Link href={"/review" as never} className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Review inbox → (phone candidates)</Link>
          <Link href={"/data-health" as never} className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Data health →</Link>
          <Link href={"/admin/events" as never} className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Automation events →</Link>
          <Link href={"/admin/users" as never} className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Users →</Link>
        </div>
      </section>
    </div>
  );
}

function OverallBanner({ diag, onRefresh }: { diag: Diag; onRefresh: () => void }) {
  const config: Record<Diag["overall"], { color: string; label: string; sub: string }> = {
    ready: { color: "bg-emerald-100 border-emerald-300 text-emerald-900", label: "✓ Platform ready", sub: "All checks passing." },
    needs_seed: { color: "bg-amber-50 border-amber-200 text-amber-900", label: "Needs seed data", sub: "Migrations + env are good. Run a seeder to populate test data." },
    needs_setup: { color: "bg-amber-50 border-amber-200 text-amber-900", label: "Needs setup", sub: "Some checks failing — see below." },
    missing_env: { color: "bg-red-50 border-red-200 text-red-900", label: "Missing env vars", sub: "Required environment variables not set in .env.local." },
    missing_migration: { color: "bg-red-50 border-red-200 text-red-900", label: "Missing migrations", sub: "Database schema not fully applied." },
  };
  const c = config[diag.overall];
  const commit = diag.meta?.deployedCommit ?? "unknown";
  const migCount = diag.meta?.migrationCheckCount ?? "?";
  // Expected: migration checks should cover 0001–0009 = 9 checks
  const migOk = typeof migCount === "number" && migCount >= 9;
  return (
    <div className={`rounded-2xl border p-4 ${c.color}`}>
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold">{c.label}</h2>
          <p className="text-sm">{c.sub}</p>
          <p className="text-xs mt-1 opacity-75">
            {diag.stats.ok} ok · {diag.stats.warns} warn · {diag.stats.fails} fail · {diag.stats.total} total checks
          </p>
          {/* ── Deploy version marker ── */}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-mono opacity-80">
            <span title="Git commit SHA deployed on Railway (RAILWAY_GIT_COMMIT_SHA)">
              commit: <strong>{commit.slice(0, 8)}</strong>
            </span>
            <span className={migOk ? "text-emerald-700 font-semibold" : "text-red-700 font-semibold"}>
              {migOk ? "✓" : "✗"} {migCount} migration check{migCount !== 1 ? "s" : ""} loaded
              {!migOk && " — expected ≥9 (0001–0009)"}
            </span>
            <a href="/api/diagnostics" target="_blank" rel="noopener noreferrer"
              className="underline opacity-70 hover:opacity-100">
              raw JSON ↗
            </a>
          </div>
        </div>
        <button onClick={onRefresh} className="bg-white/50 hover:bg-white rounded-lg px-3 py-1.5 text-sm font-medium">
          Re-check
        </button>
      </div>
    </div>
  );
}

function CheckRow({ check }: { check: Check }) {
  const [open, setOpen] = useState(false);
  const colors: Record<Status, string> = {
    ok: "text-emerald-700",
    warn: "text-amber-700",
    fail: "text-red-700",
  };
  const icon: Record<Status, string> = { ok: "✓", warn: "!", fail: "✗" };
  return (
    <li>
      <button onClick={() => check.fix && setOpen(o => !o)}
        disabled={!check.fix}
        className="flex w-full justify-between items-start gap-3 text-left py-1.5 hover:bg-zinc-50 rounded px-2 disabled:cursor-default">
        <div className="flex items-start gap-3 flex-1">
          <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${check.status === "ok" ? "bg-emerald-100" : check.status === "warn" ? "bg-amber-100" : "bg-red-100"} ${colors[check.status]}`}>
            {icon[check.status]}
          </span>
          <div className="flex-1">
            <div className="text-sm">{check.label}</div>
            <div className={`text-xs ${colors[check.status]}`}>{check.detail}</div>
          </div>
        </div>
        {check.fix && <span className="text-xs text-zinc-400 flex-shrink-0">{open ? "▾" : "▸"} fix</span>}
      </button>
      {open && check.fix && (
        <div className="ml-8 my-2 p-3 bg-zinc-50 rounded-lg text-xs text-zinc-700 whitespace-pre-wrap">
          {check.fix}
        </div>
      )}
    </li>
  );
}

// ─── Import proof component ────────────────────────────────────────────────
type ImportProofResult = {
  ok: boolean;
  data?: {
    jobId: string;
    counts: {
      properties_created: number; contacts_created: number;
      phones_created: number; leads_created: number; leads_updated: number;
    };
    assignedCount: number;
    caller: { email: string; displayName: string; created: boolean };
    nextSteps: { leads: string; callerQueue: string };
  };
  error?: string;
};

function ImportProofSeeder({
  running,
  setRunning,
  onDone,
}: {
  running: string | null;
  setRunning: (v: string | null) => void;
  onDone: () => void;
}) {
  const KEY = "import-proof";
  const [result, setResult] = useState<ImportProofResult | null>(null);

  async function run() {
    setRunning(KEY);
    setResult(null);
    const r = await fetch("/api/dev/seed-fixture-import", { method: "POST" });
    const j: ImportProofResult = await r.json();
    setRunning(null);
    setResult(j);
    onDone();
  }

  const busy = running !== null;

  return (
    <div className="space-y-3">
      <button
        onClick={run}
        disabled={busy}
        className="bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">
        {running === KEY ? "Running import…" : "Run import proof"}
      </button>

      {result && result.ok && result.data && (
        <div className="bg-white border border-blue-200 rounded-lg p-4 space-y-3 text-sm">
          <p className="font-semibold text-blue-900">✓ Import proof complete</p>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Pill label="Properties" value={result.data.counts.properties_created} suffix="created" />
            <Pill label="Contacts" value={result.data.counts.contacts_created} suffix="created" />
            <Pill label="Phones" value={result.data.counts.phones_created} suffix="created" />
            <Pill label="Leads" value={result.data.counts.leads_created} suffix="created" />
            <Pill label="Leads updated" value={result.data.counts.leads_updated} />
            <Pill label="Assigned to caller" value={result.data.assignedCount} />
          </div>
          <p className="text-xs text-zinc-600">
            Caller: <strong>{result.data.caller.displayName}</strong> ({result.data.caller.email})
            {result.data.caller.created && <span className="ml-1 text-blue-600">— just created</span>}
          </p>
          <div className="flex gap-2 pt-1">
            <Link href={result.data.nextSteps.leads as never}
              className="bg-zinc-900 text-white rounded px-3 py-1.5 text-xs">
              View leads →
            </Link>
            <Link href={result.data.nextSteps.callerQueue as never}
              className="border border-zinc-300 rounded px-3 py-1.5 text-xs">
              Caller queue →
            </Link>
          </div>
          <p className="text-xs text-zinc-400">Job ID: {result.data.jobId}</p>
        </div>
      )}

      {result && !result.ok && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
          ✗ {result.error ?? "Unknown error"}
        </div>
      )}
    </div>
  );
}

function Pill({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="bg-zinc-50 rounded p-2">
      <div className="text-zinc-500 text-xs">{label}</div>
      <div className="font-semibold text-zinc-900">{value}{suffix && <span className="text-zinc-400 font-normal"> {suffix}</span>}</div>
    </div>
  );
}

// ─── W7 Enrichment Test ────────────────────────────────────────────────────
type W7TestResult = {
  ok: boolean;
  error?: string;
  data?: {
    leadId: string;
    leadName: string | null;
    leadAddress: string | null;
    outcome: string;
    stageReached: string;
    candidateCount: number;
    candidates: Array<{
      phoneRaw: string;
      phoneE164: string | null;
      stage: string;
      matchedOn: string | null;
      sourceLabel: string;
      sourceUrl: string | null;
      initialConfidence: number;
      snippet: string | null;
      searchQuery: string | null;
    }>;
    message: string;
  };
};

function W7EnrichmentTest() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<W7TestResult | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    const r = await fetch("/api/dev/test-enrichment-one", { method: "POST" });
    const j: W7TestResult = await r.json();
    setRunning(false);
    setResult(j);
  }

  const outcomeColor: Record<string, string> = {
    solved: "bg-emerald-100 border-emerald-300 text-emerald-900",
    review: "bg-amber-100 border-amber-300 text-amber-900",
    openclaw_dispatched: "bg-blue-100 border-blue-300 text-blue-900",
    unresolved: "bg-zinc-100 border-zinc-300 text-zinc-700",
    skipped: "bg-zinc-50 border-zinc-200 text-zinc-600",
  };

  return (
    <div className="space-y-3">
      <button
        onClick={run}
        disabled={running}
        className="bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">
        {running ? "Running enrichment…" : "Run enrichment test (1 lead)"}
      </button>

      {result && result.ok && result.data && (
        <div className={`rounded-lg border p-4 space-y-3 text-sm ${outcomeColor[result.data.outcome] ?? "bg-white border-zinc-200"}`}>
          <div>
            <span className="font-semibold">Outcome: {result.data.outcome}</span>
            <span className="ml-2 text-xs opacity-75">stage reached: {result.data.stageReached}</span>
          </div>
          <p className="text-xs">{result.data.message}</p>
          <div className="text-xs space-y-0.5 opacity-75">
            <div>Lead ID: {result.data.leadId}</div>
            {result.data.leadName && <div>Name: {result.data.leadName}</div>}
            {result.data.leadAddress && <div>Address: {result.data.leadAddress}</div>}
          </div>
          {result.data.candidates.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold">{result.data.candidateCount} candidate(s) found:</p>
              {result.data.candidates.map((c, i) => (
                <div key={i} className="bg-white/70 rounded p-2 text-xs space-y-0.5 border border-black/10">
                  <div className="font-mono font-semibold">{c.phoneRaw}{c.phoneE164 && c.phoneE164 !== c.phoneRaw && <span className="ml-1 text-zinc-500">(→ {c.phoneE164})</span>}</div>
                  <div className="flex gap-3 flex-wrap">
                    <span>confidence: <strong>{c.initialConfidence}</strong></span>
                    <span>stage: {c.stage}</span>
                    <span>matched on: {c.matchedOn ?? "—"}</span>
                    <span>source: {c.sourceLabel}</span>
                  </div>
                  {c.searchQuery && <div className="text-zinc-500">query: "{c.searchQuery}"</div>}
                  {c.snippet && <div className="text-zinc-500 truncate">snippet: {c.snippet.slice(0, 120)}</div>}
                  {c.sourceUrl && <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Source →</a>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {result && !result.ok && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
          ✗ {result.error ?? "Unknown error"}
        </div>
      )}
    </div>
  );
}
