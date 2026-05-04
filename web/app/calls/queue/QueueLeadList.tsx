"use client";
// Client component that renders the translated queue lead list + header.
// The server page (page.tsx) fetches data and passes it here.

import Link from "next/link";
import { useLocale } from "@/components/locale-provider";

export type QueueLead = {
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
  next_action_at: string | null;
  priority: number | null;
};

function formatPhone(phone: string | null) {
  if (!phone) return null;
  const m = phone.replace(/\D/g, "");
  if (m.length === 11 && m[0] === "1")
    return `(${m.slice(1, 4)}) ${m.slice(4, 7)}-${m.slice(7)}`;
  if (m.length === 10)
    return `(${m.slice(0, 3)}) ${m.slice(3, 6)}-${m.slice(6)}`;
  return phone;
}

function rowBorderStyle(p: number | null, isOverdue: boolean): React.CSSProperties {
  if (isOverdue) return { borderLeft: "4px solid var(--crm-blue)" };
  if (p == null) return { borderLeft: "4px solid var(--crm-card-border)" };
  if (p >= 80) return { borderLeft: "4px solid var(--crm-red)" };
  if (p >= 50) return { borderLeft: "4px solid var(--crm-gold)" };
  return { borderLeft: "4px solid var(--crm-card-border)" };
}

export default function QueueLeadList({
  leads,
  callCounts,
  hotSellers,
}: {
  leads: QueueLead[];
  callCounts: Record<string, number>;
  hotSellers: number;
}) {
  const { t } = useLocale();

  // Translated helpers that depend on locale
  function timeAgo(iso: string | null): string {
    if (!iso) return t.queue.never;
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}${t.queue.timeAgoMin}`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}${t.queue.timeAgoHour}`;
    const days = Math.floor(hrs / 24);
    return `${days}${t.queue.timeAgoDay}`;
  }

  function overdueLabel(nextActionAt: string | null): string | null {
    if (!nextActionAt) return null;
    const diff = Date.now() - new Date(nextActionAt).getTime();
    if (diff <= 0) return null;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return t.queue.overdueLabel(`${mins}${t.queue.timeAgoMin}`);
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t.queue.overdueLabel(`${hrs}${t.queue.timeAgoHour}`);
    return t.queue.overdueLabel(`${Math.floor(hrs / 24)}${t.queue.timeAgoDay}`);
  }

  function statusLabel(s: string): string {
    return t.status[s] ?? s;
  }

  const overdueCount = leads.filter(
    (l) => l.next_action_at && new Date(l.next_action_at) <= new Date(),
  ).length;

  return (
    <main className="crm-page-narrow">
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 className="crm-page-title">{t.queue.title}</h1>
          <p className="crm-page-sub">
            {t.queue.leadCount(leads.length)}
            {overdueCount > 0 && (
              <>
                {" "}
                ·{" "}
                <span style={{ color: "var(--crm-blue)", fontWeight: 600 }}>
                  {t.queue.overdueCount(overdueCount)}
                </span>
              </>
            )}
          </p>
        </div>
        <Link href="/leads" className="crm-btn">
          {t.queue.allLeads}
        </Link>
      </header>

      {leads.length === 0 ? (
        <div
          className="crm-card"
          style={{ padding: "32px 24px", textAlign: "center", color: "var(--crm-text3)" }}
        >
          {t.queue.empty}
          <div style={{ marginTop: 12 }}>
            <Link
              href="/leads"
              style={{ fontSize: 13, color: "var(--crm-blue)", textDecoration: "none" }}
            >
              {t.queue.browseLeads}
            </Link>
          </div>
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {leads.map((l) => {
            const callCount = callCounts[l.lead_id] ?? 0;
            const formatted = formatPhone(l.best_phone);
            const overdue = overdueLabel(l.next_action_at);

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
                    ...rowBorderStyle(l.priority, !!overdue),
                  }}
                  className="crm-queue-card hover:border-[var(--crm-gold-border)] hover:shadow-sm"
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 16,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {/* Line 1: name + status + overdue badge */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                          marginBottom: 2,
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: 14,
                            color: "var(--crm-text)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {l.full_name ?? l.company_name ?? "—"}
                        </span>
                        <span
                          className={`crm-pill crm-pill--${
                            l.status === "no_answer"
                              ? "sans-reponse"
                              : l.status === "in_outreach"
                              ? "contacte"
                              : l.status === "phone_verified"
                              ? "a-appeler"
                              : "nouveau"
                          }`}
                        >
                          {statusLabel(l.status)}
                        </span>
                        {overdue && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              color: "var(--crm-blue)",
                              background:
                                "color-mix(in srgb, var(--crm-blue) 12%, transparent)",
                              borderRadius: 4,
                              padding: "2px 6px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {overdue}
                          </span>
                        )}
                      </div>
                      {/* Line 2: address */}
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--crm-text2)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          marginBottom: 2,
                        }}
                      >
                        {l.address}
                        {l.city ? `, ${l.city}` : ""}
                      </div>
                      {/* Line 3: units · campaign · calls · last contact */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 11,
                          color: "var(--crm-text3)",
                          flexWrap: "wrap",
                        }}
                      >
                        {l.num_units != null && (
                          <span className="crm-chip crm-chip-units">{l.num_units} log.</span>
                        )}
                        {l.campaign_name && <span>{l.campaign_name}</span>}
                        {callCount > 0 && (
                          <span>
                            · {callCount} appel{callCount !== 1 ? "s" : ""}
                          </span>
                        )}
                        {l.last_contacted_at && (
                          <span>· il y a {timeAgo(l.last_contacted_at)}</span>
                        )}
                      </div>
                    </div>

                    <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                      {formatted ? (
                        <div className="crm-queue-phone crm-phone-link" style={{ fontSize: 14 }}>
                          {formatted}
                        </div>
                      ) : (
                        <div className="crm-no-phone">sans tél.</div>
                      )}
                      <span style={{ fontSize: 12, color: "var(--crm-gold)", fontWeight: 700 }}>→</span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {leads.length > 0 && (
        <div
          style={{
            marginTop: 20,
            textAlign: "center",
            fontSize: 11,
            color: "var(--crm-text3)",
          }}
        >
          {t.queue.footer}
        </div>
      )}
    </main>
  );
}
