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
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 4, flexWrap: "wrap" }}>
        <div>
          <h1 className="crm-page-title">Revue</h1>
          <p className="crm-page-sub">Vendeurs chauds · actions proposées · commandes ambiguës.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/leads" className="crm-btn">Leads</Link>
          <Link href="/import" className="crm-btn crm-btn-dark">Import</Link>
        </div>
      </header>

      <section>
        <h2 className="crm-section-label">Éléments à revue ({reviews.length})</h2>
        {reviews.length === 0 ? (
          <div className="crm-card" style={{ padding: "32px 24px", textAlign: "center", color: "var(--crm-text3)" }}>
            Boîte vide — rien à revue.
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {reviews.map(it => (
              <li key={it.id} className="crm-card" style={{ padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <h3 style={{ fontWeight: 700, fontSize: 14, color: "var(--crm-text)", margin: 0 }}>{it.title}</h3>
                  <UrgencyPill urgency={it.urgency} />
                </div>
                {it.summary && <p style={{ fontSize: 13, color: "var(--crm-text2)", whiteSpace: "pre-wrap", margin: "0 0 8px" }}>{it.summary}</p>}
                <div style={{ fontSize: 11, color: "var(--crm-text3)", display: "flex", gap: 16 }}>
                  <span>{new Date(it.created_at).toLocaleString("fr-CA")}</span>
                  {it.lead_id && (
                    <Link href={`/leads/${it.lead_id}` as never} style={{ color: "var(--crm-blue)", textDecoration: "none" }}>
                      Ouvrir lead →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="crm-section-label">Actions proposées ({proposed.length})</h2>
        <ProposedActionsList initial={proposed} />
      </section>
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
