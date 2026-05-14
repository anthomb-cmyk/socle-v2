"use client";
// Mobile bottom tab bar — visible only on phones (<768px).
// Provides fast 1-tap access to the 4 caller-facing sections.
// Hidden entirely on desktop by CSS media query.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "./locale-provider";

type Tab = {
  href: string;
  labelFr: string;
  labelEn: string;
  icon: React.ReactNode;
};

function PhoneIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}

function LeadsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="6"  x2="21" y2="6"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  );
}

const TABS: Tab[] = [
  // Appels → the iOS-style Téléphone page (keypad + récents).
  // The call queue is still reachable via Menu → File d'appels.
  { href: "/quick-call",   labelFr: "Appels",   labelEn: "Calls",    icon: <PhoneIcon /> },
  { href: "/follow-ups",   labelFr: "Suivis",   labelEn: "Follow-up",icon: <CalendarIcon /> },
  { href: "/leads",        labelFr: "Leads",    labelEn: "Leads",    icon: <LeadsIcon /> },
  { href: "/",             labelFr: "Menu",     labelEn: "Menu",     icon: <MenuIcon /> },
];

export default function MobileBottomNav() {
  const pathname = usePathname();
  const { locale } = useLocale();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <nav className="crm-mobile-bottom-nav" aria-label="Navigation principale">
      {TABS.map((tab) => {
        const active = isActive(tab.href);
        const label = locale === "fr" ? tab.labelFr : tab.labelEn;
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
      })}
    </nav>
  );
}
