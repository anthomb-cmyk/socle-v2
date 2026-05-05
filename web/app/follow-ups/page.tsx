import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import CallerAppShell from "@/components/caller/CallerAppShell";
import FollowUpsList from "./FollowUpsList";
import PageHeader from "@/components/page-header";
import Link from "next/link";

export default async function FollowUpsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";

  return (
    <CallerAppShell width="narrow">
      <PageHeader
        title="Suivis"
        subtitle={role === "admin" ? "Tous les suivis en attente." : "Vos suivis assignés."}
      >
        <Link href="/calendar" className="crm-btn">Calendrier →</Link>
      </PageHeader>
      <FollowUpsList />
    </CallerAppShell>
  );
}
