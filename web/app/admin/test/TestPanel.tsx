"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Status = "ok" | "warn" | "fail";
type Check = { id: string; label: string; status: Status; detail: string; fix?: string };
type Diag = {
  overall: "ready" | "needs_setup" | "needs_seed" | "missing_env" | "missing_migration";
  stats: { fails: number; warns: number; total: number; ok: number };
  checks: Check[];
};

type Seeder = { label: string; endpoint: string; body: Record<string, unknown>; primary?: boolean };
const SEEDERS: Seeder[] = [
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

  // Group checks by category
  const groups = {
    Migrations: diag.checks.filter(c => c.id.startsWith("migration_")),
    Auth: diag.checks.filter(c => c.id === "admin_seeded" || c.id === "jwt_fresh"),
    Environment: diag.checks.filter(c => c.id.startsWith("env_")),
    "Seed data": diag.checks.filter(c => c.id.startsWith("seed_")),
    Enrichment: diag.checks.filter(c => c.id.startsWith("enrich_")),
  };

  return (
    <div className="space-y-6">
      <OverallBanner diag={diag} onRefresh={refresh} />

      {Object.entries(groups).map(([title, checks]) => (
        <section key={title} className="bg-white rounded-2xl border border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-700 mb-3">{title}</h2>
          <ul className="space-y-1">
            {checks.map(c => <CheckRow key={c.id} check={c} />)}
          </ul>
        </section>
      ))}

      <section className="bg-zinc-50 rounded-2xl border border-zinc-200 p-4">
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">One-click seeders</h2>
        <p className="text-xs text-zinc-500 mb-3">
          Each seeder runs against the live database. Run &quot;Seed everything&quot; first if starting from empty.
        </p>
        <div className="space-y-2">
          {SEEDERS.map(s => (
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

      <section className="bg-white rounded-2xl border border-zinc-200 p-4">
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">Verify each surface</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
          <Link href="/" className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Dashboard →</Link>
          <Link href="/leads" className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Leads list →</Link>
          <Link href={"/calls/queue" as never} className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Caller queue →</Link>
          <Link href={"/follow-ups" as never} className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Follow-ups →</Link>
          <Link href={"/calendar" as never} className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Calendar →</Link>
          <Link href={"/review" as never} className="border border-zinc-200 rounded p-2 hover:bg-zinc-50">Review inbox →</Link>
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
  return (
    <div className={`rounded-2xl border p-4 ${c.color}`}>
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold">{c.label}</h2>
          <p className="text-sm">{c.sub}</p>
          <p className="text-xs mt-1 opacity-75">
            {diag.stats.ok} ok · {diag.stats.warns} warn · {diag.stats.fails} fail · {diag.stats.total} total checks
          </p>
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
