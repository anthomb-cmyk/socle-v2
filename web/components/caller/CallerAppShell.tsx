import * as React from "react";

type Width = "narrow" | "wide";

type Props = {
  children: React.ReactNode;
  /** Optional header/breadcrumb slot, rendered above the main content. */
  header?: React.ReactNode;
  /** Optional stats / KPI strip slot. Phase 3 wires this on the queue page. */
  stats?: React.ReactNode;
  /** Optional sticky-bottom slot. Phase 4 wires this for the mobile call bar. */
  bottom?: React.ReactNode;
  /** Container width. narrow = 760px (caller workspace). wide = 1280px (queue + phone-review with preview panels). */
  width?: Width;
};

/**
 * Shared layout shell for caller-module routes.
 * Renders the page-level <main> and provides consistent padding,
 * max-width, vertical rhythm, and safe-area handling on mobile.
 *
 * Server component — no hooks, no state. Pages opt in by wrapping their
 * existing children in <CallerAppShell>...</CallerAppShell>. The global
 * AppSidebar + MobileBottomNav (mounted in app/layout.tsx) continue to
 * surround this shell as before.
 */
export default function CallerAppShell({
  children,
  header,
  stats,
  bottom,
  width = "narrow",
}: Props) {
  return (
    <main className={`so-shell so-shell--${width}`}>
      {header ? <div className="so-shell__header">{header}</div> : null}
      {stats ? <div className="so-shell__stats">{stats}</div> : null}
      <div className="so-shell__main">{children}</div>
      {bottom ? <div className="so-shell__bottom">{bottom}</div> : null}
    </main>
  );
}
