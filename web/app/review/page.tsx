import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import ProposedActionsList from "./ProposedActionsList";

export default async function ReviewPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  const sb = createSupabaseAdminClient();
  const [reviewRes, proposedRes] = await Promise.all([
    sb.from("review_items")
      .select("id, title, summary, urgency, created_at, lead_id")
      .eq("status", "open")
      .order("created_at", { ascending: false }),
    sb.from("proposed_actions")
      .select("id, action_type, target_table, target_id, proposed_change, rationale, confidence, source, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);

  const rawReviews = (reviewRes.data ?? []) as Array<{
    id: string; title: string; summary: string | null;
    urgency: string; created_at: string; lead_id: string | null;
  }>;

  // Sort urgency-first: urgent → high → normal → low
  const urgencyOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const reviews = [...rawReviews].sort(
    (a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9)
  );

  const proposed = (proposedRes.data ?? []) as Array<{
    id: string; action_type: string; target_table: string; target_id: string | null;
    proposed_change: Record<string, unknown>; rationale: string | null;
    confidence: number | null; source: string; created_at: string;
  }>;

  const urgentCount = reviews.filter(r => r.urgency === "urgent").length;
  const highCount   = reviews.filter(r => r.urgency === "high").length;

  return (
    <main className="crm-page">

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
        <div>
          <h1 className="crm-page-title">Revue vendeurs</h1>
          <p className="crm-page-sub">
            {reviews.length === 0
              ? "Boîte vide — aucun élément à traiter."
              : <>{reviews.length} élément{reviews.length > 1 ? "s" : ""} ouvert{reviews.length > 1 ? "s" : ""}
                  {urgentCount > 0 && <> · <strong style={{ color: "var(--crm-red)" }}>{urgentCount} urgent{urgentCount > 1 ? "s" : ""}</strong></>}
                  {highCount > 0 && <> · <strong style={{ color: "var(--crm-amber)" }}>{highCount} élevé{highCount > 1 ? "s" : ""}</strong></>}
                  {proposed.length > 0 && <> · {proposed.length} action{proposed.length > 1 ? "s" : ""} proposée{proposed.length > 1 ? "s" : ""}</>}
                </>
            }
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/leads" className="crm-btn">← Leads</Link>
          <Link href="/import" className="crm-btn crm-btn-dark">Import</Link>
        </div>
      </div>

      {/* ── Two-column layout: review items + proposed actions ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, alignItems: "start" }}>

        {/* Left: review items */}
        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span className="crm-section-label" style={{ margin: 0 }}>Éléments à traiter</span>
            {reviews.length > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, background: urgentCount > 0 ? "var(--crm-red-light)" : "var(--crm-bg-alt)",
                color: urgentCount > 0 ? "var(--crm-red)" : "var(--crm-text2)",
                border: `1px solid ${urgentCount > 0 ? "#FFCDD2" : "var(--crm-card-border)"}`,
                borderRadius: 999, padding: "2px 9px",
              }}>
                {reviews.length}
              </span>
            )}
          </div>

          {reviews.length === 0 ? (
            <div className="crm-card">
              <div className="crm-empty-state">
                
                <p className="crm-empty-state-title">Boîte vide</p>
                <p className="crm-empty-state-sub">Aucun vendeur à traiter en ce moment. Beau travail !</p>
              </div>
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {reviews.map(it => {
                const isUrgent = it.urgency === "urgent";
                const isHigh   = it.urgency === "high";
                const borderColor = isUrgent ? "var(--crm-red)" : isHigh ? "var(--crm-amber)" : "var(--crm-card-border)";
                const bgColor     = isUrgent ? "#FFF5F3" : isHigh ? "#FFFAF0" : "var(--crm-card)";

                return (
                  <li key={it.id} style={{
                    background: bgColor,
                    border: `1px solid ${isUrgent ? "#F9BFBB" : isHigh ? "#F6D7A4" : "var(--crm-card-border)"}`,
                    borderLeft: `4px solid ${borderColor}`,
                    borderRadius: 10,
                    padding: "14px 18px",
                    boxShadow: isUrgent ? "0 1px 4px rgba(192,57,43,0.10)" : "0 1px 2px rgba(0,0,0,0.03)",
                  }}>
                    {/* Title row */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
                      <h3 style={{ fontWeight: 800, fontSize: 14, color: "var(--crm-text)", margin: 0, lineHeight: 1.3, flex: 1 }}>
                        {it.title}
                      </h3>
                      <UrgencyPill urgency={it.urgency} />
                    </div>

                    {/* Summary */}
                    {it.summary && (
                      <p style={{
                        fontSize: 13, color: "var(--crm-text2)", margin: "0 0 10px", lineHeight: 1.55,
                        whiteSpace: "pre-wrap",
                        overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical",
                      }}>
                        {it.summary}
                      </p>
                    )}

                    {/* Footer row */}
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--crm-text3)", fontWeight: 500 }}>
                        {new Date(it.created_at).toLocaleString("fr-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {it.lead_id && (
                        <Link href={`/leads/${it.lead_id}` as never} className="crm-open-lead-link">
                          Ouvrir le lead →
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Right: proposed actions */}
        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span className="crm-section-label" style={{ margin: 0 }}>Actions proposées</span>
            {proposed.length > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, background: "var(--crm-bg-alt)",
                color: "var(--crm-text2)", border: "1px solid var(--crm-card-border)",
                borderRadius: 999, padding: "2px 9px",
              }}>
                {proposed.length}
              </span>
            )}
          </div>
          {proposed.length === 0 ? (
            <div className="crm-card">
              <div className="crm-empty-state">
                
                <p className="crm-empty-state-title">Aucune action proposée</p>
                <p className="crm-empty-state-sub">Les suggestions d&rsquo;automatisation apparaîtront ici.</p>
              </div>
            </div>
          ) : (
            <ProposedActionsList initial={proposed} />
          )}
        </section>

      </div>
    </main>
  );
}

function UrgencyPill({ urgency }: { urgency: string }) {
  const cfg: Record<string, { label: string; bg: string; color: string; border: string }> = {
    urgent: { label: "Urgent",  bg: "var(--crm-red-light)",   color: "var(--crm-red)",   border: "#FFCDD2" },
    high:   { label: "Élevé",   bg: "var(--crm-amber-light)", color: "var(--crm-amber)", border: "#F6D7A4" },
    normal: { label: "Normal",  bg: "#F3F4F6",                color: "#4B5563",          border: "#E5E7EB" },
    low:    { label: "Faible",  bg: "#F9FAFB",                color: "var(--crm-text3)", border: "#F3F4F6" },
  };
  const { label, bg, color, border } = cfg[urgency] ?? { label: urgency, bg: "#F3F4F6", color: "#4B5563", border: "#E5E7EB" };
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, letterSpacing: "0.8px", textTransform: "uppercase",
      background: bg, color, border: `1px solid ${border}`,
      borderRadius: 7, padding: "3px 9px", flexShrink: 0,
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}
