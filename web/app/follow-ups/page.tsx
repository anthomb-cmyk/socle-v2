import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import FollowUpsList from "./FollowUpsList";

export default async function FollowUpsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Follow-ups</h1>
        <p className="text-sm text-zinc-500">
          {role === "admin" ? "All pending follow-ups." : "Your assigned follow-ups."}
        </p>
      </header>
      <FollowUpsList />
    </main>
  );
}
