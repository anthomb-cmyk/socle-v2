import React from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

type QueueLead = {
  lead_id: string;
  full_name: string | null;
  company_name: string | null;
  address: string;
  city: string | null;
  num_units: number | null;
  best_phone: string | null;
  status: string;
  campaign_name: string | null;
  last_contacted_at: string | null;
  priority: number | null;
};

function formatPhone(phone: string | null) {
  if (!phone) return null;
  // Format +15145551234 → (514) 555-1234
  const m = phone.replace(/\D/g, "");
  if (m.length === 11 && m[0] === "1")
    return `(${m.slice(1, 4)}) ${m.slice(4, 7)}-${m.slice(7)}`;
  if (m.length === 10)
    return `(${m.slice(0, 3)}) ${m.slice(3, 6)}-${m.slice(6)}`;
  return phone;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    new: "Nouveau",
    ready_to_call: "À appeler",
    in_outreach: "En démarche",
    no_answer: "Sans réponse",
    phone_verified: "Tél. vérifié",
  };
  return map[s] ?? s;
}

function rowBorderStyle(p: number | null): React.CSSProperties {
  if (p == null) return { borderLeft: "4px solid var(--crm-card-border)" };
  if (p >= 80) return { borderLeft: "4px solid var(--crm-red)" };
  if (p >= 50) return { borderLeft: "4px solid var(--crm-gold)" };
  return { borderLeft: "4px solid var(--crm-card-border)" };
}

export default async function CallQueuePage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sb = createSupabaseAdminClient();

  // Callable statuses: only leads with a verified phone may appear in the call queue.
  // "new" and "ready_to_call" remain for leads that already had a phone at import time.
  // "phone_verified" is the status set when Anthony approves an enriched phone candidate.
  // All enrichment-pipeline statuses are explicitly excluded.
  const CALLABLE_STATUSES = ["new", "ready_to_call", "in_outreach", "no_answer", "phone_verified"] as const;

  // All leads assigned to this user in callable statuses AND with a verified phone
  const { data: rawLeads } = await sb
    .from("leads_view")
    .select("lead_id,full_name,company_name,address,city,num_units,best_phone,status,campaign_name,last_contacted_at,priority")
    .eq("assigned_to", user.id)
    .in("status", CALLABLE_STATUSES as unknown as string[])
    .not("best_phone", "is", null)   // must have a verified phone — no-phone leads never show here
    .order("priority", { ascending: false })
    .order("last_contacted_at", { ascending: true, nullsFirst: true });

  const leads = (rawLeads ?? []) as QueueLead[];

  // Per-lead call counts from call_logs
  const leadIds = leads.map((l) => l.lead_id);
  const callCounts: Record<string, number> = {};
  if (leadIds.length > 0) {
    const { data: counts } = await sb
      .from("call_logs")
      .select("lead_id")
      .in("lead_id", leadIds);
    (counts ?? []).forEach((row: { lead_id: string | null }) => {
      if (row.lead_id) callCounts[row.lead_id] = (callCounts[row.lead_id] ?? 0) + 1;
    });
  }

  // All visible leads already have a verified phone (enforced by query above)
  const phoneReady = leads.length;
  // noPhone removed — all visible leads enforced to have a phone by query above

  return (
    <main className="crm-page-narrow">
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <h1 className="crm-page-title">File d&rsquo;appels</h1>
          <p className="crm-page-sub">
            {leads.length} lead{leads.length === 1 ? "" : "s"} assigné{leads.length === 1 ? "" : "s"}
            {phoneReady > 0 && (
              <> · <span style={{ color: "var(--crm-green)", fontWeight: 600 }}>{phoneReady} avec tél.</span></>
            )}
          </p>
        </div>
        <Link href="/leads" className="crm-btn">Tous les leads</Link>
      </header>

      {leads.length === 0 ? (
        <div className="crm-card" style={{ padding: "32px 24px", textAlign: "center", color: "var(--crm-text3)" }}>
          File vide — rien à appeler pour le moment.
          <div style={{ marginTop: 12 }}>
            <Link href="/leads" style={{ fontSize: 13, color: "var(--crm-blue)", textDecoration: "none" }}>Parcourir les leads</Link>
          </div>
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {leads.map((l) => {
            const callCount = callCounts[l.lead_id] ?? 0;
            const formatted = formatPhone(l.best_phone);

            return (
              <li key={l.lead_id}>
                <Link
                  href={`/calls/${l.lead_id}` as never}
                  style={{
                    display: "block",
                    background: "var(--crm-card)",
                    border: "1px solid var(--crm-card-border)",
                    borderRadius: 12,
                    padding: "12px 16px",
                    textDecoration: "none",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                    ...rowBorderStyle(l.priority),
                  }}
                  className="hover:border-[var(--crm-gold-border)] hover:shadow-sm"
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {/* Line 1: name + status */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 2 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "var(--crm-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {l.full_name ?? l.company_name ?? "—"}
                        </span>
                        <span className={`crm-pill crm-pill--${l.status === "no_answer" ? "sans-reponse" : l.status === "in_outreach" ? "contacte" : l.status === "phone_verified" ? "a-appeler" : "nouveau"}`}>
                          {statusLabel(l.status)}
                        </span>
                      </div>
                      {/* Line 2: address */}
                      <div style={{ fontSize: 12, color: "var(--crm-text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 }}>
                        {l.address}{l.city ? `, ${l.city}` : ""}
                      </div>
                      {/* Line 3: units · campaign · calls */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--crm-text3)", flexWrap: "wrap" }}>
                        {l.num_units != null && <span className="crm-chip crm-chip-units">{l.num_units} log.</span>}
                        {l.campaign_name && <span>{l.campaign_name}</span>}
                        {callCount > 0 && <span>· {callCount} appel{callCount !== 1 ? "s" : ""}</span>}
                        {l.last_contacted_at && <span>· {timeAgo(l.last_contacted_at)}</span>}
                      </div>
                    </div>

                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      {formatted ? (
                        <div className="crm-phone-link" style={{ fontSize: 14 }}>{formatted}</div>
                      ) : (
                        <div className="crm-no-phone">sans tél.</div>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {leads.length > 0 && (
        <div style={{ marginTop: 20, textAlign: "center", fontSize: 11, color: "var(--crm-text3)" }}>
          Triés par priorité · plus ancien contact en premier
        </div>
      )}
    </main>
  );
}
