import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import PhoneReviewClient, { type PhoneCandidate } from "./PhoneReviewClient";
import PhoneReviewHeader from "./PhoneReviewHeader";
import PhoneReviewRules from "./PhoneReviewRules";
import NextStepBanner from "@/components/next-step-banner";

export const revalidate = 0;

export default async function PhoneReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  const sb = createSupabaseAdminClient();

  const params = await searchParams;
  const justApproved = params["_just_approved"] === "1";

  const [candidatesRes, readyRes] = await Promise.all([
    sb
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
      .limit(200),
    sb.from("leads").select("id", { count: "exact", head: true }).eq("status", "ready_to_call"),
  ]);

  if (candidatesRes.error) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p className="text-red-600">Failed to load review queue: {candidatesRes.error.message}</p>
      </main>
    );
  }

  const candidates = (candidatesRes.data ?? []) as unknown as PhoneCandidate[];
  const readyCount = readyRes.count ?? 0;

  return (
    <main className="crm-page-narrow" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {justApproved && (
        <NextStepBanner
          kind="review_done"
          counts={{ ready: readyCount, review: 0, hotSellers: 0 }}
        />
      )}

      <PhoneReviewHeader candidateCount={candidates.length} />

      {candidates.length > 0 && <PhoneReviewRules />}

      <PhoneReviewClient initialCandidates={candidates} />
    </main>
  );
}
