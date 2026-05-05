"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/locale-provider";
import CallerSelect from "@/components/caller/CallerSelect";
import CallerInput from "@/components/caller/CallerInput";
import CallerDateTimeInput from "@/components/caller/CallerDateTimeInput";
import CallerField from "@/components/caller/CallerField";
import OutcomeButtonGroup, { type OutcomeOption } from "@/components/caller/OutcomeButtonGroup";

// ── Twilio call state ────────────────────────────────────────────────────────
type TwilioCallState = "idle" | "initiating" | "ringing" | "answered" | "completed" | "failed";

type Phone = { id: string; e164: string; display: string | null; status: string; source: string; confidence: number };

/** Default datetime-local value: tomorrow at 10:00 */
function defaultCallbackTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

export default function CallWorkspace({
  leadId,
  phones,
  userForwardTo,
}: {
  leadId: string;
  phones: Phone[];
  userForwardTo: string | null;
}) {
  const router = useRouter();
  const { t } = useLocale();

  const [phoneId, setPhoneId] = useState<string | null>(phones[0]?.id ?? null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitForm, setSubmitForm] = useState<string | null>(null);

  // call_back_later state
  const [showCallbackPicker, setShowCallbackPicker] = useState(false);
  const [callbackTime, setCallbackTime] = useState(defaultCallbackTime());

  // Hot-seller submission form state
  const [interest, setInterest]       = useState<"cold" | "warm" | "hot" | "wants_offer">("hot");
  const [timeline, setTimeline]       = useState<"immediate" | "3_months" | "6_months" | "no_rush" | "unknown">("3_months");
  const [motivation, setMotivation]   = useState("");
  const [askingPrice, setAskingPrice] = useState("");
  const [callerSummary, setCallerSummary] = useState("");

  // Twilio call state
  const [callState, setCallState] = useState<TwilioCallState>("idle");
  const [callError, setCallError] = useState<string | null>(null);
  const activeCallLogId = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Outcome catalogs ──────────────────────────────────────────────────────
  // Variants are visual only; the value strings remain unchanged for routing.
  const QUICK_OUTCOMES: ReadonlyArray<{ value: string; variant: OutcomeOption["variant"] }> = [
    { value: "no_answer",      variant: "neutral"  },
    { value: "voicemail_left", variant: "neutral"  },
    { value: "wrong_number",   variant: "negative" },
    { value: "bad_number",     variant: "negative" },
    { value: "not_interested", variant: "danger"   },
    { value: "do_not_contact", variant: "danger"   },
    { value: "maybe_later",    variant: "info"     },
  ];

  const HOT_OUTCOMES = [
    "wants_more_info",
    "open_to_selling",
    "wants_offer",
    "hot_seller",
    "follow_up_booked",
  ] as const;

  type Outcome = string;

  const ESCALATING = new Set<string>([
    "wants_more_info", "open_to_selling", "wants_offer", "hot_seller", "follow_up_booked",
  ]);

  const CALL_STATE_LABELS: Record<TwilioCallState, string> = {
    idle:       "",
    initiating: t.workspace.connecting,
    ringing:    t.workspace.ringing,
    answered:   t.workspace.answered,
    completed:  t.workspace.callCompleted,
    failed:     t.workspace.callFailed,
  };

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  function startPolling(callLogId: string) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/calls/status?callLogId=${callLogId}`);
        const j = await r.json();
        if (!j.ok) return;
        const events = (j.data?.statusEvents ?? []) as { status: string }[];
        const last = events[events.length - 1]?.status ?? "";
        if (last === "in-progress") setCallState("answered");
        if (last === "completed" || (j.data?.durationSec != null)) {
          setCallState("completed"); stopPolling();
        }
      } catch { /* non-fatal */ }
    }, 3000);
  }

  useEffect(() => () => stopPolling(), []);

  async function startCall() {
    if (!phoneId) { setCallError(t.workspace.selectPhone); return; }
    if (!userForwardTo) {
      setCallError(t.workspace.noForwardNumber);
      return;
    }
    setCallState("initiating");
    setCallError(null);
    try {
      const r = await fetch("/api/twilio/calls/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, phoneId }),
      });
      const j = await r.json();
      if (!j.ok) {
        setCallState("failed");
        setCallError(j.error ?? t.workspace.callLaunchFailed);
        return;
      }
      activeCallLogId.current = j.data.callLogId;
      setCallState("ringing");
      startPolling(j.data.callLogId);
    } catch {
      setCallState("failed");
      setCallError(t.workspace.networkError);
    }
  }

  // ── Call lock lifecycle ──────────────────────────────────────────────────
  const lockAcquired = useRef(false);

  useEffect(() => {
    let released = false;

    async function acquireLock() {
      try {
        const r = await fetch("/api/calls/lock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId }),
        });
        const j = await r.json();
        if (j.ok) lockAcquired.current = true;
        // 409 = another caller has this lead; non-fatal — just won't hold a lock
      } catch {
        // Network error — non-fatal
      }
    }

    acquireLock();

    return () => {
      if (released) return;
      released = true;
      if (lockAcquired.current) {
        navigator.sendBeacon(`/api/calls/lock?leadId=${leadId}`, new Blob([], { type: "text/plain" }));
        fetch(`/api/calls/lock?leadId=${leadId}`, { method: "DELETE", keepalive: true }).catch(() => {});
      }
    };
  }, [leadId]);

  // ── Outcome handlers ─────────────────────────────────────────────────────

  async function logOutcome(outcome: Outcome, nextCallAt?: string) {
    setBusy(true);
    setError(null);

    const body: Record<string, unknown> = { leadId, phoneId, outcome, notes: notes || null };
    if (nextCallAt) body.nextCallAt = new Date(nextCallAt).toISOString();

    const r = await fetch("/api/calls/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) { setError(j.error); setBusy(false); return; }

    if (ESCALATING.has(outcome)) {
      setSubmitForm(outcome);
      setBusy(false);
      if (notes && !callerSummary) setCallerSummary(notes);
      return;
    }

    await goNext();
  }

  function handleCallBackLater() {
    if (!showCallbackPicker) {
      setShowCallbackPicker(true);
      return;
    }
    setShowCallbackPicker(false);
    logOutcome("call_back_later", callbackTime);
  }

  async function goNext() {
    const r = await fetch(`/api/calls/next?afterLeadId=${leadId}`);
    const j = await r.json();
    const nextId = j?.data?.nextLeadId;
    if (nextId) router.push(`/calls/${nextId}` as never);
    else router.push("/calls/queue" as never);
  }

  async function submitToAnthony() {
    if (!submitForm) return;
    if (callerSummary.trim().length < 5) {
      setError(t.workspace.summaryTooShort);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await fetch("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadId,
        outcome: submitForm,
        sellerInterestLevel: interest,
        timeline,
        motivation: motivation || null,
        askingPrice: askingPrice ? Number(askingPrice) : null,
        callerSummary,
      }),
    });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) { setError(j.error); return; }
    await goNext();
  }

  const quickOptions: OutcomeOption[] = QUICK_OUTCOMES.map((o) => ({
    value: o.value,
    label: t.outcome[o.value] ?? o.value,
    variant: o.variant,
  }));

  const hotOptions: OutcomeOption[] = HOT_OUTCOMES.map((value) => ({
    value,
    label: t.outcome[value] ?? value,
    variant: "escalating",
  }));

  const selectedPhone = phones.find((p) => p.id === phoneId) ?? null;

  // ── Submission form (escalating outcomes) ────────────────────────────────
  if (submitForm) {
    const outcomeLabel = t.outcome[submitForm] ?? submitForm;
    return (
      <div
        className="crm-card"
        style={{
          padding: 20,
          borderColor: "var(--crm-gold-border)",
          background: "var(--crm-gold-light)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: "var(--crm-text)", margin: 0 }}>
            {t.workspace.submitTitle}
          </h2>
          <p style={{ fontSize: 13, color: "var(--crm-text2)", margin: "4px 0 0" }}>
            {t.workspace.submitSubtitle(outcomeLabel)}
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <CallerField label={t.workspace.interestLevel}>
            <CallerSelect value={interest} onChange={(e) => setInterest(e.target.value as typeof interest)}>
              <option value="cold">cold</option>
              <option value="warm">warm</option>
              <option value="hot">hot</option>
              <option value="wants_offer">wants offer</option>
            </CallerSelect>
          </CallerField>
          <CallerField label={t.workspace.timeline}>
            <CallerSelect value={timeline} onChange={(e) => setTimeline(e.target.value as typeof timeline)}>
              <option value="immediate">immediate</option>
              <option value="3_months">3 months</option>
              <option value="6_months">6 months</option>
              <option value="no_rush">no rush</option>
              <option value="unknown">unknown</option>
            </CallerSelect>
          </CallerField>
        </div>

        <CallerField label={t.workspace.motivation}>
          <CallerInput
            value={motivation}
            onChange={(e) => setMotivation(e.target.value)}
            placeholder={t.workspace.motivationPlaceholder}
          />
        </CallerField>

        <CallerField label={t.workspace.askingPrice}>
          <CallerInput
            type="number"
            value={askingPrice}
            onChange={(e) => setAskingPrice(e.target.value)}
            placeholder="e.g. 1600000"
          />
        </CallerField>

        <CallerField label={t.workspace.summary}>
          <textarea
            value={callerSummary}
            onChange={(e) => setCallerSummary(e.target.value)}
            rows={4}
            className="crm-notes-textarea crm-input"
            placeholder={t.workspace.summaryPlaceholder}
          />
        </CallerField>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={submitToAnthony}
            disabled={busy}
            className="crm-btn crm-btn-gold"
            style={{ minHeight: 44 }}
          >
            {busy ? t.workspace.submitting : t.workspace.submitBtn}
          </button>
          <button
            onClick={() => router.push("/calls/queue")}
            className="crm-btn"
            style={{ minHeight: 44 }}
          >
            {t.workspace.skipSubmission}
          </button>
        </div>
        {error && (
          <p style={{ fontSize: 13, color: "var(--crm-red)", margin: 0 }}>{error}</p>
        )}
      </div>
    );
  }

  // ── Main workspace ────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={goNext}
          disabled={busy}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            color: "var(--crm-text3)",
            textDecoration: "underline",
          }}
        >
          {t.workspace.skipNextLead}
        </button>
      </div>

      {phones.length > 0 ? (
        <CallerField label={t.workspace.phoneDialed}>
          <CallerSelect
            value={phoneId ?? ""}
            onChange={(e) => setPhoneId(e.target.value || null)}
            style={{ fontFeatureSettings: '"tnum" 1' }}
          >
            {phones.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display ?? p.e164}
                {p.status !== "unverified" ? ` (${p.status})` : ""} · {p.source} · conf {p.confidence}
              </option>
            ))}
          </CallerSelect>
        </CallerField>
      ) : (
        <div
          className="crm-card"
          style={{
            padding: "12px 14px",
            background: "var(--crm-amber-light)",
            borderColor: "color-mix(in srgb, var(--crm-amber) 25%, transparent)",
            color: "var(--crm-amber)",
            fontSize: 13,
          }}
        >
          {t.workspace.noPhones}
        </div>
      )}

      {/* ── Phone CTA card: tap-to-call + Twilio launcher ─────────────────── */}
      {phones.length > 0 && selectedPhone && (
        <div className="crm-phone-cta">
          <a
            href={`tel:${selectedPhone.e164}`}
            className="crm-phone-cta__number"
            aria-label={selectedPhone.display ?? selectedPhone.e164}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
            <span style={{ fontFeatureSettings: '"tnum" 1' }}>
              {selectedPhone.display ?? selectedPhone.e164}
            </span>
          </a>

          <div className="crm-phone-cta__row">
            {(callState === "idle" || callState === "failed" || callState === "completed") ? (
              <button onClick={startCall} disabled={!phoneId} className="crm-call-btn">
                {t.workspace.call}
              </button>
            ) : (
              <button disabled className="crm-call-btn crm-call-btn--busy">
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 9999,
                    background:
                      callState === "answered" ? "var(--crm-red)" : "var(--crm-amber)",
                    display: "inline-block",
                    animation: "crm-pulse 1.2s ease-in-out infinite",
                  }}
                />
                {CALL_STATE_LABELS[callState]}
              </button>
            )}
            <span className="crm-phone-cta__hint" style={{ flex: 1, minWidth: 160 }}>
              {callState === "idle" && (userForwardTo ? (
                <>
                  {t.workspace.willRingOn}{" "}
                  <span style={{ fontFeatureSettings: '"tnum" 1', color: "var(--crm-text2)", fontWeight: 600 }}>
                    {userForwardTo}
                  </span>
                </>
              ) : (
                <span style={{ color: "var(--crm-amber)" }}>
                  {t.workspace.forwardNotConfigured}
                </span>
              ))}
              {callState === "ringing"   && t.workspace.pickup}
              {callState === "answered"  && t.workspace.connected}
              {callState === "completed" && t.workspace.selectOutcome}
            </span>
          </div>
        </div>
      )}
      {callError && (
        <p
          style={{
            fontSize: 13,
            color: "var(--crm-red)",
            background: "var(--crm-red-light)",
            border: "1px solid color-mix(in srgb, var(--crm-red) 25%, transparent)",
            borderRadius: 10,
            padding: "8px 12px",
            margin: 0,
          }}
        >
          {callError}
        </p>
      )}

      <CallerField label={t.workspace.notesLabel}>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="crm-notes-textarea crm-input"
          placeholder={t.workspace.notesPlaceholder}
        />
      </CallerField>

      {/* Quick outcomes */}
      <div>
        <div className="crm-field-label" style={{ marginBottom: 8 }}>
          {t.workspace.quickOutcome}
        </div>
        <OutcomeButtonGroup options={quickOptions} onSelect={(v) => logOutcome(v)} disabled={busy} />
      </div>

      {/* Scheduled callback */}
      <div>
        <div className="crm-field-label" style={{ marginBottom: 8 }}>
          {t.workspace.scheduleCallback}
        </div>
        {showCallbackPicker ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <CallerDateTimeInput
              value={callbackTime}
              onChange={(e) => setCallbackTime(e.target.value)}
              style={{ width: "auto", flex: "1 1 220px" }}
            />
            <button
              onClick={handleCallBackLater}
              disabled={busy || !callbackTime}
              className="crm-outcome-btn crm-outcome-btn--info"
              style={{ flex: "0 0 auto" }}
            >
              {busy ? t.workspace.savingCallback : t.workspace.confirmCallback}
            </button>
            <button
              onClick={() => setShowCallbackPicker(false)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--crm-text3)",
                textDecoration: "underline",
              }}
            >
              {t.workspace.cancelCallback}
            </button>
          </div>
        ) : (
          <button
            disabled={busy}
            onClick={handleCallBackLater}
            className="crm-outcome-btn crm-outcome-btn--info"
            style={{ width: "auto" }}
          >
            {t.workspace.callBackLater}
          </button>
        )}
      </div>

      {/* Hot / escalating outcomes → send to Anthony */}
      <div>
        <div className="crm-field-label" style={{ marginBottom: 8 }}>
          {t.workspace.sendToAnthony}
        </div>
        <OutcomeButtonGroup options={hotOptions} onSelect={(v) => logOutcome(v)} disabled={busy} />
      </div>

      {error && (
        <p style={{ fontSize: 13, color: "var(--crm-red)", margin: 0 }}>{error}</p>
      )}

      {/* Local keyframes for the call-state pulse */}
      <style jsx>{`
        @keyframes crm-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}
