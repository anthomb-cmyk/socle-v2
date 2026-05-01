import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import NewLeadForm from "./NewLeadForm";

export default async function NewLeadPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  const sb = createSupabaseAdminClient();
  const [campaignsRes, usersRes] = await Promise.all([
    sb.from("campaigns").select("id, name, city").is("archived_at", null).order("name"),
    sb.from("users_meta").select("user_id, display_name, role"),
  ]);

  const campaigns = (campaignsRes.data ?? []) as Array<{ id: string; name: string; city: string | null }>;
  const users = (usersRes.data ?? []) as Array<{ user_id: string; display_name: string | null; role: string }>;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Add lead manually</h1>
        <p className="text-sm text-zinc-500 mt-1">
          For one-off leads not coming from a rôle import or email triage.
          Phone and email are optional — you can send the lead to enrichment after creation.
        </p>
      </header>
      <NewLeadForm campaigns={campaigns} users={users} />
    </main>
  );
}
