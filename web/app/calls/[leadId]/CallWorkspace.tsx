"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// ── Twilio call state ────────────────────────────────────────────────────────
type TwilioCallState = "idle" | "initiating" | "ringing" | "answered" | "completed" | "failed";
const CALL_STATE_LABELS: Record<TwilioCallState, string> = {
  idle:       "",
  initiating: "Connexion…",
  ringing:    "Ton téléphone sonne…",
  answered:   "En ligne",
  completed:  "Appel terminé",
  failed:     "Erreur",
};

type Phone = { id: string; e164: string; display: string | null; status: string; source: string; confidence: number };

const QUICK_OUTCOMES = [
  { value: "no_answer",     label: "No answer",       color: "bg-zinc-200 hover:bg-zinc-300 text-zinc-800" },
  { value: "voicemail_left",label: "Voicemail",        color: "bg-zinc-200 hover:bg-zinc-300 text-zinc-800" },
  { value: "wrong_number",  label: "Wrong #",          color: "bg-amber-100 hover:bg-amber-200 text-amber-900" },
  { value: "bad_number",    label: "Bad #",            color: "bg-amber-100 hover:bg-amber-200 text-amber-900" },
  { value: "not_interested",label: "Not interested",   color: "bg-red-100 hover:bg-red-200 text-red-800" },
  { value: "do_not_contact",label: "Do not contact",   color: "bg-red-200 hover:bg-red-300 text-red-900" },
  { value: "maybe_later",   label: "Maybe later",      color: "bg-blue-100 hover:bg-blue-200 text-blue-800" },
] as const;

const HOT_OUTCOMES = [
  { value: "wants_more_info",  label: "Wants info" },
  { value: "open_to_selling",  label: "Open to selling" },
  { value: "wants_offer",      label: "Wants offer" },
  { value: "hot_seller",       label: "🔥 Hot seller" },
  { value: "follow_up_booked", label: "Follow-up booked" },
] as const;

type QuickOutcome = typeof QUICK_OUTCOMES[number]["value"];
type HotOutcome   = typeof HOT_OUTCOMES[number]["value"];
type Outcome      = QuickOutcome | HotOutcome | "call_back_later";

const ESCALATING: ReadonlySet<Outcome> = new Set<Outcome>([
  "wants_more_info", "open_to_selling", "wants_offer", "hot_seller", "follow_up_booked",
]);

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
  const [phoneId, setPhoneId] = useState<string | null>(phones[0]?.id ?? null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitForm, setSubmitForm] = useState<null | Outcome>(null);

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
    if (!phoneId) { setCallError("Sélectionne un numéro de téléphone."); return; }
    if (!userForwardTo) {
      setCallError("Ton numéro de renvoi n'est pas configuré — demande à Anthony de l'ajouter dans ton profil.");
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
      if (!j.ok) { setCallState("failed"); setCallError(j.error ?? "Impossible de lancer l'appel."); return; }
      activeCallLogId.current = j.data.callLogId;
      setCallState("ringing");
      startPolling(j.data.callLogId);
    } catch {
      setCallState("failed");
      setCallError("Erreur réseau — réessaie.");
    }
  }

  // ── Call lock lifecycle ──────────────────────────────────────────────────
  // Acquire lock on mount so /api/calls/next skips this lead for other callers.
  // Released by the log route server-side, or here on unmount as a safety-net.
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
        // Fire-and-forget; keep=true so the request survives navigation
        navigator.sendBeacon(`/api/calls/lock?leadId=${leadId}`, new Blob([], { type: "text/plain" }));
        // Fallback fetch for DELETE (sendBeacon only POSTs)
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
      setError("Summary too short — give Anthony at least one sentence.");
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
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-emerald-900">Send to Anthony</h2>
          <p className="text-sm text-emerald-800">
            Call logged as <strong>{submitForm}</strong>. Add the details Anthony needs to take it from here.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Interest level">
            <select value={interest} onChange={e => setInterest(e.target.value as typeof interest)}
              className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm">
              <option value="cold">cold</option>
              <option value="warm">warm</option>
              <option value="hot">hot</option>
              <option value="wants_offer">wants offer</option>
            </select>
          </Field>
          <Field label="Timeline">
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

        <Field label="Motivation (why are they considering selling?)">
          <input value={motivation} onChange={e => setMotivation(e.target.value)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            placeholder="e.g. retiring, divorce, mortgage maturity" />
        </Field>

        <Field label="Asking price (if mentioned)">
          <input type="number" value={askingPrice} onChange={e => setAskingPrice(e.target.value)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            placeholder="e.g. 1600000" />
        </Field>

        <Field label="Summary for Anthony (required)">
          <textarea value={callerSummary} onChange={e => setCallerSummary(e.target.value)} rows={4}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
            placeholder="What happened? What does Anthony need to know to call this owner back?" />
        </Field>

        <div className="flex gap-2">
          <button onClick={submitToAnthony} disabled={busy}
            className="bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium">
            {busy ? "Sending…" : "Submit to Anthony"}
          </button>
          <button onClick={() => router.push("/calls/queue")}
            className="bg-white border border-zinc-300 rounded-lg px-4 py-2 text-sm">
            Skip submission
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
          Skip · next lead →
        </button>
      </div>

      {phones.length > 0 ? (
        <Field label="Phone dialed">
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
          No phone numbers on file for this contact.
        </div>
      )}

      {/* ── Twilio call launcher ─────────────────────────────────────── */}
      {phones.length > 0 && (
        <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 flex items-center gap-3">
          {(callState === "idle" || callState === "failed" || callState === "completed") ? (
            <button
              onClick={startCall}
              disabled={!phoneId}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-lg px-4 py-2 text-sm font-semibold"
            >
              📞 Appeler
            </button>
          ) : (
            <button disabled className="flex items-center gap-2 bg-zinc-200 text-zinc-600 rounded-lg px-4 py-2 text-sm font-semibold cursor-not-allowed">
              {callState === "initiating" && <span className="animate-pulse">⏳</span>}
              {callState === "ringing"    && <span>📱</span>}
              {callState === "answered"   && <span className="text-red-500">🔴</span>}
              {CALL_STATE_LABELS[callState]}
            </button>
          )}
          <span className="text-xs text-zinc-500 flex-1">
            {callState === "idle" && (userForwardTo
              ? <>Sonnera sur <span className="font-mono">{userForwardTo}</span></>
              : <span className="text-amber-600">Numéro de renvoi non configuré</span>
            )}
            {callState === "ringing"   && "Décroche ton téléphone…"}
            {callState === "answered"  && "Connecté · parle avec le propriétaire"}
            {callState === "completed" && "✓ Appel terminé — sélectionne un résultat ci-dessous"}
          </span>
        </div>
      )}
      {callError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{callError}</p>
      )}

      <Field label="Notes (optional)">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
          placeholder="What did they say?" />
      </Field>

      {/* Quick outcomes */}
      <div>
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Quick outcome</div>
        <div className="flex flex-wrap gap-2">
          {QUICK_OUTCOMES.map(o => (
            <button key={o.value} disabled={busy} onClick={() => logOutcome(o.value)}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${o.color} disabled:opacity-50`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scheduled callback */}
      <div>
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Schedule callback</div>
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
              {busy ? "Saving…" : "Confirm callback"}
            </button>
            <button
              onClick={() => setShowCallbackPicker(false)}
              className="text-xs text-zinc-400 hover:text-zinc-700 underline"
            >
              cancel
            </button>
          </div>
        ) : (
          <button
            disabled={busy}
            onClick={handleCallBackLater}
            className="rounded-lg px-3 py-2 text-sm font-medium bg-indigo-100 hover:bg-indigo-200 text-indigo-900 disabled:opacity-50"
          >
            📅 Call back later
          </button>
        )}
      </div>

      {/* Hot / escalating outcomes → send to Anthony */}
      <div>
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Send to Anthony</div>
        <div className="flex flex-wrap gap-2">
          {HOT_OUTCOMES.map(o => (
            <button key={o.value} disabled={busy} onClick={() => logOutcome(o.value)}
              className="rounded-lg px-3 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
              {o.label}
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
