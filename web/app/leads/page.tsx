import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import LeadsTable from "@/components/leads-table";
import PageHeader from "@/components/page-header";
import Link from "next/link";

export default async function LeadsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";

  return (
    <main className="mx-auto max-w-7xl p-6">
      <PageHeader
        title="Leads"
        subtitle={role === "admin" ? "Tous les leads du système." : "Leads qui vous sont assignés."}
      >
        {role === "admin" && (
          <Link href={"/leads/new" as never} className="crm-btn">+ Nouveau lead</Link>
        )}
        {role === "admin" && (
          <Link href="/import" className="crm-btn crm-btn-dark">Import rôle</Link>
        )}
        {role === "admin" && (
          <Link href={"/review" as never} className="crm-btn">Revue</Link>
        )}
        {role === "caller" && (
          <Link href={"/calls/queue" as never} className="crm-btn crm-btn-dark">File d&rsquo;appels</Link>
        )}
      </PageHeader>
      <LeadsTable canAssign={role === "admin"} />
    </main>
  );
}
