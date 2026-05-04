import "./globals.css";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import AppSidebar from "@/components/app-sidebar";

export const metadata = {
  title: "Socle CRM",
  description: "Québec multifamily acquisition operating system",
};

type RecentLead = {
  lead_id: string;
  full_name: string | null;
  company_name: string | null;
  priority: number | null;
  status: string;
};

type RecentDeal = {
  id: string;
  title: string;
  stage: string;
  temperature: string;
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let userInfo: { id: string; email: string; role: "admin" | "caller" } | null = null;
  let recentLeads: RecentLead[] = [];
  let recentDeals: RecentDeal[] = [];

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      userInfo = {
        id: user.id,
        email: user.email ?? "",
        role: (user.app_metadata?.role ?? "caller") as "admin" | "caller",
      };

      // Fetch recent leads for sidebar recent-leads section
      try {
        const sb = createSupabaseAdminClient();
        const q = sb
          .from("leads_view")
          .select("lead_id,full_name,company_name,priority,status")
          .order("updated_at", { ascending: false })
          .limit(6);
        if (userInfo.role === "caller") {
          q.eq("assigned_to", user.id);
        }
        const { data } = await q;
        recentLeads = (data ?? []) as RecentLead[];
      } catch {
        // Non-critical — sidebar still renders without recent leads
      }

      // Fetch recent deals for sidebar (admin only)
      if (userInfo.role === "admin") {
        try {
          const sbAdmin = createSupabaseAdminClient();
          const { data: dealData } = await sbAdmin
            .from("deals")
            .select("id,title,stage,temperature")
            .not("stage", "in", '("cloture","abandonne")')
            .order("updated_at", { ascending: false })
            .limit(5);
          recentDeals = (dealData ?? []) as RecentDeal[];
        } catch {
          // Non-critical
        }
      }
    }
  } catch {
    // No session — render without sidebar (login page, etc.)
  }

  return (
    <html lang="fr">
      <body style={{ background: "var(--crm-bg)", color: "var(--crm-text)", margin: 0, padding: 0 }}>
        {userInfo ? (
          <div className="crm-shell">
            <AppSidebar
              email={userInfo.email}
              role={userInfo.role}
              recentLeads={recentLeads}
              recentDeals={recentDeals}
            />
            <div className="crm-main-content">
              {children}
            </div>
          </div>
        ) : (
          <div style={{ minHeight: "100vh", background: "var(--crm-bg)" }}>
            {children}
          </div>
        )}
      </body>
    </html>
  );
}
