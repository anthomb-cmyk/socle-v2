import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import LettersClient from "./LettersClient";

export default async function LettersPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  return (
    <main className="letters-page">
      <header className="letters-head">
        <div>
          <div className="letters-head__crumb">Publipostage · retours d’appels</div>
          <h1 className="letters-head__title">Letters</h1>
          <p className="letters-head__sub">
            Recherche souple par nom, compagnie, adresse postale, immeuble ou matricule.
          </p>
        </div>
      </header>
      <LettersClient />
    </main>
  );
}
