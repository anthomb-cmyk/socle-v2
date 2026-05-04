"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/components/locale-provider";

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

  // Outcome labels come from the dictionary so they flip with locale
  const QUICK_OUTCOMES = [
    { value: "no_answer",      color: "bg-zinc-200 hover:bg-zinc-300 text-zinc-800" },
    { value: "voicemail_left", color: "bg-zinc-200 hover:bg-zinc-300 text-zinc-800" },
    { value: "wrong_number",   color: "bg-amber-100 hover:bg-amber-200 text-amber-900" },
    { value: "bad_number",     color: "bg-amber-100 hover:bg-amber-200 text-amber-900" },
    { value: "not_interested", color: "bg-red-100 hover:bg-red-200 text-red-800" },
    { value: "do_not_contact", color: "bg-red-200 hover:bg-red-300 text-red-900" },
    { value: "maybe_later",    color: "bg-blue-100 hover:bg-blue-200 text-blue-800" },
  ] as const;

  const HOT_OUTCOMES = [
    "wants_more_info",
    "open_to_selling",
    "wants_offer",
    "hot_seller",
    "follow_up_booked",
  ] as const;

  type QuickOutcome = typeof QUICK_OUTCOMES[number]["value"];
  type HotOutcome   = typeof HOT_OUTCOMES[number];
  type Outcome      = QuickOutcome | HotOutcome | "call_back_later";

  const ESCALATING = new Set<string>([
    "wants_more_info", "open_to_selling", "wants_offer", "hot_seller", "follow_up_booked",
  ]);

  // Twilio call state → translated label
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

  // ── Submission form (escalating outcomes) ────────────────────────────────
  if (submitForm) {
    const outcomeLabel = t.outcome[submitForm] ?? submitForm;
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-emerald-900">{t.workspace.submitTitle}</h2>
          <p className="text-sm text-emerald-800">
            {t.workspace.submitSubtitle(outcomeLabel)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t.workspace.interestLevel}>
            <select value={interest} onChange={e => setInterest(e.target.value as typeof interest)}
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm">
              <option value="cold">cold</option>
              <option value="warm">warm</option>
              <option value="hot">hot</option>
              <option value="wants_offer">wants offer</option>
            </select>
          </Field>
          <Field label={t.workspace.timeline}>
            <select value={timeline} onChange={e => setTimeline(e.target.value as typeof timeline)}
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm">
              <option value="immediate">immediate</option>
              <option value="3_months">3 months</option>
              <option value="6_months">6 months</option>
              <option value="no_rush">no rush</option>
              <option value="unknown">unknown</option>
            </select>
          </Field>
        </div>

        <Field label={t.workspace.motivation}>
          <input value={motivation} onChange={e => setMotivation(e.target.value)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            placeholder={t.workspace.motivationPlaceholder} />
        </Field>

        <Field label={t.workspace.askingPrice}>
          <input type="number" value={askingPrice} onChange={e => setAskingPrice(e.target.value)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            placeholder="e.g. 1600000" />
        </Field>

        <Field label={t.workspace.summary}>
          <textarea value={callerSummary} onChange={e => setCallerSummary(e.target.value)} rows={4}
            className="crm-notes-textarea w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            placeholder={t.workspace.summaryPlaceholder} />
        </Field>

        <div className="flex gap-2">
          <button onClick={submitToAnthony} disabled={busy}
            className="bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">
            {busy ? t.workspace.submitting : t.workspace.submitBtn}
          </button>
          <button onClick={() => router.push("/calls/queue")}
            className="bg-white border border-zinc-300 rounded-lg px-4 py-2 text-sm">
            {t.workspace.skipSubmission}
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  // ── Main workspace ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={goNext} disabled={busy}
          className="text-xs text-zinc-500 hover:text-zinc-900 underline">
          {t.workspace.skipNextLead}
        </button>
      </div>

      {phones.length > 0 ? (
        <Field label={t.workspace.phoneDialed}>
          <select value={phoneId ?? ""} onChange={e => setPhoneId(e.target.value || null)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm font-mono">
            {phones.map(p => (
              <option key={p.id} value={p.id}>
                {p.display ?? p.e164}{p.status !== "unverified" ? ` (${p.status})` : ""} · {p.source} · conf {p.confidence}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
          {t.workspace.noPhones}
        </div>
      )}

      {/* ── Twilio call launcher ─────────────────────────────────────── */}
      {phones.length > 0 && (
        <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Tel: tap-to-call — direct dial fallback, prominently shown on mobile */}
          {phoneId && (() => {
            const sel = phones.find(p => p.id === phoneId);
            return sel ? (
              <a href={`tel:${sel.e164}`} className="crm-tel-link"
                style={{ fontSize: 20, fontWeight: 700, color: "var(--crm-blue)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}>
                📞 {sel.display ?? sel.e164}
              </a>
            ) : null;
          })()}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {(callState === "idle" || callState === "failed" || callState === "completed") ? (
              <button
                onClick={startCall}
                disabled={!phoneId}
                className="crm-call-btn-mobile flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-lg px-4 py-2 text-sm font-semibold"
              >
                {t.workspace.call}
              </button>
            ) : (
              <button disabled className="crm-call-btn-mobile flex items-center gap-2 bg-zinc-200 text-zinc-600 rounded-lg px-4 py-2 text-sm font-semibold cursor-not-allowed">
                {callState === "initiating" && <span className="animate-pulse">⏳</span>}
                {callState === "ringing"    && <span>📱</span>}
                {callState === "answered"   && <span className="text-red-500">🔴</span>}
                {CALL_STATE_LABELS[callState]}
              </button>
            )}
            <span className="text-xs text-zinc-500 flex-1">
              {callState === "idle" && (userForwardTo
                ? <>{t.workspace.willRingOn} <span className="font-mono">{userForwardTo}</span></>
                : <span className="text-amber-600">{t.workspace.forwardNotConfigured}</span>
              )}
              {callState === "ringing"   && t.workspace.pickup}
              {callState === "answered"  && t.workspace.connected}
              {callState === "completed" && t.workspace.selectOutcome}
            </span>
          </div>
        </div>
      )}
      {callError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{callError}</p>
      )}

      <Field label={t.workspace.notesLabel}>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          className="crm-notes-textarea w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
          placeholder={t.workspace.notesPlaceholder} />
      </Field>

      {/* Quick outcomes */}
      <div>
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
          {t.workspace.quickOutcome}
        </div>
        <div className="crm-outcome-grid flex flex-wrap gap-2">
          {QUICK_OUTCOMES.map(o => (
            <button key={o.value} disabled={busy} onClick={() => logOutcome(o.value)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${o.color} disabled:opacity-50`}>
              {t.outcome[o.value] ?? o.value}
            </button>
          ))}
        </div>
      </div>

      {/* Scheduled callback */}
      <div>
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
          {t.workspace.scheduleCallback}
        </div>
        {showCallbackPicker ? (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="datetime-local"
              value={callbackTime}
              onChange={e => setCallbackTime(e.target.value)}
              className="border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={handleCallBackLater}
              disabled={busy || !callbackTime}
              className="rounded-lg px-3 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
            >
              {busy ? t.workspace.savingCallback : t.workspace.confirmCallback}
            </button>
            <button
              onClick={() => setShowCallbackPicker(false)}
              className="text-xs text-zinc-400 hover:text-zinc-700 underline"
            >
              {t.workspace.cancelCallback}
            </button>
          </div>
        ) : (
          <button
            disabled={busy}
            onClick={handleCallBackLater}
            className="rounded-lg px-3 py-2 text-sm font-medium bg-indigo-100 hover:bg-indigo-200 text-indigo-900 disabled:opacity-50"
          >
            {t.workspace.callBackLater}
          </button>
        )}
      </div>

      {/* Hot / escalating outcomes → send to Anthony */}
      <div>
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
          {t.workspace.sendToAnthony}
        </div>
        <div className="crm-outcome-grid flex flex-wrap gap-2">
          {HOT_OUTCOMES.map(value => (
            <button key={value} disabled={busy} onClick={() => logOutcome(value)}
              className="rounded-lg px-3 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
              {t.outcome[value] ?? value}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
