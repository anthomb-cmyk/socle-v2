"use client";
// V1-style left sidebar for Socle CRM V2.
// Replaces the thin top nav with a full vertical sidebar.
// Active nav items highlighted with gold/cream background (V1 pattern).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import SignOutButton from "./sign-out-button";
import { LocaleToggle, useLocale } from "./locale-provider";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  callerOnly?: boolean;
};

// Primary nav — workflow order: dashboard → pipeline → leads → calls → phone-review → review → ops
const PRIMARY_NAV: NavItem[] = [
  { href: "/",                  label: "Tableau de bord",      icon: "dashboard",   adminOnly: true  },
  { href: "/pipeline",          label: "Pipeline deals",       icon: "pipeline",    adminOnly: true  },
  { href: "/leads",             label: "Leads",                icon: "leads"                         },
  { href: "/calls/queue",       label: "File d'appels",        icon: "calls"                         },
  { href: "/phone-review",      label: "Téléphones à réviser", icon: "phone",       adminOnly: true  },
  { href: "/review",            label: "Revue",                icon: "review",      adminOnly: true  },
  { href: "/import",            label: "Import rôle",          icon: "import",      adminOnly: true  },
  { href: "/admin/enrichment",  label: "Enrichissement",       icon: "enrichment",  adminOnly: true  },
  { href: "/follow-ups",        label: "Suivis",               icon: "followups"                     },
  { href: "/calendar",          label: "Calendrier",           icon: "calendar"                      },
  { href: "/map",               label: "Carte",                icon: "map"                           },
];

// Admin-only secondary tools
const ADMIN_NAV: NavItem[] = [
  { href: "/admin/users",   label: "Utilisateurs",       icon: "users"      },
  { href: "/admin/events",  label: "Journal événements", icon: "events"     },
  { href: "/admin/costs",   label: "Coûts API",          icon: "costs"      },
  { href: "/admin/imports", label: "Imports",            icon: "import"     },
  { href: "/data-health",   label: "Santé données",      icon: "health"     },
  { href: "/properties",    label: "Propriétés",         icon: "properties" },
  { href: "/contacts",      label: "Contacts",           icon: "contacts"   },
];

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

type SidebarCounts = {
  leads_total: number;
  leads_ready_to_call: number;
  phone_candidates_needs_review: number;
  review_items_pending: number;
  proposed_actions_pending: number;
  hot_sellers_pending: number;
};

const POLL_INTERVAL_MS = 30_000;

function useSidebarCounts(): SidebarCounts | null {
  const [counts, setCounts] = useState<SidebarCounts | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchCounts() {
      try {
        const res = await fetch("/api/sidebar-counts", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { ok: boolean; data?: SidebarCounts };
        if (!cancelled && json.ok && json.data) {
          setCounts(json.data);
        }
      } catch {
        // Silently ignore — don't break sidebar
      }
    }

    fetchCounts();
    const timer = setInterval(fetchCounts, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return counts;
}

function Badge({
  count,
  highlight,
}: {
  count: number;
  highlight?: "green" | "amber" | "red";
}) {
  if (count === 0) return null;
  const base =
    "inline-flex items-center justify-center text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-[5px] leading-none ml-auto shrink-0";
  const colors =
    highlight === "green"
      ? "bg-emerald-500 text-white"
      : highlight === "amber"
      ? "bg-amber-400 text-white"
      : highlight === "red"
      ? "bg-red-500 text-white"
      : "bg-zinc-200 text-zinc-600";
  return <span className={`${base} ${colors}`}>{count}</span>;
}

export default function AppSidebar({
  email,
  role,
  recentLeads = [],
  recentDeals = [],
}: {
  email: string;
  role: "admin" | "caller";
  recentLeads?: RecentLead[];
  recentDeals?: RecentDeal[];
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAdmin = role === "admin";
  const counts = useSidebarCounts();
  const { t } = useLocale();

  // Build initials from "firstname.lastname@..." pattern
  const handle = email.split("@")[0];
  const parts = handle.split(/[._\-+]/);
  const initials = parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || handle.slice(0, 2).toUpperCase();

  const visiblePrimary = PRIMARY_NAV.filter((i) => {
    if (i.adminOnly && !isAdmin) return false;
    if (i.callerOnly && isAdmin) return false;
    return true;
  });

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  function priorityDot(p: number | null, status: string): string {
    if (status === "do_not_contact" || status === "rejected") return "done";
    if (p == null) return "";
    if (p >= 80) return "hot";
    if (p >= 50) return "warm";
    return "";
  }

  function getBadgeForItem(item: NavItem) {
    if (!counts) return null;
    if (item.href === "/leads") {
      return <Badge count={counts.leads_total} />;
    }
    if (item.href === "/calls/queue") {
      return (
        <Badge
          count={counts.leads_ready_to_call}
          highlight={counts.leads_ready_to_call > 0 ? "green" : undefined}
        />
      );
    }
    if (item.href === "/phone-review") {
      return (
        <Badge
          count={counts.phone_candidates_needs_review}
          highlight={counts.phone_candidates_needs_review > 0 ? "amber" : undefined}
        />
      );
    }
    if (item.href === "/review") {
      const total = counts.review_items_pending + counts.proposed_actions_pending;
      return (
        <Badge
          count={total}
          highlight={total > 0 ? "red" : undefined}
        />
      );
    }
    return null;
  }

  const sidebar = (
    <div className="crm-sidebar-inner">
      {/* ── Logo ── */}
      <div className="crm-sidebar-logo">
        <div className="crm-sidebar-logo-mark">S</div>
        <div>
          <div className="crm-sidebar-logo-title">SOCLE</div>
          <div className="crm-sidebar-logo-sub">ACQUISITIONS</div>
          <div className="crm-sidebar-logo-tagline">Real Estate Investment</div>
        </div>
      </div>

      {/* ── Primary nav ── */}
      <nav className="crm-sidebar-nav">
        {visiblePrimary.map((item) => {
          // Phase 7b: insert a "Module appels" section header above /calls/queue
          // for caller-tier users only. Admin sidebar is unchanged.
          const showCallerSectionHeader = !isAdmin && item.href === "/calls/queue";
          return (
            <div key={item.href} style={{ display: "contents" }}>
              {showCallerSectionHeader && (
                <div className="crm-sidebar-section-label">{t.nav.callerSection}</div>
              )}
              <Link
                href={item.href as never}
                className={`crm-sidebar-link${isActive(item.href) ? " crm-sidebar-link--active" : ""}`}
                onClick={() => setMobileOpen(false)}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <NavIcon name={item.icon} />
                <span style={{ flex: 1 }}>
                  {item.href === "/calls/queue"
                    ? t.nav.queue
                    : item.href === "/phone-review"
                    ? t.nav.phoneReview
                    : item.label}
                </span>
                {getBadgeForItem(item)}
              </Link>
            </div>
          );
        })}

        {isAdmin && (
          <>
            <div className="crm-sidebar-divider" />
            <div className="crm-sidebar-section-label">Administration</div>
            {ADMIN_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href as never}
                className={`crm-sidebar-link crm-sidebar-link--sub${isActive(item.href) ? " crm-sidebar-link--active" : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                <NavIcon name={item.icon} small />
                <span>{item.label}</span>
              </Link>
            ))}
          </>
        )}
      </nav>

      {/* ── New deal CTA ── */}
      {isAdmin && (
        <div style={{ padding: "0 10px", marginBottom: 6 }}>
          <Link
            href={"/pipeline" as never}
            className="crm-sidebar-link"
            onClick={() => setMobileOpen(false)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 6, background: "var(--crm-gold, #C9A84C)", color: "#fff",
              borderRadius: 10, padding: "9px 12px", fontWeight: 800,
              fontSize: 12, textDecoration: "none", letterSpacing: "0.3px",
            }}
          >
            + Nouveau deal
          </Link>
        </div>
      )}

      {/* ── Recent deals ── */}
      {isAdmin && recentDeals.length > 0 && (
        <div className="crm-sidebar-recent">
          <div className="crm-sidebar-section-label" style={{ marginBottom: 4 }}>Deals récents</div>
          {recentDeals.slice(0, 5).map((d) => (
            <Link
              key={d.id}
              href={`/pipeline/${d.id}` as never}
              className="crm-sidebar-recent-item"
              onClick={() => setMobileOpen(false)}
            >
              <span className={`crm-sidebar-recent-dot${d.temperature === "chaud" ? " hot" : d.temperature === "tiede" ? " warm" : ""}`} />
              <span className="crm-sidebar-recent-name">{d.title}</span>
            </Link>
          ))}
        </div>
      )}

      {/* ── Recent leads ── */}
      {recentLeads.length > 0 && (
        <div className="crm-sidebar-recent">
          <div className="crm-sidebar-section-label" style={{ marginBottom: 4 }}>Leads récents</div>
          {recentLeads.slice(0, 6).map((l) => {
            const dot = priorityDot(l.priority, l.status);
            return (
              <Link
                key={l.lead_id}
                href={`/leads/${l.lead_id}` as never}
                className="crm-sidebar-recent-item"
                onClick={() => setMobileOpen(false)}
              >
                <span className={`crm-sidebar-recent-dot${dot ? ` ${dot}` : ""}`} />
                <span className="crm-sidebar-recent-name">
                  {l.full_name ?? l.company_name ?? "—"}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* spacer */}
      <div style={{ flex: 1 }} />

      {/* ── User card ── */}
      <div className="crm-sidebar-user">
        <div className="crm-sidebar-user-avatar">{initials}</div>
        <div className="crm-sidebar-user-info">
          <div className="crm-sidebar-user-name">{handle}</div>
          <div className="crm-sidebar-user-role">{role}</div>
        </div>
        <LocaleToggle />
        <SignOutButton />
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar — shown/hidden via CSS media query (not Tailwind) */}
      <aside className="crm-sidebar">
        {sidebar}
      </aside>

      {/* Mobile top bar — shown/hidden via CSS media query (not Tailwind) */}
      <div className="crm-mobile-bar">
        <button
          className="crm-mobile-hamburger"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Ouvrir le menu"
        >
          <span />
          <span />
          <span />
        </button>
        <div className="crm-mobile-logo">
          <div className="crm-sidebar-logo-mark" style={{ width: 26, height: 26, fontSize: 11, borderRadius: 7 }}>S</div>
          <span style={{ fontWeight: 900, fontSize: 13, letterSpacing: "1.5px", color: "var(--crm-text)" }}>SOCLE</span>
          <span style={{ fontWeight: 700, fontSize: 10, letterSpacing: "1px", color: "var(--crm-gold)" }}>ACQUISITIONS</span>
        </div>
      </div>

      {/* Mobile slide-out */}
      {mobileOpen && (
        <>
          <div
            className="crm-mobile-overlay"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="crm-sidebar crm-sidebar--mobile" style={{ display: "flex" }}>
            {sidebar}
          </aside>
        </>
      )}
    </>
  );
}

// ── Inline SVG icons (Heroicons outline) ─────────────────────────────────────
function NavIcon({ name, small }: { name: string; small?: boolean }) {
  const size = small ? 14 : 16;
  const paths: Record<string, string> = {
    dashboard:   "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
    pipeline:    "M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2",
    leads:       "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
    import:      "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12",
    calls:       "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
    review:      "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
    phone:       "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
    followups:   "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    calendar:    "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    users:       "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
    map:         "M9 20.42l-5.95-5.95a7 7 0 1112.04-4.95A7 7 0 019 20.42zM9 13a2 2 0 100-4 2 2 0 000 4z",
    enrichment:  "M13 10V3L4 14h7v7l9-11h-7z",
    events:      "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
    costs:       "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    health:      "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
    properties:  "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
    contacts:    "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, opacity: 0.7 }}
    >
      <path d={paths[name] ?? paths.leads} />
    </svg>
  );
}
