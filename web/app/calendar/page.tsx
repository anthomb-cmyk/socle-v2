import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import CalendarClient from "./CalendarClient";

export type CalendarFollowUp = {
  id: string; lead_id: string | null; due_at: string; note: string;
  priority: number; status: string; source: string | null;
  lead: {
    full_name: string | null; company_name: string | null;
    address: string; city: string | null; best_phone: string | null;
  } | null;
};

export default async function CalendarPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";

  const sb = createSupabaseAdminClient();
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  // Show up to 30 days ahead
  const windowEnd  = new Date(todayStart); windowEnd.setDate(windowEnd.getDate() + 30);

  // Fetch pending follow-ups (overdue + next 30 days) in one query
  let q = sb
    .from("follow_ups")
    .select("id, lead_id, due_at, note, priority, status, source")
    .eq("status", "pending")
    .lte("due_at", windowEnd.toISOString())
    .order("due_at", { ascending: true })
    .limit(500);

  if (role !== "admin") q = q.eq("assigned_to", user.id);

  const { data: rawFu } = await q;
  const rows = (rawFu ?? []) as Array<{
    id: string; lead_id: string | null; due_at: string; note: string;
    priority: number; status: string; source: string | null;
  }>;

  // Hydrate with lead info
  const leadIds = [...new Set(rows.map(r => r.lead_id).filter(Boolean) as string[])];
  let leadInfo: Record<string, CalendarFollowUp["lead"]> = {};
  if (leadIds.length > 0) {
    const { data: leads } = await sb
      .from("leads_view")
      .select("lead_id, full_name, company_name, address, city, best_phone")
      .in("lead_id", leadIds);
    leadInfo = Object.fromEntries(
      ((leads ?? []) as Array<{ lead_id: string } & NonNullable<CalendarFollowUp["lead"]>>)
        .map(l => [l.lead_id, { full_name: l.full_name, company_name: l.company_name, address: l.address, city: l.city, best_phone: l.best_phone }])
    );
  }

  const followUps: CalendarFollowUp[] = rows.map(r => ({
    ...r,
    lead: r.lead_id ? (leadInfo[r.lead_id] ?? null) : null,
  }));

  const overdue  = followUps.filter(f => new Date(f.due_at) < todayStart);
  const todayFu  = followUps.filter(f => {
    const d = new Date(f.due_at);
    return d >= todayStart && d < todayEnd;
  });
  const upcoming = followUps.filter(f => new Date(f.due_at) >= todayEnd);

  // Group upcoming by YYYY-MM-DD date key
  const upcomingByDate: Record<string, CalendarFollowUp[]> = {};
  for (const f of upcoming) {
    const key = f.due_at.slice(0, 10);
    if (!upcomingByDate[key]) upcomingByDate[key] = [];
    upcomingByDate[key].push(f);
  }

  const total = overdue.length + todayFu.length + upcoming.length;

  return (
    <main className="crm-page-narrow" style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
        <div>
          <h1 className="crm-page-title">Calendrier</h1>
          <p className="crm-page-sub">
            {total === 0
              ? "Aucun suivi prévu dans les 30 prochains jours."
              : <>
                  {total} suivi{total > 1 ? "s" : ""} en attente
                  {overdue.length > 0 && <> &middot; <strong style={{ color: "var(--crm-red)" }}>{overdue.length} en retard</strong></>}
                  {todayFu.length > 0 && <> &middot; <strong style={{ color: "var(--crm-amber)" }}>{todayFu.length} aujourd&rsquo;hui</strong></>}
                  {upcoming.length > 0 && <> &middot; {upcoming.length} à venir</>}
                </>
            }
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/follow-ups" className="crm-btn">Vue liste</Link>
          <Link href="/leads" className="crm-btn crm-btn-dark">Leads</Link>
        </div>
      </div>

      {total === 0 ? (
        <div className="crm-card">
          <div className="crm-empty-state">
            
            <p className="crm-empty-state-title">Calendrier vide</p>
            <p className="crm-empty-state-sub">Aucun suivi prévu dans les 30 prochains jours. Bon travail !</p>
          </div>
        </div>
      ) : (
        <CalendarClient
          overdue={overdue}
          today={todayFu}
          upcomingByDate={upcomingByDate}
        />
      )}
    </main>
  );
}
