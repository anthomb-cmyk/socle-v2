import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import UsersTable from "./UsersTable";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as string;
  if (role !== "admin") redirect("/leads");

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-zinc-500">
          Manage roles, activate/deactivate accounts, link Telegram. Changes to <code>role</code>
          {" "}only take effect after the user signs out and back in (refreshes their JWT).
        </p>
      </header>
      <UsersTable />
    </main>
  );
}
