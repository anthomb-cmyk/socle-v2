import "./globals.css";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import AppNav from "@/components/app-nav";

export const metadata = {
  title: "Socle CRM",
  description: "Québec multifamily acquisition operating system",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Fetch the current user server-side so the nav can render conditionally.
  // Pages that don't need auth (login, root) still render — they just see no nav.
  let userInfo: { email: string; role: "admin" | "caller" } | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      userInfo = {
        email: user.email ?? "",
        role: (user.app_metadata?.role ?? "caller") as "admin" | "caller",
      };
    }
  } catch {
    // No session, no nav — fine.
  }

  return (
    <html lang="en">
      <body className="bg-zinc-50 text-zinc-900 min-h-screen">
        {userInfo && <AppNav email={userInfo.email} role={userInfo.role} />}
        {children}
      </body>
    </html>
  );
}
