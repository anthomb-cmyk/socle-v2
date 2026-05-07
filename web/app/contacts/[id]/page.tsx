import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export default async function ContactDetailPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as string;
  // Contacts page is admin-only — non-admin roles get redirected to /leads
  if (role !== "admin") redirect("/leads");

  const sb = createSupabaseAdminClient();
  const [contactRes, phonesRes, leadsRes, propLinksRes, callsRes, fupsRes, eventsRes] = await Promise.all([
    sb.from("contacts").select("*").eq("id", id).single(),
    sb.from("phones").select("id, e164, display, status, source, confidence, evidence")
      .eq("contact_id", id).order("confidence", { ascending: false }),
    sb.from("leads_view").select("*").eq("contact_id", id),
    sb.from("property_contacts").select("property_id, relationship, share_pct").eq("contact_id", id),
    sb.from("call_logs").select("id, outcome, recorded_at, lead_id, notes").eq("contact_id", id).order("recorded_at", { ascending: false }).limit(10),
    sb.from("follow_ups").select("id, due_at, note, status, lead_id").eq("contact_id", id).order("due_at", { ascending: false }).limit(10),
    sb.from("automation_events").select("id, source, event_type, status, occurred_at").eq("related_contact_id", id).order("occurred_at", { ascending: false }).limit(20),
  ]);

  const contact = contactRes.data as Record<string, unknown> | null;
  if (!contact) return notFound();

  const phones = (phonesRes.data ?? []) as Array<{ id: string; e164: string; display: string | null; status: string; source: string; confidence: number; evidence: string | null }>;
  const leads = (leadsRes.data ?? []) as Array<{ lead_id: string; full_name: string | null; company_name: string | null; address: string; city: string | null; status: string }>;
  const propLinks = (propLinksRes.data ?? []) as Array<{ property_id: string; relationship: string; share_pct: number | null }>;

  // Hydrate property addresses
  let propMap: Record<string, { address: string; city: string | null }> = {};
  if (propLinks.length > 0) {
    const ids = propLinks.map(p => p.property_id);
    const { data } = await sb.from("properties").select("id, address, city").in("id", ids);
    propMap = Object.fromEntries(((data ?? []) as Array<{ id: string; address: string; city: string | null }>).map(p => [p.id, p]));
  }

  const calls = (callsRes.data ?? []) as Array<{ id: string; outcome: string | null; recorded_at: string | null; lead_id: string | null; notes: string | null }>;
  const fups = (fupsRes.data ?? []) as Array<{ id: string; due_at: string; note: string | null; status: string; lead_id: string | null }>;
  const events = (eventsRes.data ?? []) as Array<{ id: string; source: string; event_type: string; status: string; occurred_at: string }>;

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <Link href="/contacts" className="text-sm text-zinc-500 hover:underline">← Back to contacts</Link>
      <header>
        <h1 className="text-2xl font-semibold">{(contact.full_name as string) ?? (contact.company_name as string) ?? "—"}</h1>
        <p className="text-sm text-zinc-500">{contact.kind as string}{contact.mailing_city ? ` · ${contact.mailing_city}` : ""}</p>
      </header>

      <Panel title="Contact info">
        <dl className="grid grid-cols-2 gap-y-1 gap-x-4 text-sm">
          <Dt>Email</Dt><Dd>{(contact.primary_email as string) ?? "—"}</Dd>
          <Dt>Website</Dt><Dd>{(contact.primary_website as string) ?? "—"}</Dd>
          <Dt>Mailing</Dt><Dd className="col-span-1">{[contact.mailing_address, contact.mailing_city, contact.mailing_postal].filter(Boolean).join(", ") || "—"}</Dd>
        </dl>
      </Panel>

      <Panel title={`Phones (${phones.length})`}>
        {phones.length === 0 ? <p className="text-zinc-400 text-sm">No phones on file.</p> : (
          <ul className="text-sm space-y-1">
            {phones.map(p => (
              <li key={p.id} className="flex justify-between">
                <span className="font-mono">{p.display ?? p.e164}</span>
                <span className="text-xs text-zinc-500">{p.status} · {p.source} · conf {p.confidence}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Linked properties (${propLinks.length})`}>
        {propLinks.length === 0 ? <p className="text-zinc-400 text-sm">No properties linked.</p> : (
          <ul className="text-sm space-y-1">
            {propLinks.map(l => (
              <li key={l.property_id} className="flex justify-between">
                <Link href={`/properties/${l.property_id}` as never} className="hover:underline">
                  {propMap[l.property_id]?.address ?? "—"}{propMap[l.property_id]?.city ? `, ${propMap[l.property_id].city}` : ""}
                </Link>
                <span className="text-xs text-zinc-500">{l.relationship}{l.share_pct ? ` · ${l.share_pct}%` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Leads (${leads.length})`}>
        {leads.length === 0 ? <p className="text-zinc-400 text-sm">No leads.</p> : (
          <ul className="text-sm space-y-1">
            {leads.map(l => (
              <li key={l.lead_id} className="flex justify-between">
                <Link href={`/leads/${l.lead_id}` as never} className="hover:underline">
                  {l.address}{l.city ? `, ${l.city}` : ""}
                </Link>
                <span className="text-xs text-zinc-500">{l.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={`Calls (${calls.length})`}>
          {calls.length === 0 ? <p className="text-zinc-400 text-sm">No calls.</p> : (
            <ul className="space-y-2 text-sm">
              {calls.map(c => (
                <li key={c.id} className="border-l-2 border-zinc-200 pl-3">
                  <div className="font-medium">{c.outcome ?? "—"}</div>
                  <div className="text-xs text-zinc-500">{c.recorded_at ? new Date(c.recorded_at).toLocaleString() : ""}</div>
                  {c.notes && <div className="text-zinc-700 mt-1 whitespace-pre-wrap">{c.notes}</div>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Follow-ups (${fups.length})`}>
          {fups.length === 0 ? <p className="text-zinc-400 text-sm">No follow-ups.</p> : (
            <ul className="space-y-2 text-sm">
              {fups.map(f => (
                <li key={f.id} className="border-l-2 border-zinc-200 pl-3">
                  <div className="font-medium">{new Date(f.due_at).toLocaleString("fr-CA", { dateStyle: "short", timeStyle: "short" })} · {f.status}</div>
                  {f.note && <div className="text-zinc-700 mt-1 whitespace-pre-wrap">{f.note}</div>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <Panel title={`Recent events (${events.length})`}>
        {events.length === 0 ? <p className="text-zinc-400 text-sm">No events for this contact.</p> : (
          <ul className="space-y-1 text-xs">
            {events.map(e => (
              <li key={e.id} className="flex gap-3">
                <span className="text-zinc-400 font-mono whitespace-nowrap">{new Date(e.occurred_at).toLocaleString()}</span>
                <span className="font-medium">{e.source}/{e.event_type}</span>
                <span className={e.status === "failed" ? "text-red-600" : "text-zinc-500"}>{e.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-zinc-200 p-4">
      <h2 className="text-sm font-semibold text-zinc-700 mb-3">{title}</h2>
      {children}
    </section>
  );
}
function Dt({ children }: { children: React.ReactNode }) { return <dt className="text-zinc-500">{children}</dt>; }
function Dd({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <dd className={className}>{children}</dd>; }
