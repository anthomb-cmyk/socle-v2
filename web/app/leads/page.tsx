import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import LeadsTable from "@/components/leads-table";
import Link from "next/link";

export default async function LeadsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";

  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-zinc-500">
            {role === "admin" ? "All leads in the system." : "Leads assigned to you."}
            {" "}Signed in as {user.email}{role === "admin" && <> · <span className="text-zinc-400">admin</span></>}.
          </p>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          {role === "admin" && <Link href={"/leads/new" as never} className="border border-zinc-300 rounded-lg px-3 py-1.5">+ New lead</Link>}
          {role === "admin" && <Link href="/import" className="bg-zinc-900 text-white rounded-lg px-3 py-1.5">Import a rôle</Link>}
          {role === "admin" && <Link href={"/review" as never} className="border border-zinc-300 rounded-lg px-3 py-1.5">Review</Link>}
          {role === "caller" && <Link href={"/calls/queue" as never} className="bg-zinc-900 text-white rounded-lg px-3 py-1.5">Call queue</Link>}
        </nav>
      </header>
      <LeadsTable canAssign={role === "admin"} />
    </main>
  );
}
