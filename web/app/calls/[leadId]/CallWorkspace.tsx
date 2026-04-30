"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Phone = { id: string; e164: string; display: string | null; status: string; source: string; confidence: number };

const QUICK_OUTCOMES = [
  { value: "no_answer", label: "No answer", color: "bg-zinc-200 hover:bg-zinc-300 text-zinc-800" },
  { value: "voicemail_left", label: "Voicemail", color: "bg-zinc-200 hover:bg-zinc-300 text-zinc-800" },
  { value: "wrong_number", label: "Wrong #", color: "bg-amber-100 hover:bg-amber-200 text-amber-900" },
  { value: "bad_number", label: "Bad #", color: "bg-amber-100 hover:bg-amber-200 text-amber-900" },
  { value: "not_interested", label: "Not interested", color: "bg-red-100 hover:bg-red-200 text-red-800" },
  { value: "do_not_contact", label: "Do not contact", color: "bg-red-200 hover:bg-red-300 text-red-900" },
  { value: "maybe_later", label: "Maybe later", color: "bg-blue-100 hover:bg-blue-200 text-blue-800" },
] as const;

const HOT_OUTCOMES = [
  { value: "wants_more_info", label: "Wants info" },
  { value: "open_to_selling", label: "Open to selling" },
  { value: "wants_offer", label: "Wants offer" },
  { value: "hot_seller", label: "🔥 Hot seller" },
  { value: "follow_up_booked", label: "Follow-up booked" },
] as const;

type Outcome = typeof QUICK_OUTCOMES[number]["value"] | typeof HOT_OUTCOMES[number]["value"];

const ESCALATING: ReadonlySet<Outcome> = new Set([
  "wants_more_info", "open_to_selling", "wants_offer", "hot_seller", "follow_up_booked",
]);

export default function CallWorkspace({ leadId, phones }: { leadId: string; phones: Phone[] }) {
  const router = useRouter();
  const [phoneId, setPhoneId] = useState<string | null>(phones[0]?.id ?? null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitForm, setSubmitForm] = useState<null | Outcome>(null);

  // Hot-seller submission form state
  const [interest, setInterest] = useState<"cold" | "warm" | "hot" | "wants_offer">("hot");
  const [timeline, setTimeline] = useState<"immediate" | "3_months" | "6_months" | "no_rush" | "unknown">("3_months");
  const [motivation, setMotivation] = useState("");
  const [askingPrice, setAskingPrice] = useState("");
  const [callerSummary, setCallerSummary] = useState("");

  async function logOutcome(outcome: Outcome) {
    setBusy(true);
    setError(null);

    // Step 1 — log the call
    const r = await fetch("/api/calls/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, phoneId, outcome, notes: notes || null }),
    });
    const j = await r.json();
    if (!j.ok) { setError(j.error); setBusy(false); return; }

    // Step 2 — for escalating outcomes, expand the submission form
    if (ESCALATING.has(outcome)) {
      setSubmitForm(outcome);
      setBusy(false);
      // Pre-fill summary with notes
      if (notes && !callerSummary) setCallerSummary(notes);
      return;
    }

    // Otherwise auto-advance to the next lead in the queue.
    await goNext();
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
    if (callerSummary.trim().length < 5) { setError("Summary too short — give Anthony at least one sentence."); return; }
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

  if (submitForm) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-emerald-900">Send to Anthony</h2>
          <p className="text-sm text-emerald-800">Call logged as <strong>{submitForm}</strong>. Add the details Anthony needs to take it from here.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Interest level">
            <select value={interest} onChange={e => setInterest(e.target.value as typeof interest)} className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm">
              <option value="cold">cold</option>
              <option value="warm">warm</option>
              <option value="hot">hot</option>
              <option value="wants_offer">wants offer</option>
            </select>
          </Field>
          <Field label="Timeline">
            <select value={timeline} onChange={e => setTimeline(e.target.value as typeof timeline)} className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm">
              <option value="immediate">immediate</option>
              <option value="3_months">3 months</option>
              <option value="6_months">6 months</option>
              <option value="no_rush">no rush</option>
              <option value="unknown">unknown</option>
            </select>
          </Field>
        </div>

        <Field label="Motivation (why are they considering selling?)">
          <input value={motivation} onChange={e => setMotivation(e.target.value)} className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. retiring, divorce, mortgage maturity" />
        </Field>

        <Field label="Asking price (if mentioned)">
          <input type="number" value={askingPrice} onChange={e => setAskingPrice(e.target.value)} className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. 1600000" />
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
            className="bg-white border border-zinc-300 rounded-lg px-4 py-2 text-sm">Skip submission</button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={goNext} disabled={busy} className="text-xs text-zinc-500 hover:text-zinc-900 underline">
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

      <Field label="Notes (optional)">
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          className="w-full border border-zinc-300 rounded-lg px-3 py-2 text-sm"
          placeholder="What did they say?" />
      </Field>

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
