import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import InvestorsTable from "./InvestorsTable";

export default async function InvestorsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  return (
    <main className="socle-page">
      <header className="socle-page-head">
        <div>
          <div className="socle-crumb">Capital partners</div>
          <h1 className="socle-title">Investisseurs</h1>
          <p className="socle-sub">Partenaires capitaux, appels et deals en cours.</p>
        </div>
        <nav className="socle-head-actions">
          <Link
            href={"/investisseurs/nouveau" as never}
            className="btn btn--primary"
          >
            Nouvel investisseur
          </Link>
        </nav>
      </header>
      <section className="kpi-strip">
        <div className="ki ki--hero"><div className="ki__l">Portefeuille</div><div className="ki__v">Actif</div><div className="ki__sub">Capital relationnel</div></div>
        <div className="ki"><div className="ki__l">Focus</div><div className="ki__v">Multi-résidentiel</div><div className="ki__sub">Québec</div></div>
        <div className="ki"><div className="ki__l">Matching</div><div className="ki__v">Deals</div><div className="ki__sub">Pipeline synchronisé</div></div>
        <div className="ki"><div className="ki__l">Cadence</div><div className="ki__v">Appels</div><div className="ki__sub">Notes et suivis</div></div>
      </section>
      <InvestorsTable />
    </main>
  );
}
