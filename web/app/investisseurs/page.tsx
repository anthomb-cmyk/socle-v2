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
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Investisseurs</h1>
          <p className="text-sm text-zinc-500">
            Partenaires capitaux, appels et deals en cours.
          </p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link
            href={"/investisseurs/nouveau" as never}
            className="border border-zinc-300 rounded-lg px-3 py-1.5 bg-zinc-900 text-white hover:bg-zinc-800"
          >
            + Nouvel investisseur
          </Link>
        </nav>
      </header>
      <InvestorsTable />
    </main>
  );
}
