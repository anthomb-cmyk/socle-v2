"use client";
import * as React from "react";
import Link from "next/link";
import { useLocale } from "@/components/locale-provider";

export type AdminScope = "all" | "mine" | "unassigned";

type Props = {
  /** Currently-resolved scope (after server-side security gate). */
  scope: AdminScope;
};

/**
 * Admin-only scope chips: All / Mine / Unassigned.
 * Caller-tier users NEVER see this component — server forces their scope
 * to "mine" regardless of any ?scope=… URL param. Each chip navigates
 * via Next.js Link so the selection is shareable and refresh-stable.
 */
export default function CallerQueueScopeBar({ scope }: Props) {
  const { t } = useLocale();
  return (
    <div className="so-queue-scope-bar" role="group" aria-label="Admin queue scope">
      <span className="so-queue-scope-bar__badge">{t.queue.scopeAdminBadge}</span>
      <ScopeChip target="all" current={scope}>{t.queue.scopeAll}</ScopeChip>
      <ScopeChip target="mine" current={scope}>{t.queue.scopeMine}</ScopeChip>
      <ScopeChip target="unassigned" current={scope}>{t.queue.scopeUnassigned}</ScopeChip>
    </div>
  );
}

function ScopeChip({
  target, current, children,
}: { target: AdminScope; current: AdminScope; children: React.ReactNode }) {
  const active = current === target;
  return (
    <Link
      href={`/calls/queue?scope=${target}` as never}
      className={`so-queue-scope-chip${active ? " so-queue-scope-chip--active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
