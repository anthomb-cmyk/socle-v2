"use client";
import * as React from "react";
import { useEffect, useRef } from "react";
import { useLocale } from "@/components/locale-provider";

type Props = {
  open: boolean;
  /** Title shown in the slide-over top bar. */
  title: string;
  onClose: () => void;
  /** Element ID of the row that opened the slide-over, so focus can return on close. */
  returnFocusToId?: string | null;
  children: React.ReactNode;
};

/**
 * Phase 5 — mobile-only slide-over for the candidate evidence panel.
 * Hidden on desktop (≥1180px) via CSS — never rendered visibly there.
 * Behaviour:
 *  - role="dialog" + aria-modal="true" while open
 *  - Escape key dismisses on devices with a keyboard
 *  - Focus moves to the back chevron on open
 *  - On close, focus returns to the row whose id is `returnFocusToId`
 *  - The list scroll position survives because the list is NOT unmounted
 *    by the orchestrator — only this slide-over is shown/hidden.
 */
export default function PhoneReviewMobileSlideover({
  open, title, onClose, returnFocusToId, children,
}: Props) {
  const { t } = useLocale();
  const backRef = useRef<HTMLButtonElement | null>(null);

  // Focus management + Escape-to-dismiss
  useEffect(() => {
    if (!open) return;

    // Focus the back chevron on open
    backRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // On unmount of the open phase: return focus to the originating row
      if (returnFocusToId) {
        const el = document.getElementById(returnFocusToId);
        if (el && typeof (el as HTMLElement).focus === "function") {
          (el as HTMLElement).focus();
        }
      }
    };
  }, [open, onClose, returnFocusToId]);

  return (
    <div
      className={`pr-mobile-slideover${open ? " pr-mobile-slideover--open" : ""}`}
      role="dialog"
      aria-modal={open ? "true" : "false"}
      aria-hidden={open ? "false" : "true"}
    >
      <div className="pr-mobile-slideover__bar">
        <button
          ref={backRef}
          type="button"
          onClick={onClose}
          className="pr-mobile-slideover__back"
          aria-label={t.review.dismissAria}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{t.review.dismissAria}</span>
        </button>
        <div className="pr-mobile-slideover__title">{title}</div>
      </div>
      <div className="pr-mobile-slideover__body">
        {children}
      </div>
    </div>
  );
}
