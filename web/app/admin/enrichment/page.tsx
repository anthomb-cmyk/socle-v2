import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import EnrichmentDashboard from "./EnrichmentDashboard";

export default async function EnrichmentPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as string;
  if (role !== "admin") redirect("/leads");

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Enrichment</h1>
        <p className="text-sm text-zinc-500">All enrichment jobs and pending results across the system.</p>
      </header>
      <EnrichmentDashboard />
    </main>
  );
}
