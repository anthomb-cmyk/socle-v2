import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import NewLeadForm from "./NewLeadForm";

export default async function NewLeadPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Add lead manually</h1>
        <p className="text-sm text-zinc-500">For one-off leads not coming from a rôle import or email triage.</p>
      </header>
      <NewLeadForm />
    </main>
  );
}
