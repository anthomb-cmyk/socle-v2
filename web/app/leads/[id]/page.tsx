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
  const displayName = lead.full_name ?? lead.company_name ?? "—";
  const phoneDisplay = lead.best_phone ? formatPhone(lead.best_phone) : "sans téléphone";
  const activityItems = [
    ...callsList.map((c) => ({
      id: `call-${c.id}`,
      kind: "Appel",
      title: c.outcome ?? "Appel consigné",
      body: c.notes ?? "Aucune note saisie.",
      meta: c.duration_sec ? `${c.duration_sec}s` : "appel",
      time: c.recorded_at,
      tone: c.outcome === "hot_seller" ? "red" : c.outcome === "positive" ? "green" : "amber",
    })),
    ...fupsList.map((f) => ({
      id: `fup-${f.id}`,
      kind: "Suivi",
      title: f.status,
      body: f.note ?? "Suivi planifié.",
      meta: `priorité ${f.priority}`,
      time: f.due_at,
      tone: "amber",
    })),
    ...subsList.map((s) => ({
      id: `sub-${s.id}`,
      kind: "Soumission",
      title: s.outcome,
      body: s.caller_summary,
      meta: s.seller_interest_level ?? "vendeur",
      time: s.created_at,
      tone: "green",
    })),
    ...eventsList.map((e) => ({
      id: `event-${e.id}`,
      kind: "Système",
      title: `${e.source}/${e.event_type}`,
      body: e.error_message ?? e.status,
      meta: e.status,
      time: e.occurred_at,
      tone: e.status === "failed" ? "red" : "amber",
    })),
  ].sort((a, b) => new Date(b.time ?? 0).getTime() - new Date(a.time ?? 0).getTime()).slice(0, 8);

  return (
    <main>
      <div className="lead-topbar">
        <div className="crumbs" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink-3)", fontSize: 12.5 }}>
          <Link href="/leads" style={{ color: "var(--gold-deep)", fontWeight: 600 }}>Leads</Link>
          <span>/</span>
          <span style={{ color: "var(--ink)" }}>{lead.city ?? "Québec"}</span>
          <span>/</span>
          <span>{displayName}</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <Link href="/leads" className="btn btn--sm"><Icon name="chevronLeft" />Retour</Link>
          <Link href={`/calls/${id}` as never} className="btn btn--primary btn--sm">Workspace appel<Icon name="arrowRight" /></Link>
        </div>
      </div>

      {unsuitable_failures && (
        <div className="panel" style={{ margin: "18px 32px 0", background: "var(--amber-soft)", borderColor: "oklch(0.85 0.07 75)", fontSize: 13, color: "oklch(0.42 0.13 70)" }}>
          <strong>Adresse postale incomplète.</strong>{" "}
          {unsuitable_failures.length > 0
            ? `Cette adresse postale est incomplète : ${unsuitable_failures.join(", ")}. Corrigez le fichier source et réimportez.`
            : "Cette adresse postale est incomplète. Corrigez le fichier source et réimportez."}
        </div>
      )}

      <header className="lead-hero">
        <div className="lead-hero__pills">
          <LeadStatusPill status={lead.status} />
          <span className="pill pill--brand">Priorité {lead.priority}</span>
          <span className="pill pill--info"><span className="pill__dot" />{phonesList.length} téléphone{phonesList.length > 1 ? "s" : ""}</span>
        </div>
        <h1 className="lead-hero__name">{displayName}</h1>
        <div className="lead-hero__row">
          <span>{lead.contact_kind}</span>
          <span>·</span>
          <span>{lead.address}{lead.city ? `, ${lead.city}` : ""}</span>
          {lead.campaign_name && <><span>·</span><span>Campagne <a>{lead.campaign_name}</a></span></>}
          <span>·</span>
          <span>{assignedUser?.display_name ? <>Assigné à <a>{assignedUser.display_name}</a></> : "Non assigné"}</span>
        </div>
        <div className="lead-hero__acts">
          <Link href={`/calls/${id}` as never} className="btn btn--primary">Ouvrir l’appel<Icon name="arrowRight" /></Link>
          <a href={lead.best_phone ? `tel:${lead.best_phone.replace(/\D/g, "")}` : undefined} className="btn btn--gold" aria-disabled={!lead.best_phone}>
            <Icon name="phone" />Appeler
          </a>
        </div>
      </header>

      <div className="lead-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="meta-grid">
            <Meta label="Logements" value={String(lead.num_units ?? property?.num_units ?? "—")} />
            <Meta label="Année" value={String((property?.year_built as number | null) ?? "—")} />
            <Meta label="Évaluation" value={lead.evaluation_total != null ? `${Math.round(lead.evaluation_total / 1000)}k` : property?.evaluation_total ? `${Math.round(Number(property.evaluation_total) / 1000)}k` : "—"} />
            <Meta label="Dernier contact" value={lead.last_contacted_at ? new Date(lead.last_contacted_at).toLocaleDateString("fr-CA") : "—"} />
          </div>

          <LeadBriefingCard
            leadId={id}
            initialText={briefingRow?.briefing_text ?? null}
            initialGeneratedAt={briefingRow?.briefing_generated_at ?? null}
          />

          <Panel title="Activité">
            <div className="tabs">
              <button className="tab tab--active">Timeline <span className="tab__c">{activityItems.length}</span></button>
              <button className="tab">Appels <span className="tab__c">{callsList.length}</span></button>
              <button className="tab">Suivis <span className="tab__c">{fupsList.length}</span></button>
              <button className="tab">Soumissions <span className="tab__c">{subsList.length}</span></button>
            </div>
            <div className="timeline">
              {activityItems.length === 0 ? (
                <p className="socle-muted" style={{ fontSize: 13 }}>Aucune activité récente.</p>
              ) : activityItems.map((item) => (
                <div key={item.id} className="tl-item">
                  <span className={`tl-item__dot tl-item__dot--${item.tone}`} />
                  <div>
                    <div className="tl-item__h">
                      <span className="tl-item__t">{item.title}</span>
                      <span className={`pill ${item.tone === "green" ? "pill--ready" : item.tone === "red" ? "pill--hot" : "pill--review"}`}>{item.kind}</span>
                    </div>
                    <div className="tl-item__sub">{item.body}</div>
                    <div className="tl-item__meta">{item.meta}</div>
                  </div>
                  <div className="tl-item__time">{item.time ? new Date(item.time).toLocaleDateString("fr-CA", { month: "short", day: "numeric" }) : "—"}</div>
                </div>
              ))}
            </div>
          </Panel>

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
        </div>

        <aside className="call-panel">
          <div className="phone-hero">
            <div className="phone-hero__l">Téléphone principal</div>
            <div className="phone-hero__v">{phoneDisplay}</div>
            <div className="phone-hero__src"><span className="heat heat--warm" />{phonesList[0]?.source ?? "Aucune source"}</div>
            <div className="phone-hero__btns">
              <a href={lead.best_phone ? `tel:${lead.best_phone.replace(/\D/g, "")}` : undefined} className="btn btn--call"><Icon name="phone" />Appeler</a>
              <Link href={`/calls/${id}` as never} className="btn">Ouvrir</Link>
            </div>
          </div>

          <Panel title="Outcomes">
            <div className="outcomes__hint">Après l’appel</div>
            <div className="outcome-list">
              <Link href={`/calls/${id}` as never} className="out-btn out-btn--hot"><span className="out-btn__i"><Icon name="flame" /></span>Vendeur chaud</Link>
              <Link href={`/calls/${id}` as never} className="out-btn out-btn--pos"><span className="out-btn__i"><Icon name="check" /></span>Conversation positive</Link>
              <Link href={`/calls/${id}` as never} className="out-btn out-btn--neu"><span className="out-btn__i"><Icon name="clock" /></span>Rappeler plus tard</Link>
              <Link href={`/calls/${id}` as never} className="out-btn out-btn--neg"><span className="out-btn__i"><Icon name="minus" /></span>Pas intéressé</Link>
              <Link href={`/calls/${id}` as never} className="out-btn out-btn--bad"><span className="out-btn__i"><Icon name="ban" /></span>Ne pas contacter</Link>
            </div>
          </Panel>

          <Panel title="Téléphones">
            {phonesList.length === 0 ? <p className="socle-muted" style={{ fontSize: 13 }}>Aucun téléphone au dossier.</p> : phonesList.map(p => (
              <div key={p.id} className="info-row">
                <div className="info-row__l"><PhoneStatusPill s={p.status} /></div>
                <div className="info-row__v mono">{p.display ?? p.e164}<div className="socle-subline">{p.source} · confiance {p.confidence}</div></div>
              </div>
            ))}
          </Panel>

          <Panel title="Propriété">
            <Info label="Adresse" value={property?.address as string ?? lead.address} />
            <Info label="Ville" value={(property?.city as string) ?? lead.city ?? "—"} />
            <Info label="Matricule" value={(property?.matricule as string) ?? "—"} mono />
            <Info label="Contact" value={(contact?.full_name as string) ?? (contact?.company_name as string) ?? displayName} />
          </Panel>
        </aside>
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel__h">
        <h2 className="panel__t">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Meta({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="meta"><div className="meta__l">{label}</div><div className="meta__v">{value}</div>{sub && <div className="meta__sub">{sub}</div>}</div>;
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="info-row"><div className="info-row__l">{label}</div><div className={`info-row__v${mono ? " mono" : ""}`}>{value}</div></div>;
}

function LeadStatusPill({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    new: { label: "Nouveau", cls: "pill--new" },
    ready_to_call: { label: "À appeler", cls: "pill--ready" },
    in_outreach: { label: "Contactée", cls: "pill--review" },
    meeting_set: { label: "RDV fixé", cls: "pill--info" },
    qualified: { label: "Qualifié", cls: "pill--ready" },
    no_answer: { label: "Sans réponse", cls: "pill--cold" },
    rejected: { label: "Fermé", cls: "pill--cold" },
    do_not_contact: { label: "DNC", cls: "pill--cold" },
    needs_enrichment: { label: "Enrichissement", cls: "pill--pipeline" },
    needs_human_review: { label: "À vérifier", cls: "pill--review" },
    phone_verified: { label: "Tél. vérifié", cls: "pill--ready" },
  };
  const item = cfg[status] ?? { label: status.replace(/_/g, " "), cls: "pill--pipeline" };
  return (
    <span className={`pill ${item.cls}`}><span className="pill__dot" />{item.label}</span>
  );
}

function PhoneStatusPill({ s }: { s: string }) {
  const c: Record<string, string> = {
    unverified: "pill--cold",
    valid: "pill--ready",
    invalid: "pill--review",
    bad_number: "pill--review",
    wrong_person: "pill--review",
    do_not_contact: "pill--hot",
    duplicate: "pill--cold",
  };
  return <span className={`pill ${c[s] ?? "pill--cold"}`}>{s}</span>;
}

function formatPhone(phone: string): string {
  const m = phone.replace(/\D/g, "");
  if (m.length === 11 && m[0] === "1") return `(${m.slice(1,4)}) ${m.slice(4,7)}-${m.slice(7)}`;
  if (m.length === 10) return `(${m.slice(0,3)}) ${m.slice(3,6)}-${m.slice(6)}`;
  return phone;
}

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
    chevronLeft: <path d="M15 18l-6-6 6-6" />,
    phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
    check: <path d="M20 6L9 17l-5-5" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    minus: <path d="M5 12h14" />,
    ban: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
    flame: <path d="M12 22c4 0 7-2.8 7-6.8 0-3.1-1.8-5.1-4-7.2-.7 2-2 3.2-3.4 4.1.4-2.5-.5-5.1-3-7.1C8.4 8 5 10.4 5 15.2 5 19.2 8 22 12 22z" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>{paths[name]}</svg>;
}
