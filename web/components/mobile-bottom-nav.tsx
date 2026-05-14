"use client";
// Mobile bottom tab bar — visible only on phones (<768px).
// 4 tabs: Appels / Suivis / Textos / Plus. The last one isn't a route — it
// dispatches MOBILE_MENU_TOGGLE_EVENT so the sidebar overlay slides in
// under-thumb (instead of forcing users to reach the top-left hamburger).
//
// The full sidebar (including Leads / Revue / Import) is reachable from
// there with no extra friction.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "./locale-provider";
import { MOBILE_MENU_TOGGLE_EVENT } from "./app-sidebar";

type RouteTab = {
  kind: "route";
  href: string;
  labelKey: "calls" | "followUps" | "texts";
  icon: React.ReactNode;
};
type ActionTab = {
  kind: "action";
  labelKey: "more";
  icon: React.ReactNode;
};
type Tab = RouteTab | ActionTab;

function PhoneIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}

function TextsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8v.5z" />
    </svg>
  );
}

function PlusGridIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3"  y="3"  width="7" height="7" rx="1.5" />
      <rect x="14" y="3"  width="7" height="7" rx="1.5" />
      <rect x="3"  y="14" width="7" height="7" rx="1.5" />
      <path d="M17.5 14v7M14 17.5h7" />
    </svg>
  );
}

const TABS: Tab[] = [
  { kind: "route",  href: "/quick-call", labelKey: "calls",     icon: <PhoneIcon /> },
  { kind: "route",  href: "/follow-ups", labelKey: "followUps", icon: <CalendarIcon /> },
  { kind: "route",  href: "/textos",     labelKey: "texts",     icon: <TextsIcon /> },
  { kind: "action",                       labelKey: "more",      icon: <PlusGridIcon /> },
];

// The `role` prop is accepted for future role-specific tab sets but unused
// for now — both admin and caller benefit from the same 3 routes + Plus.
export default function MobileBottomNav({ role: _role }: { role?: "admin" | "caller" }) {
  const pathname = usePathname();
  const { t } = useLocale();

  function isActive(href: string) {
    return pathname?.startsWith(href) ?? false;
  }

  function openSidebar() {
    window.dispatchEvent(new CustomEvent(MOBILE_MENU_TOGGLE_EVENT));
  }

  return (
    <nav className="crm-mobile-bottom-nav" aria-label="Navigation principale">
      {TABS.map((tab, i) => {
        const label = t.mobileNav[tab.labelKey];
        if (tab.kind === "route") {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href as never}
              className={`crm-mobile-bottom-tab${active ? " crm-mobile-bottom-tab--active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {tab.icon}
              <span>{label}</span>
            </Link>
          );
        }
        return (
          <button
            key={`action-${i}`}
            type="button"
            className="crm-mobile-bottom-tab"
            onClick={openSidebar}
            aria-label={t.mobileNav.moreAria}
            aria-haspopup="dialog"
          >
            {tab.icon}
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
