import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import SeedActions from "./SeedActions";

export const dynamic = "force-dynamic";

export default async function SeedPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Seed test data</h1>
        <p className="text-sm text-zinc-500">
          One-click seeders so you don&rsquo;t need the browser console. Each calls a `/api/dev/seed-*` endpoint.
        </p>
      </header>
      <SeedActions />
    </main>
  );
}
