import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import InvestorsTable from "./InvestorsTable";

type InvestorSummary = {
  capitalTotalCad: number;
  ticketAverageCad: number | null;
  activeCount: number;
  prospectCount: number;
  inactiveCount: number;
  totalCount: number;
  dealsLinkedCount: number;
  negotiatingDealsCount: number;
  lastCallAt: string | null;
  lastCallInvestorName: string | null;
};

function formatMoney(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n.toLocaleString("fr-CA")}`;
}

function relativeDate(iso: string | null): string {
  if (!iso) return "—";
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (diffDays <= 0) return "aujourd’hui";
  if (diffDays === 1) return "hier";
  return `il y a ${diffDays}j`;
}

async function getInvestorSummary(): Promise<InvestorSummary> {
  const sb = createSupabaseAdminClient();
  const [investorsRes, dealsRes, callsRes] = await Promise.all([
    sb.from("investors").select("id, full_name, status, capital_available_cad, ticket_size_min_cad, ticket_size_max_cad"),
    sb.from("investor_deals").select("investor_id, stage"),
    sb.from("investor_calls").select("investor_id, created_at, started_at, recorded_at").order("created_at", { ascending: false }).limit(1),
  ]);

  const investors = investorsRes.data ?? [];
  const deals = dealsRes.data ?? [];
  const lastCall = callsRes.data?.[0] ?? null;
  const negotiationStages = new Set(["discussing", "loi", "due_diligence", "financing"]);
  const ticketValues = investors
    .map((investor) => {
      const min = Number(investor.ticket_size_min_cad) || 0;
      const max = Number(investor.ticket_size_max_cad) || 0;
      if (min > 0 && max > 0) return (min + max) / 2;
      return max || min || 0;
    })
    .filter((value) => value > 0);

  return {
    capitalTotalCad: investors.reduce((sum, investor) => sum + (Number(investor.capital_available_cad) || 0), 0),
    ticketAverageCad: ticketValues.length > 0 ? Math.round(ticketValues.reduce((sum, value) => sum + value, 0) / ticketValues.length) : null,
    activeCount: investors.filter((investor) => investor.status === "active").length,
    prospectCount: investors.filter((investor) => investor.status === "prospect").length,
    inactiveCount: investors.filter((investor) => investor.status === "inactive").length,
    totalCount: investors.length,
    dealsLinkedCount: deals.length,
    negotiatingDealsCount: deals.filter((deal) => negotiationStages.has(deal.stage)).length,
    lastCallAt: lastCall?.recorded_at ?? lastCall?.started_at ?? lastCall?.created_at ?? null,
    lastCallInvestorName: investors.find((investor) => investor.id === lastCall?.investor_id)?.full_name ?? null,
  };
}

export default async function InvestorsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");
  const summary = await getInvestorSummary();

  return (
    <main className="inv-main">
      <header className="inv-page-head">
        <div>
          <div className="inv-page-head__crumb">Capital · partenaires</div>
          <h1 className="inv-page-head__t">Investisseurs</h1>
          <p className="inv-page-head__sub">
            {summary.totalCount} partenaire{summary.totalCount !== 1 ? "s" : ""} · capital disponible pour les acquisitions
          </p>
        </div>
        <nav className="inv-page-head__actions">
          <Link
            href={"/investisseurs/nouveau" as never}
            className="btn btn--gold"
          >
            Nouvel investisseur
          </Link>
        </nav>
      </header>
      <section className="inv-portfolio">
        <div className="inv-pf">
          <div className="inv-pf__l">Capital total dispo</div>
          <div className="inv-pf__v">{formatMoney(summary.capitalTotalCad)}</div>
          <div className="inv-pf__sub">somme des profils investisseurs</div>
        </div>
        <div className="inv-pf">
          <div className="inv-pf__l">Ticket moyen</div>
          <div className="inv-pf__v">{formatMoney(summary.ticketAverageCad)}</div>
          <div className="inv-pf__sub">moyenne min/max disponibles</div>
        </div>
        <div className="inv-pf">
          <div className="inv-pf__l">Actifs</div>
          <div className="inv-pf__v">{summary.activeCount}<span style={{ fontSize: 13, color: "var(--ink-3)", fontFamily: "var(--font)" }}> / {summary.totalCount}</span></div>
          <div className="inv-pf__sub">{summary.prospectCount} prospects · {summary.inactiveCount} inactifs</div>
        </div>
        <div className="inv-pf">
          <div className="inv-pf__l">Deals liés</div>
          <div className="inv-pf__v">{summary.dealsLinkedCount}</div>
          <div className="inv-pf__sub">{summary.negotiatingDealsCount} en négociation</div>
        </div>
        <div className="inv-pf">
          <div className="inv-pf__l">Dernier appel</div>
          <div className="inv-pf__v inv-pf__v--small">{relativeDate(summary.lastCallAt)}</div>
          <div className="inv-pf__sub">{summary.lastCallInvestorName ?? "—"}</div>
        </div>
      </section>
      <InvestorsTable />
    </main>
  );
}
