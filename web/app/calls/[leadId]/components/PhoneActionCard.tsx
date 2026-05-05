"use client";
import * as React from "react";
import Link from "next/link";
import { useLocale } from "@/components/locale-provider";
import PhoneSelector, { type Phone } from "./PhoneSelector";
import TwilioCallStatePanel, { type CallState } from "./TwilioCallStatePanel";

type Props = {
  phones: Phone[];
  selectedPhoneId: string | null;
  onSelectPhone: (id: string) => void;
  userForwardTo: string | null;
  callState: CallState;
  durationSec: number;
  callError: string | null;
  onTwilioCall: () => void;
};

/**
 * Phase 4 — dominant phone CTA card.
 * Pure presentation. Receives Twilio call state + selected phone + the
 * "start call" callback from CallWorkspace.tsx. Owns no state of its own
 * apart from rendering decisions based on incoming props.
 *
 * States rendered:
 *   - no-phone (phones.length === 0): amber warning card with link to phone-review
 *   - idle: large gold "Appeler" + tel: link
 *   - initiating/ringing/answered: busy button + TwilioCallStatePanel
 *   - completed: brief success line, button returns to idle for retry
 *   - failed: red error + button re-enabled
 *   - no-forward (userForwardTo == null): Twilio button disabled + amber hint;
 *     tel: link still works
 */
export default function PhoneActionCard({
  phones,
  selectedPhoneId,
  onSelectPhone,
  userForwardTo,
  callState,
  durationSec,
  callError,
  onTwilioCall,
}: Props) {
  const { t } = useLocale();

  // No-phone state replaces the entire card.
  if (phones.length === 0) {
    return (
      <div className="cw-card cw-phone-card cw-phone-card--no-phone">
        <div className="cw-phone-card__warn-title">{t.workspace.noPhonesTitle}</div>
        <div className="cw-phone-card__warn-body">{t.workspace.noPhones}</div>
        <Link href="/phone-review" className="crm-btn">
          {t.workspace.markForReview}
        </Link>
      </div>
    );
  }

  const selected = phones.find((p) => p.id === selectedPhoneId) ?? phones[0];
  const noForward = !userForwardTo;
  const isActive = callState === "initiating" || callState === "ringing" || callState === "answered";
  const isPostCall = callState === "completed" || callState === "failed";

  return (
    <div className="cw-card cw-phone-card">
      <div className="cw-phone-card__head">
        <span className="cw-phone-card__label">{t.workspace.mainPhone}</span>
        <span className={`so-confidence-badge so-confidence-badge--${confidenceVariant(selected.confidence)}`}>
          {selected.confidence}%
        </span>
        <span className="cw-source-chip">{selected.source}</span>
      </div>

      <div className="cw-phone-card__num-row">
        <a
          href={`tel:${selected.e164}`}
          className="cw-phone-card__num"
          aria-label={selected.display ?? selected.e164}
          style={{ fontFeatureSettings: '"tnum" 1' }}
        >
          {selected.display ?? selected.e164}
        </a>
        <PhoneSelector phones={phones} selectedPhoneId={selected.id} onSelect={onSelectPhone} />
      </div>

      <div className="cw-phone-card__actions">
        {!isActive ? (
          <button
            type="button"
            onClick={onTwilioCall}
            disabled={noForward || !selected}
            className="cw-call-btn cw-call-btn--primary"
          >
            <PhoneIcon />
            {t.workspace.call}
          </button>
        ) : (
          <button type="button" disabled className="cw-call-btn cw-call-btn--busy">
            <BusyDot state={callState} />
            {labelForState(callState, t)}
          </button>
        )}
        <a href={`tel:${selected.e164}`} className="cw-call-btn cw-call-btn--outline">
          {t.workspace.tapToCall}
        </a>
      </div>

      <div className="cw-phone-card__hint">
        {!isActive && !isPostCall && (
          noForward ? (
            <span style={{ color: "var(--so-warn)" }}>{t.workspace.forwardNotConfigured}</span>
          ) : (
            <>
              {t.workspace.willRingOn}{" "}
              <span style={{ fontFeatureSettings: '"tnum" 1', fontWeight: 600 }}>{userForwardTo}</span>
            </>
          )
        )}
        {callState === "ringing"   && t.workspace.pickup}
        {callState === "answered"  && t.workspace.connected}
        {callState === "completed" && t.workspace.selectOutcome}
      </div>

      {callError && <div className="cw-phone-card__error">{callError}</div>}

      {/* Twilio state strip lives INSIDE the card while a call is active. */}
      {(isActive || callState === "completed") && (
        <TwilioCallStatePanel callState={callState} durationSec={durationSec} />
      )}
    </div>
  );
}

function confidenceVariant(score: number): "high" | "mid" | "low" {
  if (score >= 80) return "high";
  if (score >= 50) return "mid";
  return "low";
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

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BusyDot({ state }: { state: CallState }) {
  const color =
    state === "answered" ? "var(--so-success)"
    : state === "failed" ? "var(--so-danger)"
    : "var(--so-warn)";
  return (
    <span
      aria-hidden="true"
      style={{
        width: 8,
        height: 8,
        borderRadius: 9999,
        background: color,
        display: "inline-block",
        animation: "cw-pulse 1.2s ease-in-out infinite",
      }}
    />
  );
}
