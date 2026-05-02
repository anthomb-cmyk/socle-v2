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
  const reviews = (reviewRes.data ?? []) as Array<{ id: string; title: string; summary: string | null; urgency: string; created_at: string; lead_id: string | null }>;
  const proposed = (proposedRes.data ?? []) as Array<{ id: string; action_type: string; target_table: string; target_id: string | null; proposed_change: Record<string, unknown>; rationale: string | null; confidence: number | null; source: string; created_at: string }>;

  return (
    <main className="crm-page">
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <div>
          <h1 className="crm-page-title">Revue</h1>
          <p className="crm-page-sub">
            {reviews.length === 0 ? "Boîte vide — rien à revue." : `${reviews.length} élément${reviews.length > 1 ? "s" : ""} ouvert${reviews.length > 1 ? "s" : ""}`}
            {proposed.length > 0 && ` · ${proposed.length} action${proposed.length > 1 ? "s" : ""} proposée${proposed.length > 1 ? "s" : ""}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/leads" className="crm-btn">Leads</Link>
          <Link href="/import" className="crm-btn crm-btn-dark">Import</Link>
        </div>
      </div>

      {/* ── Two-column layout: review items + proposed actions ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>

        {/* Left: review items */}
        <section>
          <div className="crm-section-label" style={{ marginBottom: 10 }}>
            Éléments à revue <span style={{ color: "var(--crm-text2)", fontWeight: 700 }}>{reviews.length}</span>
          </div>
          {reviews.length === 0 ? (
            <div className="crm-card" style={{ padding: "28px 20px", textAlign: "center", color: "var(--crm-text3)", fontSize: 13 }}>
              Boîte vide — rien à revue.
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {reviews.map(it => {
                const borderColor = it.urgency === "urgent" ? "var(--crm-red)"
                  : it.urgency === "high" ? "var(--crm-amber)"
                  : "var(--crm-card-border)";
                const bgColor = it.urgency === "urgent" ? "var(--crm-red-light)" : "var(--crm-card)";
                return (
                  <li key={it.id} style={{
                    background: bgColor,
                    border: "1px solid var(--crm-card-border)",
                    borderLeft: `4px solid ${borderColor}`,
                    borderRadius: 10,
                    padding: "11px 14px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                      <h3 style={{ fontWeight: 700, fontSize: 13, color: "var(--crm-text)", margin: 0, lineHeight: 1.3 }}>{it.title}</h3>
                      <UrgencyPill urgency={it.urgency} />
                    </div>
                    {it.summary && (
                      <p style={{ fontSize: 12, color: "var(--crm-text2)", margin: "0 0 6px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                        {it.summary.length > 180 ? it.summary.slice(0, 180) + "…" : it.summary}
                      </p>
                    )}
                    <div style={{ fontSize: 11, color: "var(--crm-text3)", display: "flex", gap: 14, alignItems: "center" }}>
                      <span>{new Date(it.created_at).toLocaleString("fr-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      {it.lead_id && (
                        <Link href={`/leads/${it.lead_id}` as never} style={{ color: "var(--crm-blue)", textDecoration: "none", fontWeight: 600 }}>
                          Ouvrir lead →
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
          <div className="crm-section-label" style={{ marginBottom: 10 }}>
            Actions proposées <span style={{ color: "var(--crm-text2)", fontWeight: 700 }}>{proposed.length}</span>
          </div>
          <ProposedActionsList initial={proposed} />
        </section>

      </div>
    </main>
  );
}

function UrgencyPill({ urgency }: { urgency: string }) {
  const cfg: Record<string, { label: string; bg: string; color: string }> = {
    urgent:  { label: "Urgent",  bg: "var(--crm-red-light)",   color: "var(--crm-red)" },
    high:    { label: "Élevé",   bg: "var(--crm-amber-light)", color: "var(--crm-amber)" },
    normal:  { label: "Normal",  bg: "#F3F4F6",                color: "#4B5563" },
    low:     { label: "Faible",  bg: "#F9FAFB",                color: "var(--crm-text3)" },
  };
  const { label, bg, color } = cfg[urgency] ?? { label: urgency, bg: "#F3F4F6", color: "#4B5563" };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase",
      background: bg, color, borderRadius: 6, padding: "3px 8px",
    }}>
      {label}
    </span>
  );
}
