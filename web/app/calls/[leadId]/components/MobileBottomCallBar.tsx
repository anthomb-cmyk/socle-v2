"use client";
import { useLocale } from "@/components/locale-provider";

type Props = {
  visible: boolean;
  durationSec: number;
};

/**
 * Phase 4 — fixed-bottom strip shown on mobile while a call is "answered".
 * Layered above the existing MobileBottomNav (z-index 60 vs 50);
 * does NOT replace it. Hidden on desktop via CSS.
 *
 * Per scope updates, mute/keypad icons are dropped (no backing API in the
 * bridge model). The right side is a disabled hangup affordance with hint
 * copy; hangup happens on the caller's physical phone.
 */
export default function MobileBottomCallBar({ visible, durationSec }: Props) {
  const { t } = useLocale();
  if (!visible) return null;

  return (
    <div className="cw-mobile-call-bar" role="region" aria-label={t.workspace.answered}>
      <div className="cw-mobile-call-bar__left">
        <span className="cw-mobile-call-bar__dot" aria-hidden="true" />
        <span className="cw-mobile-call-bar__label">{t.workspace.answered}</span>
        <span
          className="cw-mobile-call-bar__duration"
          style={{ fontFeatureSettings: '"tnum" 1' }}
        >
          {formatDuration(durationSec)}
        </span>
      </div>
      <div className="cw-mobile-call-bar__right">
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="cw-mobile-call-bar__hangup"
          title={t.workspace.hangupHint}
        >
          {t.workspace.hangup}
        </button>
        <span className="cw-mobile-call-bar__hint">{t.workspace.hangupHint}</span>
      </div>
    </div>
  );
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
