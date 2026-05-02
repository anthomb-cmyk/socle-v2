import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "var(--crm-bg)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "var(--crm-gold)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 22, fontWeight: 900, margin: "0 auto 14px" }}>S</div>
          <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "2px", color: "var(--crm-text)" }}>SOCLE</div>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1.5px", color: "var(--crm-gold)", marginBottom: 28 }}>ACQUISITIONS</div>
          <Link className="crm-btn crm-btn-dark" href="/login">Se connecter</Link>
        </div>
      </main>
    );
  }

  const role = (user.app_metadata?.role ?? "caller") as "admin" | "caller";
  if (role === "caller") redirect("/calls/queue");

  const sb = createSupabaseAdminClient();
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  const dayAgo     = new Date(now); dayAgo.setDate(dayAgo.getDate() - 1);

  const ENRICHMENT_STATUSES = [
    "needs_enrichment","needs_human_review","brave_queued","unresolved_after_brave",
    "directory_411_queued","unresolved_after_411","places_queued","unresolved_after_places",
    "openclaw_queued","enrichment_pending","enrichment_running",
  ];
  const CALLABLE_STATUSES = ["new","ready_to_call","in_outreach","no_answer","phone_verified"];

  const [
    openReviews, urgentReviews, newLeads,
    phoneReady, unassigned, enriching,
    leadsToCall, overdueFu, todayFu,
    recentImports, recentFailures, latestCampaign,
    recentCalls, urgentItems,
  ] = await Promise.all([
    sb.from("review_items").select("id", { count: "exact", head: true }).eq("status", "open"),
    sb.from("review_items").select("id", { count: "exact", head: true }).eq("status", "open").eq("urgency", "urgent"),
    sb.from("leads").select("id", { count: "exact", head: true }).eq("status", "new"),
    sb.from("leads_view").select("lead_id", { count: "exact", head: true }).eq("status", "phone_verified"),
    sb.from("leads").select("id", { count: "exact", head: true }).in("status", CALLABLE_STATUSES).is("assigned_to", null),
    sb.from("leads").select("id", { count: "exact", head: true }).in("status", ENRICHMENT_STATUSES),
    sb.from("leads").select("id", { count: "exact", head: true }).in("status", CALLABLE_STATUSES).not("assigned_to", "is", null),
    sb.from("follow_ups").select("id", { count: "exact", head: true }).eq("status", "pending").lt("due_at", todayStart.toISOString()),
    sb.from("follow_ups").select("id", { count: "exact", head: true }).eq("status", "pending").gte("due_at", todayStart.toISOString()).lt("due_at", todayEnd.toISOString()),
    sb.from("import_jobs")
      .select("id,file_name,status,properties_created,leads_created,errors_count,created_at")
      .order("created_at", { ascending: false }).limit(5),
    sb.from("automation_events")
      .select("id,source,event_type,error_message,occurred_at")
      .eq("status", "failed").gte("occurred_at", dayAgo.toISOString())
      .order("occurred_at", { ascending: false }).limit(5),
    sb.from("campaigns").select("id,name,created_at").order("created_at", { ascending: false }).limit(1),
    // Recent call activity: join call_logs with leads_view for owner name
    sb.from("call_logs")
      .select("id,lead_id,outcome,recorded_at,leads_view(full_name,company_name,address)")
      .order("recorded_at", { ascending: false }).limit(6),
    // Top urgent review items for dashboard panel
    sb.from("review_items")
      .select("id,title,summary,urgency,created_at,lead_id")
      .eq("status", "open")
      .order("urgency", { ascending: true })  // urgent first
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const c = {
    openReviews:   openReviews.count   ?? 0,
    urgentReviews: urgentReviews.count ?? 0,
    newLeads:      newLeads.count      ?? 0,
    phoneReady:    phoneReady.count    ?? 0,
    unassigned:    unassigned.count    ?? 0,
    enriching:     enriching.count     ?? 0,
    leadsToCall:   leadsToCall.count   ?? 0,
    overdueFu:     overdueFu.count     ?? 0,
    todayFu:       todayFu.count       ?? 0,
  };

  const hasUrgent = c.urgentReviews > 0 || c.overdueFu > 0;
  const campaign = ((latestCampaign.data ?? []) as Array<{ id: string; name: string }>)[0];

  type ImportJob = {
    id: string; file_name: string; status: string;
    properties_created: number; leads_created: number; errors_count: number; created_at: string;
  };
  type AutoEvent = {
    id: string; source: string; event_type: string;
    error_message: string | null; occurred_at: string;
  };
  type CallLog = {
    id: string; lead_id: string | null; outcome: string | null; recorded_at: string;
    leads_view: { full_name: string | null; company_name: string | null; address: string } | null;
  };
  type ReviewItem = {
    id: string; title: string; summary: string | null;
    urgency: string; created_at: string; lead_id: string | null;
  };

  const imports    = (recentImports.data   ?? []) as ImportJob[];
  const failures   = (recentFailures.data  ?? []) as AutoEvent[];
  const calls      = (recentCalls.data     ?? []) as unknown as CallLog[];
  const hotItems   = (urgentItems.data     ?? []) as ReviewItem[];

  return (
    <main className="crm-page">

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <h1 className="crm-page-title">Tableau de bord</h1>
          <p className="crm-page-sub">
            Vue d&rsquo;ensemble des leads, appels, imports et urgences.
            {campaign && <> · Campagne : <strong style={{ color: "var(--crm-text2)" }}>{campaign.name}</strong></>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/import"      className="crm-btn crm-btn-gold">+ Import rôle</Link>
          <Link href="/leads"       className="crm-btn">Voir leads</Link>
          <Link href="/calls/queue" className="crm-btn">File d&rsquo;appels</Link>
          <Link href="/review"      className="crm-btn">Revue</Link>
        </div>
      </div>

      {/* ── Urgent banner ── */}
      {hasUrgent && (
        <div style={{
          background: "var(--crm-red-light)",
          border: "1px solid #F5C6C0",
          borderLeft: "4px solid var(--crm-red)",
          borderRadius: 10,
          padding: "12px 18px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 20,
          flexWrap: "wrap",
        }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-red)", marginBottom: 3 }}>
              À traiter maintenant
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--crm-text)" }}>
              {c.urgentReviews > 0 && <span>{c.urgentReviews} vendeur{c.urgentReviews > 1 ? "s urgents" : " urgent"}</span>}
              {c.urgentReviews > 0 && c.overdueFu > 0 && <span style={{ color: "var(--crm-text3)", margin: "0 8px" }}>·</span>}
              {c.overdueFu > 0 && <span>{c.overdueFu} suivi{c.overdueFu > 1 ? "s en retard" : " en retard"}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {c.urgentReviews > 0 && <Link href="/review" className="crm-btn" style={{ borderColor: "var(--crm-red)", color: "var(--crm-red)" }}>Revue urgente →</Link>}
            {c.overdueFu > 0 && <Link href={"/follow-ups?bucket=overdue" as never} className="crm-btn">Suivis en retard →</Link>}
          </div>
        </div>
      )}

      {/* ── 6 stat tiles ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10, marginBottom: 18 }}>
        <Tile href="/leads?status=new"    label="Nouveaux leads"      value={c.newLeads}      sub="à qualifier" />
        <Tile href="/phone-review"        label="Tél. vérifiés"       value={c.phoneReady}    sub="prêts à appeler"              highlight={c.phoneReady > 0} />
        <Tile href="/leads?assigned=none" label="Non assignés"        value={c.unassigned}    sub="sans caller" />
        <Tile href="/leads"               label="En cours d'appels"   value={c.leadsToCall}   sub="assignés · actifs" />
        <Tile href="/review"              label="Revues urgentes"      value={c.urgentReviews} sub={`${c.openReviews} ouvertes`}  highlight={c.urgentReviews > 0} />
        <Tile href={"/follow-ups" as never} label="Suivis auj." value={c.todayFu} sub={c.overdueFu > 0 ? `${c.overdueFu} en retard` : `${c.enriching} enrichissement`} highlight={c.overdueFu > 0} />
      </div>

      {/* ── Three-column panels ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>

        {/* Col 1: Imports récents */}
        <Panel title="Imports récents" action={{ label: "Nouveau →", href: "/import" }} empty="Aucun import pour l'instant.">
          {imports.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {imports.map(i => (
                <li key={i.id} style={{ padding: "7px 0", borderBottom: "1px solid var(--crm-card-border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--crm-text)" }}>{i.file_name}</div>
                    <div style={{ fontSize: 11, color: "var(--crm-text3)", marginTop: 1 }}>{fmtDate(i.created_at)} · <StatusBadge status={i.status} /></div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}>
                    <span className="crm-chip crm-chip-units">{i.properties_created}p</span>{" "}
                    <span className="crm-chip crm-chip-year">{i.leads_created}l</span>
                    {i.errors_count > 0 && <span style={{ color: "var(--crm-red)", marginLeft: 4, fontWeight: 700 }}>{i.errors_count} err</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Col 2: Activité d'appels récente */}
        <Panel title="Activité d'appels récente" action={{ label: "File →", href: "/calls/queue" }} empty="Aucun appel enregistré pour l'instant.">
          {calls.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {calls.map(cl => {
                const owner = cl.leads_view?.full_name ?? cl.leads_view?.company_name ?? "—";
                const outcomeCfg: Record<string, { label: string; color: string }> = {
                  answered:     { label: "Répondu",      color: "var(--crm-green)"  },
                  no_answer:    { label: "Sans réponse", color: "var(--crm-text3)"  },
                  left_vm:      { label: "Boîte voc.",   color: "var(--crm-blue)"   },
                  callback:     { label: "Rappel",       color: "var(--crm-amber)"  },
                  not_reached:  { label: "Non joint",    color: "var(--crm-text3)"  },
                };
                const oc = cl.outcome ? (outcomeCfg[cl.outcome] ?? { label: cl.outcome, color: "var(--crm-text3)" }) : null;
                return (
                  <li key={cl.id} style={{ padding: "7px 0", borderBottom: "1px solid var(--crm-card-border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: "var(--crm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {cl.lead_id ? (
                          <Link href={`/leads/${cl.lead_id}` as never} style={{ color: "var(--crm-text)", textDecoration: "none" }}>{owner}</Link>
                        ) : owner}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--crm-text3)", marginTop: 1 }}>{fmtDate(cl.recorded_at)}</div>
                    </div>
                    {oc && <span style={{ fontSize: 10, fontWeight: 700, color: oc.color, flexShrink: 0 }}>{oc.label}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Col 3: Vendeurs urgents (review inbox preview) */}
        <Panel title="Vendeurs urgents" action={{ label: "Tout voir →", href: "/review" }} empty="Aucun vendeur urgent en ce moment.">
          {hotItems.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {hotItems.map(it => {
                const borderColor = it.urgency === "urgent" ? "var(--crm-red)" : it.urgency === "high" ? "var(--crm-amber)" : "var(--crm-card-border)";
                return (
                  <li key={it.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--crm-card-border)" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ width: 3, background: borderColor, borderRadius: 2, alignSelf: "stretch", flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 12, color: "var(--crm-text)", lineHeight: 1.3 }}>{it.title}</div>
                        {it.summary && (
                          <div style={{ fontSize: 11, color: "var(--crm-text2)", marginTop: 2, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                            {it.summary}
                          </div>
                        )}
                        <div style={{ fontSize: 10, color: "var(--crm-text3)", marginTop: 3, display: "flex", gap: 10 }}>
                          <span>{fmtDate(it.created_at)}</span>
                          {it.lead_id && (
                            <Link href={`/leads/${it.lead_id}` as never} style={{ color: "var(--crm-blue)", textDecoration: "none", fontWeight: 600 }}>
                              Ouvrir →
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

      </div>

      {/* ── Bottom row: Erreurs auto + Enrichissement ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

        {/* Erreurs d'automation */}
        <Panel title="Erreurs d'automation (24 h)" empty="Aucune erreur récente — tout roule.">
          {failures.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {failures.map(e => (
                <li key={e.id} style={{ padding: "7px 0", borderBottom: "1px solid var(--crm-card-border)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.7px", textTransform: "uppercase", color: "var(--crm-text3)", marginBottom: 2 }}>{e.source} · {e.event_type}</div>
                  <div style={{ fontSize: 12, color: "var(--crm-red)", fontWeight: 500 }}>{e.error_message ?? "(no message)"}</div>
                  <div style={{ fontSize: 10, color: "var(--crm-text3)", marginTop: 1 }}>{fmtDate(e.occurred_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Enrichissement pipeline */}
        <Panel
          title="Enrichissement"
          action={c.enriching > 0 ? { label: "Voir pipeline →", href: "/admin/enrichment" } : undefined}
          empty="Aucun enrichissement actif."
        >
          {c.enriching > 0 ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: "var(--crm-blue)" }}>{c.enriching}</span>
                <span style={{ fontSize: 12, color: "var(--crm-text2)" }}>leads dans le pipeline</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--crm-text3)", lineHeight: 1.6 }}>
                Pipeline actif · Brave · 411 · Places · OpenClaw
              </div>
              <div style={{ marginTop: 10, height: 6, background: "var(--crm-blue-light)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", background: "var(--crm-blue)", borderRadius: 3, width: `${Math.min(100, Math.round((c.phoneReady / Math.max(1, c.enriching + c.phoneReady)) * 100))}%` }} />
              </div>
              <div style={{ fontSize: 10, color: "var(--crm-text3)", marginTop: 4 }}>
                {c.phoneReady} tél. vérifiés · {c.enriching} en traitement
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--crm-text3)" }}>Aucun enrichissement actif.</div>
          )}
        </Panel>

      </div>

    </main>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("fr-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatusBadge({ status }: { status: string }) {
  const c: Record<string, string> = {
    completed:  "var(--crm-green)",
    processing: "var(--crm-blue)",
    failed:     "var(--crm-red)",
    pending:    "var(--crm-amber)",
  };
  return <span style={{ fontWeight: 700, color: c[status] ?? "var(--crm-text3)" }}>{status}</span>;
}

function Tile({ href, label, value, sub, highlight }: {
  href: string; label: string; value: number | string; sub?: string; highlight?: boolean;
}) {
  return (
    <Link href={href as never} className={`crm-tile${highlight ? " crm-tile-hot" : ""}`}>
      <div className="crm-tile-label">{label}</div>
      <div className="crm-tile-value">{value}</div>
      {sub && <div className="crm-tile-sub">{sub}</div>}
    </Link>
  );
}

function Panel({ title, action, empty, children }: {
  title: string;
  action?: { label: string; href: string };
  empty: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="crm-card" style={{ padding: "15px 17px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h2 style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--crm-text3)", margin: 0 }}>
          {title}
        </h2>
        {action && (
          <Link href={action.href as never} style={{ fontSize: 11, fontWeight: 600, color: "var(--crm-gold)", textDecoration: "none" }}>
            {action.label}
          </Link>
        )}
      </div>
      {children ?? <p style={{ fontSize: 12, color: "var(--crm-text3)", margin: 0 }}>{empty}</p>}
    </div>
  );
}
