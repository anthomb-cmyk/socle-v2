import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import ContactsTable from "./ContactsTable";

export default async function ContactsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-sm text-zinc-500">People and entities in the system.</p>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href="/properties" className="border border-zinc-300 rounded-lg px-3 py-1.5">Properties</Link>
          <Link href="/leads" className="border border-zinc-300 rounded-lg px-3 py-1.5">Leads</Link>
        </nav>
      </header>
      <ContactsTable />
    </main>
  );
}
