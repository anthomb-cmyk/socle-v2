"use client";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

type Props = {
  /** When non-null, the banner renders. Pass null to hide. */
  lockedBy: { name: string; sinceISO: string } | null;
};

/**
 * Phase 4 — informational banner shown above the workspace when a 409
 * came back from /api/calls/lock (someone else holds the lock). The
 * banner is purely informational — the existing 409-is-non-fatal logic
 * in CallWorkspace.tsx is unchanged; the page does not block.
 *
 * Local "dismissed" state is cosmetic and explicitly allowed by the
 * Phase 4 rules. The banner re-mounts (and so re-renders) if the lock
 * status changes upstream.
 */
export default function LockStatusBanner({ lockedBy }: Props) {
  const { t } = useLocale();
  const [dismissed, setDismissed] = useState(false);

  if (!lockedBy || dismissed) return null;

  return (
    <div className="cw-lock-banner" role="status" aria-live="polite">
      <span className="cw-lock-banner__icon" aria-hidden="true">
        <LockIcon />
      </span>
      <span className="cw-lock-banner__text">
        {t.workspace.lockedByOther(lockedBy.name)}
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="cw-lock-banner__dismiss"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
