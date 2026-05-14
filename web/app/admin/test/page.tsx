import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import TestPanel from "./TestPanel";

export const dynamic = "force-dynamic";

export default async function TestChecklistPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as string;
  if (role !== "admin") redirect("/leads");

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">System readiness</h1>
        <p className="text-sm text-zinc-500">
          Single-page check of migrations, env, JWT, and seed data. Click any failed/warning row to see how to fix it.
        </p>
      </header>
      <TestPanel />
    </main>
  );
}
