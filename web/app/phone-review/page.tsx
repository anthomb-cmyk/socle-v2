import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import PhoneReviewClient, { type PhoneCandidate } from "./PhoneReviewClient";

export const revalidate = 0;

export default async function PhoneReviewPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  const sb = createSupabaseAdminClient();

  const { data, error } = await sb
    .from("phone_candidates")
    .select(`
      id,
      lead_id,
      phone_raw,
      phone_e164,
      stage,
      matched_on,
      search_query,
      candidate_name,
      candidate_address,
      source_label,
      source_url,
      snippet,
      initial_confidence,
      openclaw_verdict,
      openclaw_confidence,
      openclaw_evidence,
      openclaw_reasoning,
      candidate_status,
      review_reason,
      created_at,
      leads (
        id,
        status,
        campaign_id,
        campaigns ( name ),
        properties ( address, city, num_units ),
        contacts (
          id,
          full_name,
          company_name,
          mailing_address,
          mailing_city,
          mailing_postal
        )
      )
    `)
    .eq("candidate_status", "needs_anthony_review")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p className="text-red-600">Failed to load review queue: {error.message}</p>
      </main>
    );
  }

  const candidates = (data ?? []) as unknown as PhoneCandidate[];

  return (
    <main className="crm-page-narrow" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 4 }}>
        <div>
          <h1 className="crm-page-title">Revue téléphonique</h1>
          <p className="crm-page-sub">
            {candidates.length === 0
              ? "Aucun candidat en attente de revue."
              : `${candidates.length} candidat${candidates.length === 1 ? "" : "s"} à approuver avant d'être appelable${candidates.length === 1 ? "" : "s"}.`}
          </p>
        </div>
        <nav style={{ display: "flex", gap: 8 }}>
          <Link href="/leads" className="crm-btn">Leads</Link>
          <Link href="/review" className="crm-btn">Revue</Link>
        </nav>
      </header>

      {candidates.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--crm-text3)", background: "var(--crm-bg-alt)", border: "1px solid var(--crm-card-border)", borderRadius: 10, padding: "8px 14px" }}>
          <strong style={{ color: "var(--crm-text2)" }}>Règles :</strong> Approuvez un numéro pour rendre le lead appelable. Rejetez pour le supprimer.
          Réessayer relance le pipeline. Garder non-résolu masque sans réessayer.
        </div>
      )}

      <PhoneReviewClient initialCandidates={candidates} />
    </main>
  );
}
