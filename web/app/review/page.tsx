import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import ProposedActionsList from "./ProposedActionsList";
import ReviewInbox, { ReviewItemVm, ReviewVelocity } from "./ReviewInbox";

export default async function ReviewPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  const sb = createSupabaseAdminClient();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [reviewRes, proposedRes, resolvedRes] = await Promise.all([
    sb.from("review_items")
      .select("id, source_kind, source_id, title, summary, urgency, created_at, lead_id")
      .eq("status", "open")
      .order("created_at", { ascending: false }),
    sb.from("proposed_actions")
      .select("id, action_type, target_table, target_id, proposed_change, rationale, confidence, source, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    sb.from("review_items")
      .select("id, created_at, resolved_at")
      .eq("status", "accepted")
      .gte("resolved_at", weekAgo.toISOString())
      .order("resolved_at", { ascending: true }),
  ]);

  const rawReviews = (reviewRes.data ?? []) as Array<{
    id: string; source_kind: string; source_id: string | null; title: string; summary: string | null;
    urgency: string; created_at: string; lead_id: string | null;
  }>;

  const submissionIds = rawReviews
    .map((item) => item.source_id)
    .filter((id): id is string => Boolean(id));
  const { data: submissionRows } = submissionIds.length
    ? await sb.from("lead_submissions")
      .select("id, timeline, motivation, asking_price, lead_id")
      .in("id", submissionIds)
    : { data: [] };
  const leadIds = rawReviews.map((item) => item.lead_id).filter((id): id is string => Boolean(id));
  const { data: leadRows } = leadIds.length
    ? await sb.from("leads_view").select("lead_id, num_units").in("lead_id", leadIds)
    : { data: [] };
  const unitsByLeadId = new Map(
    ((leadRows ?? []) as Array<{ lead_id: string; num_units: number | null }>).map((row) => [row.lead_id, row.num_units]),
  );
  const submissionById = new Map(
    ((submissionRows ?? []) as Array<{
      id: string;
      timeline: string | null;
      motivation: string | null;
      asking_price: number | null;
    }>).map((row) => [row.id, row]),
  );

  const urgencyOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const reviews = [...rawReviews].sort(
    (a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9),
  );
  const reviewItems: ReviewItemVm[] = reviews.map((item) => {
    const submission = item.source_id ? submissionById.get(item.source_id) : null;
    return {
      id: item.id,
      title: item.title,
      summary: item.summary,
      urgency: item.urgency,
      created_at: item.created_at,
      lead_id: item.lead_id,
      meta: {
        timeline: submission?.timeline ?? null,
        motivation: submission?.motivation ?? null,
        askingPrice: submission?.asking_price == null ? null : Number(submission.asking_price),
        units: item.lead_id ? unitsByLeadId.get(item.lead_id) ?? null : null,
      },
    };
  });

  const proposed = (proposedRes.data ?? []) as Array<{
    id: string; action_type: string; target_table: string; target_id: string | null;
    proposed_change: Record<string, unknown>; rationale: string | null;
    confidence: number | null; source: string; created_at: string;
  }>;

  const urgentCount = reviews.filter((r) => r.urgency === "urgent").length;
  const totalPending = reviews.length + proposed.length;
  const velocity = buildVelocity((resolvedRes.data ?? []) as Array<{ created_at: string; resolved_at: string | null }>);
  const phoneReviewCount = reviews.filter((r) => r.source_kind === "phone_review").length;
  const commandCount = reviews.filter((r) => r.source_kind === "command_clarification").length;
  const processedCount = ((resolvedRes.data ?? []) as Array<unknown>).length;

  return (
    <main className="rev-main">
      <div className="rev-page-head">
        <div>
          <div className="rev-page-head__crumb">Inbox · décisions à prendre</div>
          <h1 className="rev-page-head__t">Revue</h1>
          <div className="rev-page-head__sub">
            {reviews.length === 0 && proposed.length === 0
              ? "Boîte vide — aucun élément à traiter."
              : `${totalPending} en attente · ${urgentCount} urgent · ${proposed.length} action${proposed.length > 1 ? "s" : ""} proposée${proposed.length > 1 ? "s" : ""}`}
          </div>
        </div>
        <div className="rev-page-head__actions">
          <Link href="/admin/users" className="btn"><Icon name="message" /> Telegram</Link>
          <Link href="/review" className="btn btn--primary">Tout traiter</Link>
        </div>
      </div>

      <ReviewInbox
        initialItems={reviewItems}
        proposedCount={proposed.length}
        phoneReviewCount={phoneReviewCount}
        commandCount={commandCount}
        processedCount={processedCount}
        velocity={velocity}
      />

      <section className="rev-proposed-panel">
        <div className="rev-section-head">
          <span className="rev-section-title">Actions proposées</span>
          {proposed.length > 0 ? <span className="pill pill--brand">{proposed.length}</span> : null}
        </div>
        {proposed.length === 0 ? <EmptyCard title="Aucune action proposée" sub="—" compact /> : <ProposedActionsList initial={proposed} />}
      </section>
    </main>
  );
}

function EmptyCard({ title, sub, compact }: { title: string; sub: string; compact?: boolean }) {
  return (
    <div className="rev-empty">
      <p className="rev-empty__t">{title}</p>
      <p className="rev-empty__sub">{compact ? "—" : sub}</p>
    </div>
  );
}

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    arrowLeft: <path d="M19 12H5M11 18l-6-6 6-6" />,
    arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
    flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
    alert: <path d="M12 9v4M12 17h.01M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0z" />,
    message: <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function buildVelocity(rows: Array<{ created_at: string; resolved_at: string | null }>): ReviewVelocity {
  const ages = rows
    .filter((row) => row.resolved_at)
    .map((row) => (new Date(row.resolved_at as string).getTime() - new Date(row.created_at).getTime()) / 3_600_000)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const medianHours = ages.length === 0
    ? null
    : ages.length % 2
    ? ages[Math.floor(ages.length / 2)]
    : (ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2;

  const now = new Date();
  const buckets = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (6 - index));
    return date.toISOString().slice(0, 10);
  });
  const sparkline = buckets.map((day) =>
    rows.filter((row) => row.resolved_at?.slice(0, 10) === day).length,
  );
  return { medianHours, sparkline };
}
