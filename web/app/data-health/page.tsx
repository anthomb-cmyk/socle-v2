import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export default async function DataHealthPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role !== "admin") redirect("/leads");

  const sb = createSupabaseAdminClient();
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const dayAgo = new Date(now); dayAgo.setDate(dayAgo.getDate() - 1);

  // All counts in parallel.
  const [
    unassignedHot,
    propsNoOwners,
    contactsNoPhones,
    failedAuto,
    failedImports,
    overdueFu,
    pendingProposed,
    openReviews,
    syncErrors,
    contactsAll,
    phonesAll,
    leadsAll,
    stuckPending,
    stuckRunning,
    pendingEnrichResults,
  ] = await Promise.all([
    sb.from("leads").select("id", { count: "exact", head: true })
      .in("status", ["in_outreach", "meeting_set", "qualified"])
      .is("assigned_to", null),
    sb.from("properties").select("id", { count: "exact", head: true })
      .not("id", "in", `(select property_id from property_contacts where relationship='owner')`),
    sb.from("contacts").select("id", { count: "exact", head: true })
      .not("id", "in", `(select contact_id from phones where contact_id is not null)`),
    sb.from("automation_events").select("id", { count: "exact", head: true })
      .eq("status", "failed").gte("occurred_at", dayAgo.toISOString()),
    sb.from("import_jobs").select("id", { count: "exact", head: true }).eq("status", "failed"),
    sb.from("follow_ups").select("id", { count: "exact", head: true })
      .eq("status", "pending").lt("due_at", todayStart.toISOString()),
    sb.from("proposed_actions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("review_items").select("id", { count: "exact", head: true }).eq("status", "open"),
    sb.from("follow_ups").select("id", { count: "exact", head: true }).eq("sync_status", "error"),
    sb.from("contacts").select("id"),
    sb.from("phones").select("contact_id").not("contact_id", "is", null),
    sb.from("leads").select("id, contact_id"),
    // Stuck enrichment jobs
    sb.from("enrichment_jobs").select("id", { count: "exact", head: true })
      .eq("status", "pending").lt("created_at", new Date(Date.now() - 30 * 60_000).toISOString()),
    sb.from("enrichment_jobs").select("id", { count: "exact", head: true })
      .eq("status", "running").lt("started_at", new Date(Date.now() - 60 * 60_000).toISOString()),
    sb.from("enrichment_results").select("id", { count: "exact", head: true }).eq("status", "unverified"),
  ]);

  // Compute "leads without any phone" client-side from the parallel pulls
  const phonesByContact = new Set(((phonesAll.data ?? []) as Array<{ contact_id: string | null }>).map(p => p.contact_id).filter(Boolean) as string[]);
  const leadsNoPhone = ((leadsAll.data ?? []) as Array<{ id: string; contact_id: string }>).filter(l => !phonesByContact.has(l.contact_id)).length;

  const totals = {
    contacts: (contactsAll.data ?? []).length,
    leads: (leadsAll.data ?? []).length,
  };

  // Sample 5 of the most recent failures to show inline
  const { data: recentFailures } = await sb.from("automation_events")
    .select("id, source, event_type, error_message, occurred_at, related_lead_id")
    .eq("status", "failed")
    .order("occurred_at", { ascending: false })
    .limit(5);
  const failureList = (recentFailures ?? []) as Array<{ id: string; source: string; event_type: string; error_message: string | null; occurred_at: string; related_lead_id: string | null }>;

  const sections = [
    { title: "Unassigned hot leads", count: unassignedHot.count ?? 0, link: "/leads?status=in_outreach", help: "Leads marked in_outreach/meeting_set/qualified but with no caller assigned." },
    { title: "Leads without a phone", count: leadsNoPhone, link: "/leads", help: "Lead's contact has zero phone numbers on file. Need enrichment." },
    { title: "Properties without owners", count: propsNoOwners.count ?? 0, link: "/properties", help: "Property exists but no property_contacts row with relationship='owner'." },
    { title: "Contacts without phones", count: contactsNoPhones.count ?? 0, link: "/contacts", help: "Contact has no phone records — un-callable until enriched." },
    { title: "Overdue follow-ups", count: overdueFu.count ?? 0, link: "/follow-ups?bucket=overdue", help: "Pending follow-ups whose due_at is before today." },
    { title: "Pending proposed actions", count: pendingProposed.count ?? 0, link: "/review", help: "AI/Telegram-proposed actions waiting for Anthony to approve or reject." },
    { title: "Open review items", count: openReviews.count ?? 0, link: "/review", help: "Hot-seller submissions and other inbox items not yet resolved." },
    { title: "Failed automations (24h)", count: failedAuto.count ?? 0, link: "/admin/events?status=failed", help: "Anything that posted automation_events.status='failed' in the last day." },
    { title: "Failed imports", count: failedImports.count ?? 0, link: "/import", help: "import_jobs rows in the failed state." },
    { title: "Calendar/Task sync errors", count: syncErrors.count ?? 0, link: "/follow-ups", help: "Follow-ups with sync_status='error' — n8n couldn't push to Google." },
    { title: "Stuck enrichment jobs", count: (stuckPending.count ?? 0) + (stuckRunning.count ?? 0), link: "/admin/enrichment", help: "Jobs queued > 30 min or running > 60 min. Likely n8n didn't pick up the trigger." },
    { title: "Pending enrichment review", count: pendingEnrichResults.count ?? 0, link: "/admin/enrichment", help: "Phone/email/website findings from n8n waiting for Anthony to approve or reject." },
  ];

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Data health</h1>
        <p className="text-sm text-zinc-500">
          Across {totals.contacts} contacts and {totals.leads} leads, here&apos;s what needs attention.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {sections.map(s => {
          const isHot = s.count > 0;
          return (
            <Link key={s.title} href={s.link as never}
              className={`block rounded-2xl p-4 border transition ${isHot ? "bg-amber-50 border-amber-200 hover:border-amber-400" : "bg-white border-zinc-200 hover:border-zinc-400"}`}>
              <div className="flex justify-between items-start gap-2">
                <h2 className="text-sm font-semibold">{s.title}</h2>
                <span className={`text-2xl font-semibold ${isHot ? "text-amber-900" : "text-zinc-300"}`}>{s.count}</span>
              </div>
              <p className="text-xs text-zinc-500 mt-1">{s.help}</p>
            </Link>
          );
        })}
      </div>

      {failureList.length > 0 && (
        <section className="bg-white rounded-2xl border border-zinc-200 p-4">
          <h2 className="text-sm font-semibold text-zinc-700 mb-3">Most recent failures</h2>
          <ul className="space-y-2 text-sm">
            {failureList.map(f => (
              <li key={f.id} className="border-l-2 border-red-200 pl-3">
                <div className="text-xs uppercase tracking-wide text-zinc-500">{f.source} · {f.event_type}</div>
                <div className="text-red-700">{f.error_message ?? "(no message)"}</div>
                <div className="text-xs text-zinc-400 flex gap-3">
                  <span>{new Date(f.occurred_at).toLocaleString()}</span>
                  {f.related_lead_id && <Link href={`/leads/${f.related_lead_id}` as never} className="underline">Open lead →</Link>}
                  <Link href="/admin/events?status=failed" className="underline">View all failures →</Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
