"use client";
import { useLocale } from "@/components/locale-provider";

export type CallState = "idle" | "initiating" | "ringing" | "answered" | "completed" | "failed";

type Props = {
  callState: CallState;
  durationSec: number;
};

/**
 * Phase 4 — Twilio call state strip rendered INSIDE PhoneActionCard while
 * the call is active. Per scope updates, mute/keypad icons are dropped
 * (no backing API in the bridge model). Hangup is rendered as a visually
 * disabled affordance with hint copy directing the caller to hang up from
 * their physical phone.
 *
 * Pure presentation: no timers, no fetches. Duration is pre-computed by
 * CallWorkspace.tsx from the polled status payload and passed in as a number.
 */
export default function TwilioCallStatePanel({ callState, durationSec }: Props) {
  const { t } = useLocale();
  const stateLabel = labelForState(callState, t);
  const showDuration = callState === "answered" && durationSec > 0;

  return (
    <div className={`cw-state-panel cw-state-panel--${callState}`}>
      <div className="cw-state-panel__indicator" aria-hidden="true">
        <Dot state={callState} />
      </div>
      <div className="cw-state-panel__center">
        <span className="cw-state-panel__label">{stateLabel}</span>
        {showDuration && (
          <span className="cw-state-panel__duration" style={{ fontFeatureSettings: '"tnum" 1' }}>
            {formatDuration(durationSec)}
          </span>
        )}
      </div>
      <div className="cw-state-panel__right">
        {/* Hangup is informational-only — bridge model means hangup happens on
            the caller's physical phone. Rendered as an outlined disabled button
            so the design's "call control area" doesn't disappear visually. */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="cw-hangup-affordance"
          title={t.workspace.hangupHint}
        >
          <HangupIcon />
          <span className="cw-hangup-affordance__label">{t.workspace.hangup}</span>
        </button>
        <span className="cw-hangup-affordance__hint">{t.workspace.hangupHint}</span>
      </div>
    </div>
  );
}

function labelForState(s: CallState, t: ReturnType<typeof useLocale>["t"]): string {
  switch (s) {
    case "initiating": return t.workspace.connecting;
    case "ringing":    return t.workspace.ringing;
    case "answered":   return t.workspace.answered;
    case "completed":  return t.workspace.callCompleted;
    case "failed":     return t.workspace.callFailed;
    default:           return "";
  }
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function Dot({ state }: { state: CallState }) {
  const base = "cw-state-panel__dot";
  const variant =
    state === "answered" ? `${base} ${base}--live`
    : state === "failed" ? `${base} ${base}--failed`
    : state === "completed" ? `${base} ${base}--done`
    : `${base} ${base}--pending`;
  return <span className={variant} />;
}

function HangupIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 11a9 9 0 0118 0v2a2 2 0 01-2 2h-2a1 1 0 01-1-1v-2a1 1 0 011-1h1a7 7 0 00-14 0h1a1 1 0 011 1v2a1 1 0 01-1 1H5a2 2 0 01-2-2v-2z"
        fill="currentColor"
        transform="rotate(135 12 12)"
      />
    </svg>
  );
}
