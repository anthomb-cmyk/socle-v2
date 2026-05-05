"use client";
// Phase 4: CallWorkspace remains the single state owner for /calls/[leadId].
// All state, effects, fetches, polling, lock acquire/release, and outcome
// routing live here unchanged. Only the JSX has been reorganized into the
// new presentational components in ./components/. The single new state
// (durationSec) is explicitly allowed by Phase 4: it persists the
// j.data?.durationSec value the polling already extracts so child
// components can render the live duration.
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/locale-provider";
import OutcomeButtonGroup, { type OutcomeOption } from "@/components/caller/OutcomeButtonGroup";

import LockStatusBanner from "./components/LockStatusBanner";
import OwnerCard from "./components/OwnerCard";
import PropertyCard from "./components/PropertyCard";
import PhoneActionCard from "./components/PhoneActionCard";
import CallNotesPanel from "./components/CallNotesPanel";
import CallbackScheduler from "./components/CallbackScheduler";
import HotSellerSubmissionPanel, {
  type SubmissionValues,
} from "./components/HotSellerSubmissionPanel";
import MobileBottomCallBar from "./components/MobileBottomCallBar";

// ── Twilio call state ────────────────────────────────────────────────────────
type TwilioCallState = "idle" | "initiating" | "ringing" | "answered" | "completed" | "failed";

type Phone = {
  id: string;
  e164: string;
  display: string | null;
  status: string;
  source: string;
  confidence: number;
};

type WorkspaceLead = {
  full_name: string | null;
  company_name: string | null;
  address: string;
  city: string | null;
  num_units: number | null;
  contact_kind: string | null;
  status: string;
  campaign_name: string | null;
  priority: number | null;
  evaluation_total?: number | null;
};

/** Default datetime-local value: tomorrow at 10:00 */
function defaultCallbackTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  // yyyy-mm-ddThh:mm — local, no timezone shift
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CallWorkspace({
  leadId,
  phones,
  userForwardTo,
  lead,
  callCount,
}: {
  leadId: string;
  phones: Phone[];
  userForwardTo: string | null;
  lead: WorkspaceLead;
  callCount: number;
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
  // Phase 4 new state: persists the polled j.data?.durationSec so children
  // can render a live MM:SS counter. Polling cadence and completion logic
  // unchanged.
  const [durationSec, setDurationSec] = useState<number>(0);
  const activeCallLogId = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Outcome catalogs (visual groups; routing values unchanged) ─────────────
  const QUICK_OUTCOMES: ReadonlyArray<{ value: string; variant: OutcomeOption["variant"] }> = [
    { value: "no_answer",      variant: "neutral"  },
    { value: "voicemail_left", variant: "neutral"  },
    { value: "wrong_number",   variant: "negative" },
    { value: "bad_number",     variant: "negative" },
  ];

  const INTEREST_OUTCOMES: ReadonlyArray<{ value: string; variant: OutcomeOption["variant"] }> = [
    { value: "not_interested", variant: "danger" },
    { value: "do_not_contact", variant: "danger" },
    { value: "maybe_later",    variant: "info"   },
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

  // ── Polling lifecycle ─────────────────────────────────────────────────────
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
        if (typeof j.data?.durationSec === "number") {
          setDurationSec(j.data.durationSec);
        }
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
    setDurationSec(0);
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

  // ── Derived values for child components ──────────────────────────────────
  const ownerName = lead.full_name ?? lead.company_name ?? "—";
  const priorityBucket: "hot" | "normal" | "low" =
    (lead.priority ?? 0) >= 80 ? "hot"
    : (lead.priority ?? 0) < 30 ? "low"
    : "normal";

  const quickOptions: OutcomeOption[] = QUICK_OUTCOMES.map((o) => ({
    value: o.value,
    label: t.outcome[o.value] ?? o.value,
    variant: o.variant,
  }));

  const interestOptions: OutcomeOption[] = INTEREST_OUTCOMES.map((o) => ({
    value: o.value,
    label: t.outcome[o.value] ?? o.value,
    variant: o.variant,
  }));

  const hotOptions: OutcomeOption[] = HOT_OUTCOMES.map((value) => ({
    value,
    label: t.outcome[value] ?? value,
    variant: "escalating",
  }));

  const callbackOptions: OutcomeOption[] = [
    { value: "call_back_later", label: t.outcome.call_back_later ?? "call_back_later", variant: "info" },
  ];

  // Submission-form values bundled for HotSellerSubmissionPanel
  const submissionValues: SubmissionValues = {
    interest, timeline, motivation, askingPrice, callerSummary,
  };
  function updateSubmission<K extends keyof SubmissionValues>(key: K, value: SubmissionValues[K]) {
    if (key === "interest")        setInterest(value as SubmissionValues["interest"]);
    else if (key === "timeline")   setTimeline(value as SubmissionValues["timeline"]);
    else if (key === "motivation") setMotivation(value as string);
    else if (key === "askingPrice") setAskingPrice(value as string);
    else if (key === "callerSummary") setCallerSummary(value as string);
  }

  // Outcome button click router — special-cases call_back_later, escalating
  // outcomes auto-route via logOutcome's existing logic.
  function handleOutcomeClick(value: string) {
    if (value === "call_back_later") {
      handleCallBackLater();
      return;
    }
    logOutcome(value);
  }

  return (
    <div className="cw-shell">
      {/* Lock banner — Phase 4 plumbing only; lockedBy is null until a future
          phase parses 409 responses for the holder identity. */}
      <LockStatusBanner lockedBy={null} />

      <div className="cw-toolbar">
        <button
          onClick={goNext}
          disabled={busy}
          className="cw-toolbar__skip"
        >
          {t.workspace.skipNextLead}
        </button>
      </div>

      <div className="cw-grid">
        {/* LEFT — sticky on desktop ≥1180px */}
        <div className="cw-grid__left">
          <OwnerCard
            name={ownerName}
            statusKey={lead.status}
            priority={priorityBucket}
            campaign={lead.campaign_name}
            attempts={callCount}
          />
          <PropertyCard
            address={lead.address}
            city={lead.city}
            units={lead.num_units}
            assessedValue={
              typeof lead.evaluation_total === "number"
                ? lead.evaluation_total
                : (lead.evaluation_total != null ? Number(lead.evaluation_total) : null)
            }
            yearBuilt={null}
          />
          <PhoneActionCard
            phones={phones}
            selectedPhoneId={phoneId}
            onSelectPhone={setPhoneId}
            userForwardTo={userForwardTo}
            callState={callState}
            durationSec={durationSec}
            callError={callError}
            onTwilioCall={startCall}
          />
        </div>

        {/* RIGHT — normal scroll on desktop, full-width on mobile */}
        <div className="cw-grid__right">
          {/* Outcome groups */}
          <div className="cw-outcome-group">
            <div className="cw-outcome-group__label">{t.workspace.quickOutcome}</div>
            <OutcomeButtonGroup options={quickOptions} onSelect={handleOutcomeClick} disabled={busy} />
          </div>

          <div className="cw-outcome-group">
            <div className="cw-outcome-group__label">{t.workspace.interestOutcome}</div>
            <OutcomeButtonGroup options={interestOptions} onSelect={handleOutcomeClick} disabled={busy} />
          </div>

          <div className="cw-outcome-group">
            <div className="cw-outcome-group__label">{t.workspace.scheduleCallback}</div>
            <OutcomeButtonGroup options={callbackOptions} onSelect={handleOutcomeClick} disabled={busy} />
          </div>

          <div className="cw-outcome-group">
            <div className="cw-outcome-group__label">{t.workspace.sendToAnthony}</div>
            <OutcomeButtonGroup options={hotOptions} onSelect={handleOutcomeClick} disabled={busy} />
          </div>

          {/* Conditional: callback scheduler when user picked call_back_later */}
          {showCallbackPicker && (
            <>
              <CallbackScheduler value={callbackTime} onChange={setCallbackTime} />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={handleCallBackLater}
                  disabled={busy || !callbackTime}
                  className="cw-call-btn cw-call-btn--primary"
                  style={{ flex: "1 1 200px", height: 48 }}
                >
                  {busy ? t.workspace.savingCallback : t.workspace.confirmCallback}
                </button>
                <button
                  onClick={() => setShowCallbackPicker(false)}
                  className="crm-btn"
                >
                  {t.workspace.cancelCallback}
                </button>
              </div>
            </>
          )}

          {/* Conditional: submission form when user picked an escalating outcome */}
          {submitForm && (
            <HotSellerSubmissionPanel
              outcome={submitForm}
              values={submissionValues}
              onChange={updateSubmission}
              submitting={busy}
              error={error}
              onSubmit={submitToAnthony}
              onSkip={() => router.push("/calls/queue")}
            />
          )}

          <CallNotesPanel value={notes} onChange={setNotes} />

          {error && !submitForm && (
            <p style={{ fontSize: 13, color: "var(--so-danger)", margin: 0 }}>{error}</p>
          )}
        </div>
      </div>

      {/* Mobile bottom call bar — visible only during 'answered' on mobile */}
      <MobileBottomCallBar
        visible={callState === "answered"}
        durationSec={durationSec}
      />
    </div>
  );
}
