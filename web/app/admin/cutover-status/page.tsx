// /admin/cutover-status — monitoring page for the new enrichment pipeline.
// Server component. Admin-only.

import { redirect } from "next/navigation";
import {
  createSupabaseServerClient,
  createSupabaseAdminClient,
} from "@/lib/supabase-server";
import {
  getDailyUsage,
  getTwilioDailyCap,
  getBraveDailyCap,
} from "@/lib/research/rate-limits";

export const dynamic = "force-dynamic";

interface CutoverData {
  twilio: { used: number; cap: number };
  brave: { used: number; cap: number };
  leadsEnriched: number;
  tierDistribution: Record<string, number>;
  recentErrors: Array<{
    lead_id: string | null;
    event_type: string;
    payload: unknown;
    created_at: string;
  }>;
  legacyFlag: string;
}

async function loadData(): Promise<CutoverData> {
  const sb = createSupabaseAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [twilioUsed, braveUsed] = await Promise.all([
    getDailyUsage(sb, "twilio_lookups"),
    getDailyUsage(sb, "brave_queries"),
  ]);

  const { count: leadsEnriched } = await sb
    .from("owner_record")
    .select("record_id", { count: "exact", head: true })
    .gt("research_completed_at", since);

  const { data: tierRows } = await sb
    .from("owner_record")
    .select("primary_phone_tier")
    .gt("research_completed_at", since);

  const tierDistribution: Record<string, number> = {
    A: 0,
    B: 0,
    C: 0,
    D: 0,
    E: 0,
    none: 0,
  };
  for (const r of (tierRows ?? []) as Array<{ primary_phone_tier: string | null }>) {
    const tier = r.primary_phone_tier ?? "none";
    tierDistribution[tier] = (tierDistribution[tier] ?? 0) + 1;
  }

  const { data: errorEvents } = await sb
    .from("enrichment_events")
    .select("lead_id, event_type, payload, created_at")
    .gt("created_at", since)
    .or("event_type.ilike.%error%,event_type.ilike.%failed%,event_type.ilike.%rejected%")
    .order("created_at", { ascending: false })
    .limit(5);

  return {
    twilio: { used: twilioUsed, cap: getTwilioDailyCap() },
    brave: { used: braveUsed, cap: getBraveDailyCap() },
    leadsEnriched: leadsEnriched ?? 0,
    tierDistribution,
    recentErrors: (errorEvents ?? []) as CutoverData["recentErrors"],
    legacyFlag: process.env.ENRICHMENT_USE_LEGACY ?? "(unset)",
  };
}

function pct(used: number, cap: number): string {
  if (cap <= 0) return "—";
  return `${Math.round((used / cap) * 100)}%`;
}

export default async function CutoverStatusPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "admin") redirect("/login");

  const data = await loadData();
  const usingLegacy = data.legacyFlag.toLowerCase() === "true";

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "32px 16px",
        fontFamily: "var(--font-geist-sans, system-ui, sans-serif)",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          Cutover Status
        </h1>
        <p style={{ margin: "6px 0 0", color: "#666", fontSize: 14 }}>
          Live monitoring of the new enrichment pipeline (Phase 11 cutover).
        </p>
      </div>

      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Pipeline mode</h2>
        <div
          style={{
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 6,
            background: usingLegacy ? "#fff3cd" : "#d4edda",
          }}
        >
          <strong>ENRICHMENT_USE_LEGACY</strong> = <code>{data.legacyFlag}</code>
          {" — "}
          {usingLegacy
            ? "LEGACY pipeline is active (kill-switch engaged)."
            : "NEW pipeline is active."}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Daily API caps (today)</h2>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "6px 8px" }}>API</th>
              <th style={{ padding: "6px 8px" }}>Used</th>
              <th style={{ padding: "6px 8px" }}>Cap</th>
              <th style={{ padding: "6px 8px" }}>%</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "6px 8px" }}>Twilio Lookup v2</td>
              <td style={{ padding: "6px 8px" }}>{data.twilio.used}</td>
              <td style={{ padding: "6px 8px" }}>{data.twilio.cap}</td>
              <td style={{ padding: "6px 8px" }}>{pct(data.twilio.used, data.twilio.cap)}</td>
            </tr>
            <tr>
              <td style={{ padding: "6px 8px" }}>Brave Search</td>
              <td style={{ padding: "6px 8px" }}>{data.brave.used}</td>
              <td style={{ padding: "6px 8px" }}>{data.brave.cap}</td>
              <td style={{ padding: "6px 8px" }}>{pct(data.brave.used, data.brave.cap)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Last 24 hours</h2>
        <p>
          Leads enriched (owner_record rows): <strong>{data.leadsEnriched}</strong>
        </p>
        <p>Tier distribution:</p>
        <ul>
          {Object.entries(data.tierDistribution).map(([tier, n]) => (
            <li key={tier}>
              Tier {tier}: <strong>{n}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>
          Recent errors (last 5, last 24h)
        </h2>
        {data.recentErrors.length === 0 ? (
          <p style={{ color: "#666" }}>No errors recorded.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={{ padding: "6px 8px" }}>Time</th>
                <th style={{ padding: "6px 8px" }}>Event</th>
                <th style={{ padding: "6px 8px" }}>Lead</th>
                <th style={{ padding: "6px 8px" }}>Payload</th>
              </tr>
            </thead>
            <tbody>
              {data.recentErrors.map((e, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 8px", fontSize: 12 }}>
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <code>{e.event_type}</code>
                  </td>
                  <td style={{ padding: "6px 8px", fontSize: 12 }}>
                    {e.lead_id ?? "—"}
                  </td>
                  <td style={{ padding: "6px 8px", fontSize: 11, fontFamily: "monospace" }}>
                    {JSON.stringify(e.payload).slice(0, 200)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
