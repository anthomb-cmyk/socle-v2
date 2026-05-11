import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";
import LeadDossierClient from "./LeadDossierClient";
import LeadBriefingCard from "@/components/lead-briefing-card";

export default async function LeadDetailPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";

  const sb = createSupabaseAdminClient();
  const { data: leadRaw } = await sb.from("leads_view").select("lead_id,status,priority,assigned_to,campaign_name,campaign_id,address,city,num_units,evaluation_total,contact_kind,full_name,company_name,best_phone,property_id,contact_id,last_contacted_at,next_action_at").eq("lead_id", id).single();
  if (!leadRaw) return notFound();
  const lead = leadRaw as {
    lead_id: string; status: string; priority: number; assigned_to: string | null;
    campaign_name: string | null; campaign_id: string | null;
    address: string; city: string | null; num_units: number | null; evaluation_total: number | null;
    contact_kind: string; full_name: string | null; company_name: string | null;
    best_phone: string | null; property_id: string; contact_id: string;
    last_contacted_at: string | null; next_action_at: string | null;
  };
  if (role !== "admin" && lead.assigned_to !== user.id) return notFound();

  // Check if lead is unsuitable and fetch the failure reason from enrichment events.
  let unsuitable_failures: string[] | null = null;
  if (lead.status === "unsuitable_for_phone_enrichment") {
    try {
      const { data: evtData } = await sb
        .from("enrichment_events")
        .select("payload")
        .eq("lead_id", id)
        .in("event_type", ["preflight_failed", "lead_status_updated"])
        .order("created_at", { ascending: false })
        .limit(5);
      if (evtData) {
        for (const evt of evtData) {
          const p = evt.payload as Record<string, unknown> | null;
          const failures = p?.failures ?? p?.failures;
          if (Array.isArray(failures) && failures.length > 0) {
            unsuitable_failures = failures.map(String);
            break;
          }
        }
      }
    } catch {
      // enrichment_events may not exist yet — fail gracefully
    }
  }

  const [phones, calls, fups, subs, events, propertyRes, contactRes, leadRow, users, enrichJobs, enrichResults] = await Promise.all([
    sb.from("phones").select("id, e164, display, status, source, confidence, evidence, source_column, notes")
      .eq("contact_id", lead.contact_id).order("confidence", { ascending: false }),
    sb.from("call_logs").select("id, outcome, notes, recorded_at, duration_sec, user_id")
      .eq("lead_id", id).order("recorded_at", { ascending: false }).limit(20),
    sb.from("follow_ups").select("id, due_at, note, priority, status, source")
      .eq("lead_id", id).order("due_at", { ascending: true }),
    sb.from("lead_submissions").select("id, outcome, seller_interest_level, timeline, motivation, asking_price, caller_summary, status, submitted_by, created_at")
      .eq("lead_id", id).order("created_at", { ascending: false }),
    sb.from("automation_events").select("id, source, event_type, status, error_message, occurred_at")
      .eq("related_lead_id", id).order("occurred_at", { ascending: false }).limit(20),
    sb.from("properties").select("id,address,city,matricule,year_built,num_units,evaluation_total").eq("id", lead.property_id).single(),
    sb.from("contacts").select("id,kind,full_name,company_name,primary_email,mailing_address,mailing_city,mailing_postal").eq("id", lead.contact_id).single(),
    sb.from("leads").select("notes").eq("id", id).single(),
    sb.from("users_meta").select("user_id, display_name, role"),
    sb.from("enrichment_jobs").select("id, job_type, status, started_at, completed_at, error_message, created_at")
      .eq("lead_id", id).order("created_at", { ascending: false }).limit(10),
    sb.from("enrichment_results").select("id, kind, value, source, source_url, confidence, evidence, status, created_at, found_in_job_id")
      .eq("lead_id", id).order("created_at", { ascending: false }),
  ]);

  // Briefing columns are added by migration 0017. Query separately so a missing
  // column (42703) or missing table (42P01) never breaks the rest of the page.
  let briefingRow: { briefing_text: string | null; briefing_generated_at: string | null } | null = null;
  try {
    const { data: briefingData, error: briefingErr } = await sb
      .from("leads")
      .select("briefing_text, briefing_generated_at")
      .eq("id", id)
      .single();
    if (!briefingErr && briefingData) {
      briefingRow = briefingData as { briefing_text: string | null; briefing_generated_at: string | null };
    }
  } catch {
    // Migration 0017 not yet applied — degrade gracefully, briefing card shows empty state.
  }

  const phonesList = (phones.data ?? []) as Array<{ id: string; e164: string; display: string | null; status: string; source: string; confidence: number; evidence: string | null; source_column: string | null; notes: string | null }>;
  const callsList = (calls.data ?? []) as Array<{ id: string; outcome: string | null; notes: string | null; recorded_at: string | null; duration_sec: number | null; user_id: string | null }>;
  const fupsList = (fups.data ?? []) as Array<{ id: string; due_at: string; note: string | null; priority: number; status: string; source: string | null }>;
  const subsList = (subs.data ?? []) as Array<{ id: string; outcome: string; seller_interest_level: string | null; timeline: string | null; asking_price: number | null; caller_summary: string; status: string; created_at: string }>;
  const eventsList = (events.data ?? []) as Array<{ id: string; source: string; event_type: string; status: string; error_message: string | null; occurred_at: string }>;
  const property = propertyRes.data as Record<string, unknown> | null;
  const contact = contactRes.data as Record<string, unknown> | null;
  const usersList = (users.data ?? []) as Array<{ user_id: string; display_name: string | null; role: string }>;
  const leadNotes = (leadRow.data as { notes: string | null } | null)?.notes ?? "";
  const enrichJobsList = (enrichJobs.data ?? []) as Array<{ id: string; job_type: string; status: string; started_at: string | null; completed_at: string | null; error_message: string | null; created_at: string }>;
  const enrichResultsList = (enrichResults.data ?? []) as Array<{ id: string; kind: string; value: string; source: string; source_url: string | null; confidence: number; evidence: string | null; status: string; created_at: string; found_in_job_id: string | null }>;

  const assignedUser = usersList.find(u => u.user_id === lead.assigned_to);

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/leads" className="text-sm text-zinc-500 hover:underline">← Back to leads</Link>
        <Link href={`/calls/${id}` as never} className="text-sm bg-zinc-900 text-white rounded-lg px-3 py-1.5">Open in caller workspace →</Link>
      </div>

      {unsuitable_failures && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900">
          <strong>Adresse postale incomplète.</strong>{" "}
          {unsuitable_failures.length > 0
            ? `Cette adresse postale est incomplète : ${unsuitable_failures.join(", ")}. Corrigez le fichier source et réimportez.`
            : "Cette adresse postale est incomplète. Corrigez le fichier source et réimportez."}
        </div>
      )}

      <LeadBriefingCard
        leadId={id}
        initialText={briefingRow?.briefing_text ?? null}
        initialGeneratedAt={briefingRow?.briefing_generated_at ?? null}
      />

      <header>
        <h1 className="text-2xl font-semibold">{lead.full_name ?? lead.company_name ?? "—"}</h1>
        <p className="text-zinc-600 text-sm">
          {lead.contact_kind} · {lead.address}{lead.city ? `, ${lead.city}` : ""}
          {lead.num_units != null && <> · {lead.num_units} units</>}
          {lead.evaluation_total != null && <> · eval ${Math.round(lead.evaluation_total / 1000)}k</>}
        </p>
        <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1.5 flex-wrap">
          <LeadStatusPill status={lead.status} />
          <span>· priority: {lead.priority}</span>
          <span>· {assignedUser?.display_name ? `assigned to: ${assignedUser.display_name}` : <span className="text-zinc-400">unassigned</span>}</span>
          {lead.campaign_name && <span>· {lead.campaign_name}</span>}
        </p>
      </header>

      <LeadDossierClient
        leadId={id}
        initialNotes={leadNotes}
        initialStatus={lead.status}
        initialPriority={lead.priority}
        initialAssignedTo={lead.assigned_to}
        users={usersList}
        canEdit={role === "admin"}
        initialEnrichmentJobs={enrichJobsList}
        initialEnrichmentResults={enrichResultsList}
      />

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={`Property`}>
          {property ? (
            <dl className="text-sm grid grid-cols-2 gap-y-1 gap-x-4">
              <Dt>Address</Dt><Dd>{property.address as string}</Dd>
              <Dt>City</Dt><Dd>{(property.city as string) ?? "—"}</Dd>
              <Dt>Matricule</Dt><Dd className="font-mono text-xs">{(property.matricule as string) ?? "—"}</Dd>
              <Dt>Year built</Dt><Dd>{(property.year_built as number) ?? "—"}</Dd>
              <Dt>Units</Dt><Dd>{(property.num_units as number) ?? "—"}</Dd>
              <Dt>Eval total</Dt><Dd>{property.evaluation_total ? `$${Number(property.evaluation_total).toLocaleString()}` : "—"}</Dd>
            </dl>
          ) : <p className="text-zinc-400 text-sm">No property data.</p>}
        </Panel>

        <Panel title="Contact">
          {contact ? (
            <dl className="text-sm grid grid-cols-2 gap-y-1 gap-x-4">
              <Dt>Kind</Dt><Dd>{contact.kind as string}</Dd>
              <Dt>Name</Dt><Dd>{(contact.full_name as string) ?? (contact.company_name as string) ?? "—"}</Dd>
              {contact.primary_email != null && <><Dt>Email</Dt><Dd>{contact.primary_email as string}</Dd></>}
              {contact.mailing_address != null && <><Dt>Mailing</Dt><Dd>{[contact.mailing_address, contact.mailing_city, contact.mailing_postal].filter(Boolean).join(", ")}</Dd></>}
            </dl>
          ) : <p className="text-zinc-400 text-sm">No contact data.</p>}
        </Panel>
      </section>

      <Panel title={`Phones (${phonesList.length})`}>
        {phonesList.length === 0 ? <p className="text-zinc-400 text-sm">No phones on file.</p> : (
          <table className="w-full text-sm">
            <thead className="text-zinc-500 text-xs">
              <tr><th className="text-left pb-2">Number</th><th className="text-left pb-2">Status</th><th className="text-left pb-2">Source</th><th className="text-left pb-2">Conf.</th><th className="text-left pb-2">Evidence</th></tr>
            </thead>
            <tbody>
              {phonesList.map(p => (
                <tr key={p.id} className="border-t border-zinc-100">
                  <td className="py-1.5 font-mono">{p.display ?? p.e164}</td>
                  <td className="py-1.5"><PhoneStatusPill s={p.status} /></td>
                  <td className="py-1.5 text-xs text-zinc-500">{p.source}</td>
                  <td className="py-1.5 text-xs">{p.confidence}</td>
                  <td className="py-1.5 text-xs text-zinc-500">{p.evidence ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={`Call history (${callsList.length})`}>
          {callsList.length === 0 ? <p className="text-zinc-400 text-sm">No calls logged yet.</p> : (
            <ul className="space-y-2 text-sm">
              {callsList.map(c => (
                <li key={c.id} className="border-l-2 border-zinc-200 pl-3">
                  <div className="font-medium">{c.outcome ?? "—"}{c.duration_sec ? ` · ${c.duration_sec}s` : ""}</div>
                  <div className="text-xs text-zinc-500">{c.recorded_at ? new Date(c.recorded_at).toLocaleString() : ""}</div>
                  {c.notes && <div className="text-zinc-700 mt-1 whitespace-pre-wrap">{c.notes}</div>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Follow-ups (${fupsList.length})`}>
          {fupsList.length === 0 ? <p className="text-zinc-400 text-sm">No follow-ups.</p> : (
            <ul className="space-y-2 text-sm">
              {fupsList.map(f => (
                <li key={f.id} className="border-l-2 border-zinc-200 pl-3">
                  <div className="font-medium">{new Date(f.due_at).toLocaleString("fr-CA", { dateStyle: "short", timeStyle: "short" })} · {f.status}</div>
                  <div className="text-xs text-zinc-500">priority {f.priority}{f.source ? ` · via ${f.source}` : ""}</div>
                  {f.note && <div className="text-zinc-700 mt-1 whitespace-pre-wrap">{f.note}</div>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <Panel title={`Submissions (${subsList.length})`}>
        {subsList.length === 0 ? <p className="text-zinc-400 text-sm">No submissions for this lead.</p> : (
          <ul className="space-y-3 text-sm">
            {subsList.map(s => (
              <li key={s.id} className="border-l-2 border-emerald-200 pl-3">
                <div className="font-medium">{s.outcome} {s.seller_interest_level && <>· interest: {s.seller_interest_level}</>} {s.timeline && <>· timeline: {s.timeline}</>}</div>
                <div className="text-xs text-zinc-500">{new Date(s.created_at).toLocaleString()} · status: {s.status}{s.asking_price ? ` · asking $${s.asking_price.toLocaleString()}` : ""}</div>
                <p className="text-zinc-700 mt-1 whitespace-pre-wrap">{s.caller_summary}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Recent events (${eventsList.length})`}>
        {eventsList.length === 0 ? <p className="text-zinc-400 text-sm">No automation events.</p> : (
          <ul className="space-y-1 text-xs">
            {eventsList.map(e => (
              <li key={e.id} className="flex gap-3">
                <span className="text-zinc-400 font-mono whitespace-nowrap">{new Date(e.occurred_at).toLocaleString()}</span>
                <span className="font-medium">{e.source}/{e.event_type}</span>
                <span className={e.status === "failed" ? "text-red-600" : "text-zinc-500"}>{e.status}</span>
                {e.error_message && <span className="text-red-600 truncate">{e.error_message}</span>}
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
function LeadStatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    // Calling workflow
    new: "bg-blue-100 text-blue-800",
    ready_to_call: "bg-emerald-100 text-emerald-800",
    in_outreach: "bg-amber-100 text-amber-800",
    meeting_set: "bg-purple-100 text-purple-800",
    qualified: "bg-emerald-200 text-emerald-900",
    no_answer: "bg-zinc-100 text-zinc-600",
    rejected: "bg-red-100 text-red-800",
    do_not_contact: "bg-red-200 text-red-900",
    // Enrichment pipeline
    needs_enrichment: "bg-sky-100 text-sky-800",
    brave_queued: "bg-sky-50 text-sky-600",
    unresolved_after_brave: "bg-zinc-200 text-zinc-600",
    directory_411_queued: "bg-sky-50 text-sky-600",
    unresolved_after_411: "bg-zinc-200 text-zinc-600",
    places_queued: "bg-sky-50 text-sky-600",
    unresolved_after_places: "bg-zinc-200 text-zinc-600",
    openclaw_queued: "bg-violet-100 text-violet-700",
    needs_human_review: "bg-orange-100 text-orange-800",
    no_contact_found: "bg-red-50 text-red-500",
    enriching: "bg-sky-100 text-sky-700",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] ?? "bg-zinc-100 text-zinc-600"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function PhoneStatusPill({ s }: { s: string }) {
  const c: Record<string, string> = {
    unverified: "bg-zinc-100 text-zinc-700",
    valid: "bg-emerald-100 text-emerald-800",
    invalid: "bg-amber-100 text-amber-800",
    bad_number: "bg-amber-100 text-amber-800",
    wrong_person: "bg-amber-100 text-amber-800",
    do_not_contact: "bg-red-100 text-red-800",
    duplicate: "bg-zinc-100 text-zinc-500",
  };
  return <span className={`text-xs uppercase tracking-wide rounded px-1.5 py-0.5 ${c[s] ?? "bg-zinc-100"}`}>{s}</span>;
}
