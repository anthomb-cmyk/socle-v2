import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
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

  const urgencyOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const reviews = [...rawReviews].sort(
    (a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9),
  );

  const proposed = (proposedRes.data ?? []) as Array<{
    id: string; action_type: string; target_table: string; target_id: string | null;
    proposed_change: Record<string, unknown>; rationale: string | null;
    confidence: number | null; source: string; created_at: string;
  }>;

  const urgentCount = reviews.filter((r) => r.urgency === "urgent").length;
  const highCount = reviews.filter((r) => r.urgency === "high").length;
  const totalPending = reviews.length + proposed.length;

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
          <Link href="/leads" className="btn"><Icon name="arrowLeft" /> Leads</Link>
          <Link href="/import" className="btn btn--primary">Import</Link>
        </div>
      </div>

      <div className="rev-tabs">
        <button type="button" className={`rev-tab rev-tab--active ${urgentCount > 0 ? "rev-tab--alert" : ""}`}>
          Éléments à traiter <span className="rev-tab__c">{reviews.length}</span>
        </button>
        <button type="button" className="rev-tab">
          Actions proposées <span className="rev-tab__c">{proposed.length}</span>
        </button>
        <button type="button" className="rev-tab">
          Urgents <span className="rev-tab__c">{urgentCount}</span>
        </button>
        <button type="button" className="rev-tab">
          Élevés <span className="rev-tab__c">{highCount}</span>
        </button>
      </div>

      <div className="rev-grid">
        <section>
          <div className="rev-section-head">
            <span className="rev-section-title">Éléments à traiter</span>
            {reviews.length > 0 ? <span className="pill pill--brand">{reviews.length}</span> : null}
          </div>

          {reviews.length === 0 ? (
            <EmptyCard title="Boîte vide" sub="Aucun vendeur à traiter en ce moment." />
          ) : (
            <ul className="rev-list">
              {reviews.map((item) => (
                <li key={item.id} className={`rev-card ${item.urgency === "urgent" ? "rev-card--hot" : ""}`}>
                  <div className="rev-card__head">
                    <div className={`rev-card__icon ${item.urgency === "urgent" ? "rev-card__icon--hot" : "rev-card__icon--auto"}`}>
                      <Icon name={item.urgency === "urgent" ? "flame" : "alert"} size={20} />
                    </div>
                    <div className="rev-card__body">
                      <h3 className="rev-card__t">{item.title}</h3>
                      <div className="rev-card__sub">
                        <UrgencyPill urgency={item.urgency} />
                        {item.lead_id ? <span>Lead lié</span> : <span>Lead —</span>}
                      </div>
                    </div>
                    <span className="rev-card__age">{formatDate(item.created_at)}</span>
                  </div>

                  <div className="rev-quote">{item.summary ?? "—"}</div>

                  <div className="rev-card__acts">
                    {item.lead_id ? (
                      <Link href={`/leads/${item.lead_id}` as never} className="btn btn--primary">
                        Ouvrir le lead <Icon name="arrowRight" />
                      </Link>
                    ) : (
                      <span className="btn">Lead —</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="rev-aside">
          <div className="rev-aside__card">
            <div className="rev-aside__t">Vue d&apos;ensemble</div>
            <div className="rev-breakdown">
              <BreakdownRow label="Urgents" value={urgentCount} dot="red" />
              <BreakdownRow label="Élevés" value={highCount} dot="amber" />
              <BreakdownRow label="Actions proposées" value={proposed.length} dot="purple" />
              <BreakdownRow label="Total en attente" value={totalPending} total />
            </div>
          </div>

          <div className="rev-aside__card">
            <div className="rev-aside__t">Actions proposées</div>
            {proposed.length === 0 ? (
              <EmptyCard title="Aucune action proposée" sub="—" compact />
            ) : (
              <ProposedActionsList initial={proposed} />
            )}
          </div>
        </aside>
      </div>
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

function BreakdownRow({ label, value, dot, total }: { label: string; value: number; dot?: "red" | "amber" | "purple"; total?: boolean }) {
  return (
    <div className={`rev-br-row ${total ? "rev-br-row--total" : ""}`}>
      <div className="rev-br-row__l">
        {!total ? <span className={`rev-br-row__dot ${dot ? `rev-br-row__dot--${dot}` : ""}`} /> : null}
        {label}
      </div>
      <span className="rev-br-row__v">{value}</span>
    </div>
  );
}

function UrgencyPill({ urgency }: { urgency: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    urgent: { label: "Urgent", cls: "pill--hot" },
    high: { label: "Élevé", cls: "pill--review" },
    normal: { label: "Normal", cls: "pill--ready" },
    low: { label: "Faible", cls: "pill--cold" },
  };
  const item = cfg[urgency] ?? { label: urgency, cls: "pill--cold" };
  return <span className={`pill ${item.cls}`}><span className="pill__dot" />{item.label}</span>;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("fr-CA", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    arrowLeft: <path d="M19 12H5M11 18l-6-6 6-6" />,
    arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
    flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
    alert: <path d="M12 9v4M12 17h.01M3 12a9 9 0 1 1 18 0 9 9 0 0 1-18 0z" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
