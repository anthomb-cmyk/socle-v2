// Per-lead enrichment audit page — admin only.
// Shows: lead summary, enrichment event timeline, all phone candidates
// with disposition color-coding and expandable detail sections.

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

// ── Types ────────────────────────────────────────────────────────────────────

type LeadRow = {
  id: string;
  status: string;
  fit_score: number | null;
  fit_reasoning: string | null;
  briefing_text: string | null;
  contacts: {
    full_name: string | null;
    company_name: string | null;
    mailing_address: string | null;
    mailing_city: string | null;
  } | null;
  properties: {
    address: string | null;
    city: string | null;
  } | null;
};

type EnrichmentEventRow = {
  id: string;
  event_type: string;
  stage: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  candidate_id: string | null;
};

type PhoneCandidateRow = {
  id: string;
  phone_raw: string;
  phone_e164: string | null;
  stage: string;
  source_label: string;
  source_url: string | null;
  snippet: string | null;
  candidate_status: string;
  gate_results: {
    outcomes: Array<{ gate: string; pass: boolean; reason: string; signal?: Record<string, unknown> }>;
    passed: boolean;
    firstFailure: string | null;
    disposition: string;
    score: number;
    scoreFactors?: { source: number; address: number; name: number; phoneAuthority: number };
    haiku?: { isOwnersPhone: boolean; confidence: number; reasoning: string; nameInSource: boolean; addressInSource: boolean };
  } | null;
  source_class: string | null;
  initial_confidence: number;
  review_reason: string | null;
  created_at: string;
};

// ── Disposition badge helpers ─────────────────────────────────────────────────

function dispositionStyle(disposition: string): { bg: string; color: string; label: string } {
  switch (disposition) {
    case "auto_attached":        return { bg: "#D1FAE5", color: "#065F46", label: "Auto-attached" };
    case "needs_anthony_review": return { bg: "#FEF3C7", color: "#92400E", label: "Review" };
    case "weak_review":          return { bg: "#FEFCE8", color: "#854D0E", label: "Weak Review" };
    case "quarantined":          return { bg: "#F3F4F6", color: "#374151", label: "Quarantined" };
    case "pipeline_rejected":    return { bg: "#FEE2E2", color: "#991B1B", label: "Rejected" };
    default:                     return { bg: "#F3F4F6", color: "#374151", label: disposition };
  }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function LeadEnrichmentAuditPage(
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as string;
  if (role !== "admin") redirect("/leads");

  const sb = createSupabaseAdminClient();

  // Fetch lead with contacts + properties
  const { data: leadRaw, error: leadErr } = await sb
    .from("leads")
    .select(`
      id, status, fit_score, fit_reasoning, briefing_text,
      contacts ( full_name, company_name, mailing_address, mailing_city ),
      properties ( address, city )
    `)
    .eq("id", leadId)
    .single();

  if (leadErr || !leadRaw) return notFound();
  const lead = leadRaw as unknown as LeadRow;

  // Fetch all enrichment events chronologically
  const { data: eventsData } = await sb
    .from("enrichment_events")
    .select("id, event_type, stage, payload, created_at, candidate_id")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });
  const events = (eventsData ?? []) as EnrichmentEventRow[];

  // Fetch all phone candidates
  const { data: candidatesData } = await sb
    .from("phone_candidates")
    .select("id, phone_raw, phone_e164, stage, source_label, source_url, snippet, candidate_status, gate_results, source_class, initial_confidence, review_reason, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });
  const candidates = (candidatesData ?? []) as PhoneCandidateRow[];

  const ownerName = lead.contacts?.full_name ?? lead.contacts?.company_name ?? "—";
  const mailingCity = lead.contacts?.mailing_city ?? "—";
  const propAddr = [lead.properties?.address, lead.properties?.city].filter(Boolean).join(", ") || "—";

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 16, fontSize: 13, color: "var(--crm-text3)" }}>
        <Link href="/admin/enrichment" style={{ color: "var(--crm-blue, #2563EB)", textDecoration: "none" }}>
          ← Enrichment
        </Link>
        {" / "}
        <span>{ownerName}</span>
      </div>

      {/* Lead summary */}
      <div className="crm-card" style={{ padding: "16px 20px", marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{ownerName}</h1>
        <p style={{ fontSize: 13, color: "var(--crm-text2)", marginBottom: 4 }}>
          {mailingCity} · {propAddr}
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, marginTop: 8 }}>
          <span style={{ padding: "2px 8px", borderRadius: 999, background: "#E0F2FE", color: "#0369A1", fontWeight: 600 }}>
            {lead.status.replace(/_/g, " ")}
          </span>
          {lead.fit_score != null && (
            <span style={{ padding: "2px 8px", borderRadius: 999, background: "#F0FDF4", color: "#166534", fontWeight: 600 }}>
              Fit score: {lead.fit_score}
            </span>
          )}
        </div>
        {lead.briefing_text && (
          <div style={{ marginTop: 12, fontSize: 13, color: "var(--crm-text2)", borderTop: "1px solid var(--crm-card-border)", paddingTop: 10 }}>
            <strong style={{ fontWeight: 600, fontSize: 11, textTransform: "uppercase", color: "var(--crm-text3)", letterSpacing: "0.5px" }}>
              Briefing
            </strong>
            <p style={{ marginTop: 4, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{lead.briefing_text}</p>
          </div>
        )}
      </div>

      {/* Phone candidates */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--crm-text3)", marginBottom: 12 }}>
          Phone candidates ({candidates.length})
        </h2>
        {candidates.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--crm-text3)" }}>No candidates recorded.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {candidates.map(c => {
              const badge = dispositionStyle(c.candidate_status);
              const gates = c.gate_results?.outcomes ?? [];
              const firstFail = gates.find(g => !g.pass);
              const haiku = c.gate_results?.haiku;
              const factors = c.gate_results?.scoreFactors;

              return (
                <details key={c.id} className="crm-card" style={{ padding: 0, overflow: "hidden" }}>
                  <summary style={{
                    padding: "12px 16px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    listStyle: "none",
                    fontSize: 13,
                  }}>
                    <span style={{
                      padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                      background: badge.bg, color: badge.color, flexShrink: 0,
                    }}>
                      {badge.label}
                    </span>
                    <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                      {c.phone_e164 ?? c.phone_raw}
                    </span>
                    <span style={{ color: "var(--crm-text3)", fontSize: 12 }}>
                      {c.stage} · score {c.gate_results?.score ?? "—"}
                    </span>
                    {c.candidate_status === "quarantined" && firstFail && (
                      <span style={{ fontSize: 11, color: "#DC2626", marginLeft: "auto" }}
                        title={firstFail.reason}>
                        failed: {firstFail.gate}
                      </span>
                    )}
                    {c.candidate_status === "pipeline_rejected" && (
                      <span style={{ fontSize: 11, color: "#DC2626", marginLeft: "auto" }}>
                        {c.review_reason ?? "rejected"}
                      </span>
                    )}
                  </summary>

                  <div style={{ padding: "0 16px 16px", borderTop: "1px solid var(--crm-card-border)" }}>
                    {/* Source */}
                    <div style={{ marginTop: 12 }}>
                      <Label>Source</Label>
                      <p style={{ fontSize: 12, margin: "4px 0" }}>
                        <strong>{c.source_class ?? c.source_label}</strong>
                        {c.source_url && (
                          <>
                            {" · "}
                            <a href={c.source_url} target="_blank" rel="noreferrer"
                              style={{ color: "var(--crm-blue, #2563EB)", fontSize: 11 }}>
                              {c.source_url.slice(0, 80)}
                            </a>
                          </>
                        )}
                      </p>
                      {c.snippet && (
                        <p style={{ fontSize: 11, color: "var(--crm-text3)", fontStyle: "italic", marginTop: 4 }}>
                          &ldquo;{c.snippet.slice(0, 200)}&rdquo;
                        </p>
                      )}
                    </div>

                    {/* Gate outcomes */}
                    {gates.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <Label>Gates</Label>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 4 }}>
                          <tbody>
                            {gates.map((g, idx) => (
                              <tr key={idx} style={{ borderBottom: "1px solid var(--crm-card-border)" }}>
                                <td style={{ padding: "4px 8px", fontFamily: "monospace", fontSize: 11, width: 200 }}>{g.gate}</td>
                                <td style={{ padding: "4px 8px", color: g.pass ? "#059669" : "#DC2626", fontWeight: 700, width: 50 }}>
                                  {g.pass ? "pass" : "fail"}
                                </td>
                                <td style={{ padding: "4px 8px", color: "var(--crm-text2)" }}>{g.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Score factors */}
                    {factors && (
                      <div style={{ marginTop: 12 }}>
                        <Label>Score factors</Label>
                        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, marginTop: 4 }}>
                          {Object.entries(factors).map(([k, v]) => (
                            <span key={k}>
                              <span style={{ color: "var(--crm-text3)" }}>{k}:</span>{" "}
                              <strong>{v}</strong>
                            </span>
                          ))}
                          <span>
                            <span style={{ color: "var(--crm-text3)" }}>final:</span>{" "}
                            <strong>{c.gate_results?.score}</strong>
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Haiku verdict */}
                    {haiku && (
                      <div style={{ marginTop: 12, padding: "8px 12px", background: haiku.isOwnersPhone ? "#F0FDF4" : "#FFF1F2", borderRadius: 8, fontSize: 12 }}>
                        <Label>Haiku G6 verdict</Label>
                        <p style={{ margin: "4px 0", fontWeight: 600, color: haiku.isOwnersPhone ? "#059669" : "#DC2626" }}>
                          {haiku.isOwnersPhone ? "Approves" : "Rejects"} — confidence {haiku.confidence}
                        </p>
                        <p style={{ margin: 0, color: "var(--crm-text2)" }}>{haiku.reasoning}</p>
                        <p style={{ margin: "4px 0 0", color: "var(--crm-text3)", fontSize: 11 }}>
                          name in source: {haiku.nameInSource ? "yes" : "no"} ·
                          address in source: {haiku.addressInSource ? "yes" : "no"}
                        </p>
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>

      {/* Enrichment event timeline */}
      <section>
        <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--crm-text3)", marginBottom: 12 }}>
          Event timeline ({events.length})
        </h2>
        {events.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--crm-text3)" }}>No events recorded.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {events.map(ev => (
              <details key={ev.id} style={{ borderLeft: "2px solid var(--crm-card-border)", paddingLeft: 12 }}>
                <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", gap: 12, alignItems: "baseline", fontSize: 12 }}>
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--crm-text3)", flexShrink: 0 }}>
                    {new Date(ev.created_at).toLocaleString("fr-CA")}
                  </span>
                  <span style={{ fontWeight: 600 }}>{ev.event_type}</span>
                  {ev.stage && <span style={{ color: "var(--crm-text3)" }}>[{ev.stage}]</span>}
                </summary>
                {ev.payload && (
                  <pre style={{
                    fontSize: 11, background: "var(--crm-bg-alt, #F5F2ED)", padding: "8px 10px",
                    borderRadius: 6, marginTop: 6, overflowX: "auto",
                    whiteSpace: "pre-wrap", color: "var(--crm-text2)",
                  }}>
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                )}
              </details>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--crm-text3)", marginBottom: 2 }}>
      {children}
    </div>
  );
}
