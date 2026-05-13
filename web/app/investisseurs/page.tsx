import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import InvestorsTable from "./InvestorsTable";

type InvestorSummary = {
  topGeographies: string[];
  strategyLabel: string | null;
  strategyCount: number;
  yearsLabel: string | null;
  yearsCount: number;
  activeCount: number;
  prospectCount: number;
  inactiveCount: number;
  totalCount: number;
  dealsLinkedCount: number;
  negotiatingDealsCount: number;
  lastCallAt: string | null;
  lastCallInvestorName: string | null;
};

function relativeDate(iso: string | null): string {
  if (!iso) return "—";
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (diffDays <= 0) return "aujourd’hui";
  if (diffDays === 1) return "hier";
  return `il y a ${diffDays}j`;
}

function splitTags(value: string | null): string[] {
  if (!value) return [];
  return value.split(/[,;|]/).map((part) => part.trim()).filter(Boolean);
}

function strategyFromText(text: string): string | null {
  if (/optim|value.?add|r[ée]no|stabilis|redresse|upside|densif/i.test(text)) return "Optimisation";
  if (/long.?term|long terme|hold|conserver|patrimoine|cash.?flow/i.test(text)) return "Long terme";
  return null;
}

function yearsFromText(text: string): string | null {
  const matches = Array.from(text.matchAll(/\b(19[4-9]\d|20[0-2]\d)(?:\s*(?:-|–|à|a|to)\s*(19[4-9]\d|20[0-2]\d))?\b/gi));
  if (matches.length === 0) return null;
  return matches
    .slice(0, 2)
    .map((match) => (match[2] ? `${match[1]}–${match[2]}` : match[1]))
    .join(", ");
}

async function getInvestorSummary(): Promise<InvestorSummary> {
  const sb = createSupabaseAdminClient();
  const [investorsRes, dealsRes, callsRes] = await Promise.all([
    sb.from("investors").select("id, full_name, status, preferred_geography, asset_class_focus, notes"),
    sb.from("investor_deals").select("investor_id, stage"),
    sb.from("investor_calls").select("investor_id, created_at, started_at, recorded_at").order("created_at", { ascending: false }).limit(1),
  ]);

  const investors = investorsRes.data ?? [];
  const deals = dealsRes.data ?? [];
  const lastCall = callsRes.data?.[0] ?? null;
  const negotiationStages = new Set(["discussing", "loi", "due_diligence", "financing"]);
  const geoCounts = new Map<string, number>();
  const strategyCounts = new Map<string, number>();
  let yearsCount = 0;
  const yearsLabels: string[] = [];

  for (const investor of investors) {
    for (const geo of splitTags(investor.preferred_geography)) {
      geoCounts.set(geo, (geoCounts.get(geo) ?? 0) + 1);
    }
    const combined = [investor.asset_class_focus, investor.notes].filter(Boolean).join(" ");
    const strategy = strategyFromText(combined);
    if (strategy) strategyCounts.set(strategy, (strategyCounts.get(strategy) ?? 0) + 1);
    const years = yearsFromText(combined);
    if (years) {
      yearsCount += 1;
      yearsLabels.push(years);
    }
  }
  const topGeographies = Array.from(geoCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([geo]) => geo);
  const topStrategy = Array.from(strategyCounts.entries()).sort((a, b) => b[1] - a[1])[0] ?? null;

  return {
    topGeographies,
    strategyLabel: topStrategy?.[0] ?? null,
    strategyCount: Array.from(strategyCounts.values()).reduce((sum, count) => sum + count, 0),
    yearsLabel: yearsLabels[0] ?? null,
    yearsCount,
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
            {summary.totalCount} partenaire{summary.totalCount !== 1 ? "s" : ""} · critères d’achat, zones et thèse d’investissement
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
          <div className="inv-pf__l">Où il achète</div>
          <div className="inv-pf__tags">
            {summary.topGeographies.length > 0
              ? summary.topGeographies.map((geo) => <span key={geo} className="inv-pf__tag">{geo}</span>)
              : <span className="inv-pf__v inv-pf__v--small">—</span>}
          </div>
          <div className="inv-pf__sub">géographies préférées</div>
        </div>
        <div className="inv-pf">
          <div className="inv-pf__l">Thèse dominante</div>
          <div className="inv-pf__v inv-pf__v--small">{summary.strategyLabel ?? "—"}</div>
          <div className="inv-pf__sub">{summary.strategyCount} profil{summary.strategyCount !== 1 ? "s" : ""} renseigné{summary.strategyCount !== 1 ? "s" : ""}</div>
        </div>
        <div className="inv-pf">
          <div className="inv-pf__l">Années ciblées</div>
          <div className="inv-pf__v inv-pf__v--small">{summary.yearsLabel ?? "—"}</div>
          <div className="inv-pf__sub">{summary.yearsCount} profil{summary.yearsCount !== 1 ? "s" : ""} avec années</div>
        </div>
        <div className="inv-pf">
          <div className="inv-pf__l">Actifs</div>
          <div className="inv-pf__v">{summary.activeCount}<span style={{ fontSize: 13, color: "var(--ink-3)", fontFamily: "var(--font)" }}> / {summary.totalCount}</span></div>
          <div className="inv-pf__sub">{summary.prospectCount} prospects · {summary.inactiveCount} inactifs</div>
        </div>
        <div className="inv-pf">
          <div className="inv-pf__l">Deals liés</div>
          <div className="inv-pf__v">{summary.dealsLinkedCount}</div>
          <div className="inv-pf__sub">{summary.negotiatingDealsCount} en négociation · appel {relativeDate(summary.lastCallAt)} {summary.lastCallInvestorName ? `· ${summary.lastCallInvestorName}` : ""}</div>
        </div>
      </section>
      <InvestorsTable />
    </main>
  );
}
