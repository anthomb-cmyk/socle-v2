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
    <main className="mx-auto max-w-2xl p-6 space-y-6">
      <header>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Phone review queue</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              {candidates.length === 0
                ? "No candidates waiting for review."
                : `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} need your review before becoming callable.`}
            </p>
          </div>
          <nav className="flex gap-2 text-sm">
            <Link href="/leads" className="border border-zinc-300 rounded-lg px-3 py-1.5 text-zinc-600 hover:bg-zinc-50">
              Leads
            </Link>
            <Link href="/review" className="border border-zinc-300 rounded-lg px-3 py-1.5 text-zinc-600 hover:bg-zinc-50">
              Review inbox
            </Link>
          </nav>
        </div>

        {candidates.length > 0 && (
          <div className="mt-4 text-xs text-zinc-400 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2">
            <strong>Rules:</strong> Approve a phone to make the lead callable. Reject to discard.
            Retry re-runs the full enrichment pipeline. Keep unresolved hides from queue without retrying.
          </div>
        )}
      </header>

      <PhoneReviewClient initialCandidates={candidates} />
    </main>
  );
}
