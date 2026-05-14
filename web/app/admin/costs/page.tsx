import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import { formatCostUsd } from "@/lib/llm/pricing";
import {
  rangeToSince,
  rangeToDays,
  fetchTopStats,
  fetchFeatureBreakdown,
  fetchModelBreakdown,
  fetchDailyCosts,
  fetchRecentCalls,
  fetchCostPerLead,
  type CostRange,
} from "@/lib/llm/cost-queries";

// All defined LlmFeature values — kept in sync with anthropic-client.ts
const ALL_FEATURES = [
  "g6_haiku_validation",
  "address_fallback",
  "name_fallback",
  "owner_kind_fallback",
  "format_detection",
  "briefing",
  "query_rewriting",
  "evidence_summary",
  "call_summary",
  "deal_fit_score",
  "auto_segment",
  "outreach_draft",
  "chat_with_data",
  "objection_coach",
] as const;

const RANGE_LABELS: Record<CostRange, string> = {
  "24h": "24 h",
  "7d": "7 jours",
  "30d": "30 jours",
  "all": "Tout",
};

export const dynamic = "force-dynamic";

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; feature?: string; model?: string; offset?: string }>;
}) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as string;
  if (role !== "admin") redirect("/leads");

  // ── Parse search params ───────────────────────────────────────────────────
  const sp = await searchParams;
  const range = (["24h", "7d", "30d", "all"].includes(sp.range ?? "") ? sp.range : "30d") as CostRange;
  const featureFilter = sp.feature && sp.feature !== "all" ? sp.feature : null;
  const modelFilter = sp.model && sp.model !== "all" ? sp.model : null;
  const offset = Math.max(0, parseInt(sp.offset ?? "0", 10) || 0);
  const PAGE_SIZE = 50;

  const since = rangeToSince(range);
  const sb = createSupabaseAdminClient();

  // ── Parallel data fetches ─────────────────────────────────────────────────
  // Wrapped in try/catch: if migration 0017 hasn't been applied yet, the
  // llm_usage_log table won't exist and Supabase returns a 42P01 error.
  // In that case we render a migration banner instead of a 500.
  let migrationPending = false;
  let topStats: Awaited<ReturnType<typeof fetchTopStats>> = { totalCostUsd: 0, totalCalls: 0, totalTokens: 0, avgLatencyMs: 0 };
  let featureRows: Awaited<ReturnType<typeof fetchFeatureBreakdown>> = [];
  let modelRows: Awaited<ReturnType<typeof fetchModelBreakdown>> = [];
  let dailyRows: Awaited<ReturnType<typeof fetchDailyCosts>> = [];
  let recentCalls: Awaited<ReturnType<typeof fetchRecentCalls>> = [];
  let costPerLead: Awaited<ReturnType<typeof fetchCostPerLead>> = { avgCostPerLead: 0, distinctLeads: 0 };

  try {
    // Quick probe: check if the table exists before running all queries.
    const { error: probeErr } = await sb.from("llm_usage_log").select("id").limit(1);
    if (probeErr && (probeErr.code === "42P01" || probeErr.code === "42703")) {
      migrationPending = true;
    } else {
      [topStats, featureRows, modelRows, dailyRows, recentCalls, costPerLead] = await Promise.all([
        fetchTopStats(sb, { since, feature: featureFilter, model: modelFilter }),
        fetchFeatureBreakdown(sb, { since, model: modelFilter }),
        fetchModelBreakdown(sb, { since, feature: featureFilter }),
        fetchDailyCosts(sb, { since, feature: featureFilter, model: modelFilter }),
        fetchRecentCalls(sb, { since, feature: featureFilter, model: modelFilter, limit: PAGE_SIZE, offset }),
        fetchCostPerLead(sb, { since, feature: featureFilter, model: modelFilter }),
      ]);
    }
  } catch {
    migrationPending = true;
  }

  // ── Cost projection ───────────────────────────────────────────────────────
  const days = range === "all"
    ? (dailyRows.length > 0 ? dailyRows.length : 30)
    : rangeToDays(range);
  const dailyAvg = days > 0 ? topStats.totalCostUsd / days : 0;
  const projectedMonthly = dailyAvg * 30;

  // ── Distinct model list (for filter dropdown) ─────────────────────────────
  const allModels = Array.from(new Set(modelRows.map(r => r.model)));

  // ── URL helpers ───────────────────────────────────────────────────────────
  function buildUrl(overrides: Record<string, string | null>) {
    const params = new URLSearchParams();
    const merged = { range, feature: featureFilter ?? "all", model: modelFilter ?? "all", ...overrides };
    if (merged.range && merged.range !== "30d") params.set("range", merged.range);
    if (merged.feature && merged.feature !== "all") params.set("feature", merged.feature);
    if (merged.model && merged.model !== "all") params.set("model", merged.model);
    const qs = params.toString();
    return `/admin/costs${qs ? `?${qs}` : ""}`;
  }

  // ── Bar chart helpers ─────────────────────────────────────────────────────
  const maxDailyCost = dailyRows.reduce((m, r) => Math.max(m, r.totalCostUsd), 0);

  if (migrationPending) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <header className="crm-page-header mb-6">
          <h1 className="crm-page-title">Coûts API</h1>
          <p className="crm-page-sub">Suivi en temps réel des appels Anthropic</p>
        </header>
        <div
          className="crm-card"
          style={{
            padding: "20px 24px",
            borderLeft: "4px solid var(--crm-gold, #C9A84C)",
            background: "var(--crm-gold-light, #F5EDD6)",
          }}
        >
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "var(--crm-text)" }}>
            Migration 0017 requise
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--crm-text2)" }}>
            Appliquez la migration <code>0017_llm_cost_tracking_and_briefings.sql</code> dans
            Supabase pour activer le suivi des coûts API. Cette page sera disponible dès que
            la table <code>llm_usage_log</code> aura été créée.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      {/* ── Header ── */}
      <header className="crm-page-header mb-6">
        <h1 className="crm-page-title">Coûts API</h1>
        <p className="crm-page-sub">Suivi en temps réel des appels Anthropic</p>
      </header>

      {/* ── Filters ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24, alignItems: "center" }}>
        {/* Range pills */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["24h", "7d", "30d", "all"] as CostRange[]).map(r => (
            <Link
              key={r}
              href={buildUrl({ range: r }) as never}
              style={{
                padding: "5px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "none",
                background: range === r ? "var(--crm-text)" : "var(--crm-card)",
                color: range === r ? "#fff" : "var(--crm-text2)",
                border: `1px solid ${range === r ? "transparent" : "var(--crm-card-border)"}`,
                transition: "background 0.15s",
              }}
            >
              {RANGE_LABELS[r]}
            </Link>
          ))}
        </div>

        {/* Feature select */}
        <UrlSelect
          name="feature"
          value={featureFilter ?? "all"}
          options={[
            { value: "all", label: "Toutes les features" },
            ...ALL_FEATURES.map(f => ({ value: f, label: f })),
          ]}
          baseUrl={buildUrl({ feature: null })}
          paramKey="feature"
          currentParams={{ range, model: modelFilter ?? "all" }}
        />

        {/* Model select */}
        <UrlSelect
          name="model"
          value={modelFilter ?? "all"}
          options={[
            { value: "all", label: "Tous les modèles" },
            ...allModels.map(m => ({ value: m, label: m })),
          ]}
          baseUrl={buildUrl({ model: null })}
          paramKey="model"
          currentParams={{ range, feature: featureFilter ?? "all" }}
        />
      </div>

      {/* ── Top stats cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 28 }}>
        <StatCard
          label="Dépense totale"
          value={formatCostUsd(topStats.totalCostUsd)}
          highlight={topStats.totalCostUsd > 10}
        />
        <StatCard label="Appels" value={topStats.totalCalls.toLocaleString("fr-FR")} />
        <StatCard label="Tokens totaux" value={topStats.totalTokens.toLocaleString("fr-FR")} />
        <StatCard
          label="Latence moy."
          value={`${topStats.avgLatencyMs.toLocaleString("fr-FR")} ms`}
        />
        <StatCard
          label={`Coût/lead (${costPerLead.distinctLeads} leads)`}
          value={costPerLead.distinctLeads > 0 ? formatCostUsd(costPerLead.avgCostPerLead) : "—"}
        />
      </div>

      {/* ── Per-feature breakdown ── */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 10 }}>
          Par feature
        </h2>
        <div className="crm-card" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--crm-bg-alt, #F5F2ED)", borderBottom: "1px solid var(--crm-card-border)" }}>
                {["Feature", "Appels", "Tokens", "Coût total", "Coût moy./appel", "Taux erreur"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, fontSize: 12, color: "var(--crm-text2)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {featureRows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--crm-text3)", fontSize: 13 }}>
                    Aucune donnée pour cette période.
                  </td>
                </tr>
              )}
              {featureRows.map((row, i) => (
                <tr
                  key={row.feature}
                  style={{
                    borderBottom: "1px solid var(--crm-card-border)",
                    background: i % 2 === 0 ? "var(--crm-card)" : "var(--crm-bg, #F9F7F4)",
                  }}
                >
                  <td style={{ padding: "8px 12px" }}>
                    <Link href={buildUrl({ feature: row.feature }) as never} style={{ color: "var(--crm-blue, #2563EB)", textDecoration: "none", fontWeight: 600 }}>
                      {row.feature}
                    </Link>
                  </td>
                  <td style={{ padding: "8px 12px", color: "var(--crm-text2)" }}>{row.calls.toLocaleString("fr-FR")}</td>
                  <td style={{ padding: "8px 12px", color: "var(--crm-text2)" }}>{row.totalTokens.toLocaleString("fr-FR")}</td>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>{formatCostUsd(row.totalCostUsd)}</td>
                  <td style={{ padding: "8px 12px", color: "var(--crm-text2)" }}>{formatCostUsd(row.avgCostUsd)}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
                      background: row.failureRate > 0.05 ? "var(--crm-red-light)" : "var(--crm-green-light)",
                      color: row.failureRate > 0.05 ? "var(--crm-red)" : "var(--crm-green)",
                    }}>
                      {(row.failureRate * 100).toFixed(1)} %
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Per-model breakdown ── */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 10 }}>
          Par modèle
        </h2>
        <div className="crm-card" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--crm-bg-alt, #F5F2ED)", borderBottom: "1px solid var(--crm-card-border)" }}>
                {["Modèle", "Appels", "Coût", "% du total"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, fontSize: 12, color: "var(--crm-text2)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modelRows.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 24, textAlign: "center", color: "var(--crm-text3)", fontSize: 13 }}>
                    Aucune donnée.
                  </td>
                </tr>
              )}
              {modelRows.map((row, i) => (
                <tr
                  key={row.model}
                  style={{
                    borderBottom: "1px solid var(--crm-card-border)",
                    background: i % 2 === 0 ? "var(--crm-card)" : "var(--crm-bg, #F9F7F4)",
                  }}
                >
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 12 }}>{row.model}</td>
                  <td style={{ padding: "8px 12px", color: "var(--crm-text2)" }}>{row.calls.toLocaleString("fr-FR")}</td>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>{formatCostUsd(row.totalCostUsd)}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: "var(--crm-card-border)", borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${row.pctOfTotal.toFixed(1)}%`, background: "var(--crm-gold, #C9A84C)", borderRadius: 999 }} />
                      </div>
                      <span style={{ fontSize: 12, color: "var(--crm-text2)", minWidth: 40, textAlign: "right" }}>
                        {row.pctOfTotal.toFixed(1)} %
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Daily cost chart ── */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 10 }}>
          Coût journalier
        </h2>
        <div className="crm-card" style={{ padding: "20px 16px 12px" }}>
          {dailyRows.length === 0 ? (
            <p style={{ textAlign: "center", color: "var(--crm-text3)", fontSize: 13, padding: "20px 0" }}>
              Aucune donnée pour cette période.
            </p>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120, overflowX: "auto" }}>
              {dailyRows.map(r => {
                const heightPct = maxDailyCost > 0 ? (r.totalCostUsd / maxDailyCost) * 100 : 0;
                return (
                  <div
                    key={r.day}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 36, flex: "1 0 36px" }}
                    title={`${r.day}: ${formatCostUsd(r.totalCostUsd)}`}
                  >
                    <span style={{ fontSize: 9, color: "var(--crm-text3)", writingMode: "vertical-rl", transform: "rotate(180deg)", height: 14 }}>
                      {formatCostUsd(r.totalCostUsd)}
                    </span>
                    <div
                      style={{
                        width: "100%",
                        height: `${Math.max(heightPct, 2)}%`,
                        background: r.totalCostUsd === maxDailyCost ? "var(--crm-gold, #C9A84C)" : "var(--crm-blue-light, #EAF1FF)",
                        borderRadius: "4px 4px 0 0",
                        border: "1px solid var(--crm-card-border)",
                        borderBottom: "none",
                        transition: "height 0.2s",
                      }}
                    />
                    <span style={{ fontSize: 9, color: "var(--crm-text3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 36, textAlign: "center" }}>
                      {r.day.slice(5)} {/* MM-DD */}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── Cost projection ── */}
      <section style={{ marginBottom: 28 }}>
        <div className="crm-card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20 }}>📈</span>
          <span style={{ fontSize: 14, color: "var(--crm-text2)" }}>
            Au rythme actuel,{" "}
            <strong style={{ color: "var(--crm-text)" }}>coût mensuel estimé : {formatCostUsd(projectedMonthly)}</strong>
            {" "}
            <span style={{ fontSize: 12, color: "var(--crm-text3)" }}>
              (moy. {formatCostUsd(dailyAvg)}/jour × 30)
            </span>
          </span>
        </div>
      </section>

      {/* ── Recent calls ── */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 10 }}>
          Appels récents
        </h2>
        <div className="crm-card" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--crm-bg-alt, #F5F2ED)", borderBottom: "1px solid var(--crm-card-border)" }}>
                {["Quand", "Feature", "Modèle", "Coût", "Latence", "Statut", "Lead"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, fontSize: 12, color: "var(--crm-text2)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentCalls.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--crm-text3)", fontSize: 13 }}>
                    Aucun appel dans cette période.
                  </td>
                </tr>
              )}
              {recentCalls.map((call, i) => (
                <tr
                  key={call.id}
                  style={{
                    borderBottom: "1px solid var(--crm-card-border)",
                    background: i % 2 === 0 ? "var(--crm-card)" : "var(--crm-bg, #F9F7F4)",
                  }}
                >
                  <td style={{ padding: "7px 12px", color: "var(--crm-text2)", whiteSpace: "nowrap", fontSize: 12 }}>
                    {relativeTime(call.created_at)}
                  </td>
                  <td style={{ padding: "7px 12px", fontWeight: 600, fontSize: 12 }}>
                    <Link href={buildUrl({ feature: call.feature }) as never} style={{ color: "var(--crm-blue, #2563EB)", textDecoration: "none" }}>
                      {call.feature}
                    </Link>
                  </td>
                  <td style={{ padding: "7px 12px", fontFamily: "monospace", fontSize: 11, color: "var(--crm-text2)" }}>
                    {call.model}
                  </td>
                  <td style={{ padding: "7px 12px", fontWeight: 600 }}>{formatCostUsd(call.cost_usd)}</td>
                  <td style={{ padding: "7px 12px", color: "var(--crm-text2)", fontSize: 12 }}>
                    {call.latency_ms} ms
                  </td>
                  <td style={{ padding: "7px 12px" }}>
                    <span style={{
                      fontSize: 13,
                      color: call.success ? "var(--crm-green, #2D8C4E)" : "var(--crm-red, #C0392B)",
                    }}>
                      {call.success ? "✓" : "✗"}
                    </span>
                  </td>
                  <td style={{ padding: "7px 12px" }}>
                    {call.lead_id ? (
                      <Link
                        href={`/leads/${call.lead_id}` as never}
                        style={{ fontSize: 11, color: "var(--crm-blue, #2563EB)", textDecoration: "none" }}
                      >
                        voir →
                      </Link>
                    ) : (
                      <span style={{ color: "var(--crm-text3)", fontSize: 11 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          {offset > 0 && (
            <Link
              href={buildUrl({ offset: String(Math.max(0, offset - PAGE_SIZE)) }) as never}
              className="crm-btn"
              style={{ fontSize: 12 }}
            >
              ← Précédent
            </Link>
          )}
          {recentCalls.length === PAGE_SIZE && (
            <Link
              href={buildUrl({ offset: String(offset + PAGE_SIZE) }) as never}
              className="crm-btn"
              style={{ fontSize: 12 }}
            >
              Afficher 50 de plus →
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className="crm-card"
      style={{
        padding: "16px 18px",
        borderColor: highlight ? "var(--crm-gold-border, #E9D9AA)" : undefined,
        background: highlight ? "var(--crm-gold-light, #F5EDD6)" : undefined,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--crm-text3)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--crm-text)", lineHeight: 1.1 }}>
        {value}
      </div>
    </div>
  );
}

/** A select that submits by navigating to a new URL. Uses a hidden form to
 *  avoid a client component — the form action builds the right URL. */
function UrlSelect({
  name,
  value,
  options,
  baseUrl,
  paramKey,
  currentParams,
}: {
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  baseUrl: string;
  paramKey: string;
  currentParams: Record<string, string>;
}) {
  // We render a native <select> with an onChange that navigates.
  // Because this is a server component we use a form with GET method instead.
  const params = new URLSearchParams();
  Object.entries(currentParams).forEach(([k, v]) => {
    if (v && v !== "all" && k !== paramKey) params.set(k, v);
  });

  return (
    <form method="GET" action="/admin/costs" style={{ display: "inline-flex" }}>
      {/* Pass through other filters as hidden inputs */}
      {Object.entries(currentParams).map(([k, v]) =>
        k !== paramKey && v && v !== "all" ? (
          <input key={k} type="hidden" name={k} value={v} />
        ) : null
      )}
      <select
        name={paramKey}
        defaultValue={value}
        // onChange requires client JS; we wrap in a form submit via onChange instead.
        // For a pure-server approach, the user selects then submits by pressing Enter
        // or we add a small submit button. We add a tiny submit button for no-JS support.
        style={{
          fontSize: 12,
          fontWeight: 600,
          padding: "5px 10px",
          borderRadius: 8,
          border: "1px solid var(--crm-card-border)",
          background: "var(--crm-card)",
          color: "var(--crm-text)",
          cursor: "pointer",
          appearance: "auto",
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <button
        type="submit"
        style={{
          marginLeft: 4, padding: "5px 10px", borderRadius: 8, fontSize: 12,
          fontWeight: 600, border: "1px solid var(--crm-card-border)",
          background: "var(--crm-card)", cursor: "pointer", color: "var(--crm-text2)",
        }}
      >
        OK
      </button>
    </form>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `il y a ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  return `il y a ${d}j`;
}
