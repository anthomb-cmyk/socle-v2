import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import CalendarClient from "./CalendarClient";

export type CalendarFollowUp = {
  id: string; lead_id: string | null; due_at: string; note: string;
  priority: number; status: string; source: string | null;
  sync_status: string | null; sync_target: string | null;
  gcal_event_id: string | null; gcal_calendar_id: string | null;
  sync_error: string | null; last_synced_at: string | null;
  lead: {
    full_name: string | null; company_name: string | null;
    address: string; city: string | null; best_phone: string | null;
  } | null;
};

export type CalendarGoogleEvent = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  html_link: string | null;
  location: string | null;
};

export default async function CalendarPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: { session } } = await supabase.auth.getSession();
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";

  const sb = createSupabaseAdminClient();
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  const windowStart = new Date(todayStart); windowStart.setDate(windowStart.getDate() - 14);
  const windowEnd  = new Date(todayStart); windowEnd.setDate(windowEnd.getDate() + 45);

  // Fetch pending follow-ups (overdue + next 30 days) in one query
  let q = sb
    .from("follow_ups")
    .select("id, lead_id, due_at, note, priority, status, source, sync_status, sync_target, gcal_event_id, gcal_calendar_id, sync_error, last_synced_at")
    .eq("status", "pending")
    .gte("due_at", windowStart.toISOString())
    .lte("due_at", windowEnd.toISOString())
    .order("due_at", { ascending: true })
    .limit(500);

  if (role !== "admin") q = q.eq("assigned_to", user.id);

  const { data: rawFu } = await q;
  const rows = (rawFu ?? []) as Array<{
    id: string; lead_id: string | null; due_at: string; note: string;
    priority: number; status: string; source: string | null;
    sync_status: string | null; sync_target: string | null;
    gcal_event_id: string | null; gcal_calendar_id: string | null;
    sync_error: string | null; last_synced_at: string | null;
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
  const total = overdue.length + todayFu.length + upcoming.length;
  const google = await fetchGoogleCalendarEvents(session?.provider_token ?? null, windowStart, windowEnd);

  return (
    <main className="cal-page">
      <header className="cal-head">
        <div>
          <div className="cal-eyebrow">Google Calendar · suivis CRM</div>
          <h1 className="cal-title">Calendrier</h1>
          <p className="cal-sub">
            {total === 0
              ? "Aucun suivi prévu dans la fenêtre active."
              : <>
                  {total} suivi{total > 1 ? "s" : ""} en attente
                  {overdue.length > 0 && <> &middot; <strong>{overdue.length} en retard</strong></>}
                  {todayFu.length > 0 && <> &middot; {todayFu.length} aujourd&rsquo;hui</>}
                  {upcoming.length > 0 && <> &middot; {upcoming.length} à venir</>}
                </>
            }
          </p>
        </div>
        <div className="cal-head__actions">
          <Link href="/leads" className="btn">Leads</Link>
          <Link href="/calls/queue" className="btn btn--gold">File d&apos;appels</Link>
        </div>
      </header>

      <CalendarClient
        followUps={followUps}
        googleEvents={google.events}
        googleConnected={google.connected}
        googleError={google.error}
      />
    </main>
  );
}

async function fetchGoogleCalendarEvents(
  accessToken: string | null,
  windowStart: Date,
  windowEnd: Date,
): Promise<{ connected: boolean; error: string | null; events: CalendarGoogleEvent[] }> {
  if (!accessToken) return { connected: false, error: null, events: [] };
  const params = new URLSearchParams({
    timeMin: windowStart.toISOString(),
    timeMax: windowEnd.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "120",
  });
  try {
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      next: { revalidate: 0 },
    });
    if (!response.ok) return { connected: true, error: `Google Calendar: ${response.status}`, events: [] };
    const json = await response.json() as {
      items?: Array<{
        id: string;
        summary?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        htmlLink?: string;
        location?: string;
      }>;
    };
    const events = (json.items ?? [])
      .map((event) => ({
        id: event.id,
        title: event.summary ?? "Sans titre",
        starts_at: event.start?.dateTime ?? `${event.start?.date ?? ""}T00:00:00`,
        ends_at: event.end?.dateTime ?? (event.end?.date ? `${event.end.date}T00:00:00` : null),
        html_link: event.htmlLink ?? null,
        location: event.location ?? null,
      }))
      .filter((event) => event.starts_at !== "T00:00:00");
    return { connected: true, error: null, events };
  } catch (err) {
    return { connected: true, error: err instanceof Error ? err.message : "Google Calendar indisponible", events: [] };
  }
}
