"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TwilioCallStatePanel, { type CallState } from "@/app/calls/[leadId]/components/TwilioCallStatePanel";
import CallHistoryPanel from "@/app/calls/[leadId]/CallHistoryPanel";
import type { HistoryRow } from "@/app/calls/[leadId]/components/CallHistoryEntry";
import { normalizePhone } from "@/lib/twilio";

// ── Types ────────────────────────────────────────────────────────────────
export type RecentCall = {
  id: string;
  direction: "inbound" | "outbound";
  number: string;
  name: string | null;
  leadId: string | null;
  contactId: string | null;
  investorId: string | null;
  address: string | null;
  durationSec: number | null;
  recordedAt: string | null;
  missed: boolean;
};

type Tab = "keypad" | "recents";
type Intent = "cold" | "warm" | "hot";

type ConvertForm = {
  first_name: string;
  last_name: string;
  street: string;
  city: string;
  postal_code: string;
  notes: string;
  intent: Intent;
};

// ── Helpers ──────────────────────────────────────────────────────────────
function formatPhoneDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length >= 7) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }
  if (digits.length >= 4) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }
  return digits;
}

function formatDuration(sec: number | null): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatRelativeDate(value: string | null): string {
  if (!value) return "";
  const now = new Date();
  const then = new Date(value);
  const sameDay = now.toDateString() === then.toDateString();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const wasYesterday = yesterday.toDateString() === then.toDateString();
  if (sameDay) {
    return new Intl.DateTimeFormat("fr-CA", { hour: "2-digit", minute: "2-digit" }).format(then);
  }
  if (wasYesterday) return "Hier";
  return new Intl.DateTimeFormat("fr-CA", { month: "short", day: "numeric" }).format(then);
}

// ── Keypad button definitions (1-9, *, 0, #) ────────────────────────────
const KEYS: Array<{ digit: string; letters: string }> = [
  { digit: "1", letters: "" },
  { digit: "2", letters: "ABC" },
  { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" },
  { digit: "5", letters: "JKL" },
  { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" },
  { digit: "8", letters: "TUV" },
  { digit: "9", letters: "WXYZ" },
  { digit: "*", letters: "" },
  { digit: "0", letters: "+" },
  { digit: "#", letters: "" },
];

// ── Main component ──────────────────────────────────────────────────────
export default function PhoneClient({
  initialTab,
  recents,
}: {
  initialTab: Tab;
  recents: RecentCall[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [recentsFilter, setRecentsFilter] = useState<"all" | "missed">("all");

  // ── Keypad / call state (preserved from old QuickCallClient) ──────────
  const [phoneRaw, setPhoneRaw] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const [callError, setCallError] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const activeCallLogId = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [callHistory, setCallHistory] = useState<HistoryRow[]>([]);
  const historyLoadedRef = useRef(false);

  const [showForm, setShowForm] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [form, setForm] = useState<ConvertForm>({
    first_name: "", last_name: "", street: "", city: "", postal_code: "", notes: "", intent: "cold",
  });

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const loadCallHistory = useCallback(async (callLogId: string) => {
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    try {
      const r = await fetch(`/api/quick-call/history?callLogId=${callLogId}`);
      const j = await r.json();
      if (j.ok && j.data) setCallHistory(j.data);
    } catch { /* non-fatal */ }
  }, []);

  const startPolling = useCallback((callLogId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/calls/status?callLogId=${callLogId}`);
        const j = await r.json();
        if (!j.ok) return;
        const events = (j.data?.statusEvents ?? []) as { status: string }[];
        const last = events[events.length - 1]?.status ?? "";
        if (last === "in-progress") setCallState("answered");
        if (typeof j.data?.durationSec === "number") setDurationSec(j.data.durationSec);
        if (last === "completed" || (j.data?.durationSec != null && last === "")) {
          setCallState("completed");
          stopPolling();
          setShowForm(true);
          void loadCallHistory(callLogId);
        }
      } catch { /* non-fatal */ }
    }, 3000);
  }, [stopPolling, loadCallHistory]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  async function handleStartCall() {
    setPhoneError(null);
    const normalized = normalizePhone(phoneRaw);
    if (!normalized) {
      setPhoneError("Numéro invalide.");
      return;
    }

    setCallState("initiating");
    setCallError(null);
    setDurationSec(0);
    setShowForm(false);
    setCallHistory([]);
    historyLoadedRef.current = false;

    try {
      const r = await fetch("/api/quick-call/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_e164: normalized }),
      });
      const j = await r.json();
      if (!j.ok) {
        setCallState("failed");
        setCallError(j.error ?? "Échec du lancement de l'appel.");
        return;
      }
      activeCallLogId.current = j.data.callLogId;
      setCallState("ringing");
      startPolling(j.data.callLogId);
    } catch {
      setCallState("failed");
      setCallError("Erreur réseau. Réessaie.");
    }
  }

  async function handleConvert() {
    const cid = activeCallLogId.current;
    if (!cid) return;
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setConvertError("Le prénom et le nom sont requis.");
      return;
    }
    setConverting(true);
    setConvertError(null);
    try {
      const r = await fetch(`/api/quick-call/convert/${cid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          street: form.street.trim() || undefined,
          city: form.city.trim() || undefined,
          postal_code: form.postal_code.trim() || undefined,
          notes: form.notes.trim() || undefined,
          intent: form.intent,
        }),
      });
      const j = await r.json();
      if (!j.ok) {
        setConvertError(j.error ?? "Conversion échouée.");
        setConverting(false);
        return;
      }
      router.push(`/leads/${j.data.leadId}`);
    } catch {
      setConvertError("Erreur réseau. Réessaie.");
      setConverting(false);
    }
  }

  function press(digit: string) {
    if (callState !== "idle" && callState !== "failed" && callState !== "completed") return;
    setPhoneError(null);
    setPhoneRaw((prev) => prev + digit);
  }

  function backspace() {
    setPhoneError(null);
    setPhoneRaw((prev) => prev.slice(0, -1));
  }

  const callActive = callState === "initiating" || callState === "ringing" || callState === "answered";
  const phoneDisplay = phoneRaw ? formatPhoneDisplay(phoneRaw) : "";
  const filteredRecents = recentsFilter === "missed"
    ? recents.filter((r) => r.missed)
    : recents;

  function recallFrom(call: RecentCall) {
    if (!call.number) return;
    setPhoneRaw(call.number);
    setTab("keypad");
  }

  return (
    <main className="ph-page">
      <header className="ph-head">
        <h1 className="ph-head__title">{tab === "keypad" ? "Clavier" : "Récents"}</h1>
        {tab === "recents" && (
          <div className="ph-seg" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={recentsFilter === "all"}
              className={recentsFilter === "all" ? "is-active" : ""}
              onClick={() => setRecentsFilter("all")}
            >Tous</button>
            <button
              type="button"
              role="tab"
              aria-selected={recentsFilter === "missed"}
              className={recentsFilter === "missed" ? "is-active" : ""}
              onClick={() => setRecentsFilter("missed")}
            >Manqués</button>
          </div>
        )}
      </header>

      <div className="ph-body">
        {tab === "keypad" ? (
          <KeypadPane
            phoneDisplay={phoneDisplay}
            phoneRaw={phoneRaw}
            phoneError={phoneError}
            callState={callState}
            callError={callError}
            durationSec={durationSec}
            callActive={callActive}
            press={press}
            backspace={backspace}
            handleStartCall={handleStartCall}
            callHistory={callHistory}
            showForm={showForm}
            setShowForm={setShowForm}
            form={form}
            setForm={setForm}
            convertError={convertError}
            converting={converting}
            handleConvert={handleConvert}
          />
        ) : (
          <RecentsPane recents={filteredRecents} onRecall={recallFrom} />
        )}
      </div>

      <nav className="ph-tabs" aria-label="Onglets téléphone">
        <button
          type="button"
          className={`ph-tab${tab === "recents" ? " ph-tab--active" : ""}`}
          onClick={() => setTab("recents")}
        >
          <ClockIcon />
          <span>Récents</span>
        </button>
        <button
          type="button"
          className={`ph-tab${tab === "keypad" ? " ph-tab--active" : ""}`}
          onClick={() => setTab("keypad")}
        >
          <KeypadIcon />
          <span>Clavier</span>
        </button>
      </nav>
    </main>
  );
}

// ── Keypad pane ─────────────────────────────────────────────────────────
function KeypadPane(props: {
  phoneDisplay: string;
  phoneRaw: string;
  phoneError: string | null;
  callState: CallState;
  callError: string | null;
  durationSec: number;
  callActive: boolean;
  press: (d: string) => void;
  backspace: () => void;
  handleStartCall: () => void;
  callHistory: HistoryRow[];
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  form: ConvertForm;
  setForm: React.Dispatch<React.SetStateAction<ConvertForm>>;
  convertError: string | null;
  converting: boolean;
  handleConvert: () => void;
}) {
  const {
    phoneDisplay, phoneRaw, phoneError, callState, callError, durationSec,
    callActive, press, backspace, handleStartCall, callHistory,
    showForm, setShowForm, form, setForm, convertError, converting, handleConvert,
  } = props;

  return (
    <div className="ph-keypad">
      <div className="ph-display">
        <div className="ph-display__number" aria-live="polite">
          {phoneDisplay || <span className="ph-display__hint">Entre un numéro</span>}
        </div>
        {phoneError && <div className="ph-display__error">{phoneError}</div>}
      </div>

      <div className="ph-keys" role="group" aria-label="Clavier numérique">
        {KEYS.map((k) => (
          <button
            key={k.digit}
            type="button"
            className="ph-key"
            onClick={() => press(k.digit)}
            disabled={callActive}
            aria-label={`${k.digit}${k.letters ? ` ${k.letters}` : ""}`}
          >
            <span className="ph-key__d">{k.digit}</span>
            {k.letters && <span className="ph-key__l">{k.letters}</span>}
          </button>
        ))}
      </div>

      <div className="ph-action-row">
        <div className="ph-action-spacer" />
        {(callState === "idle" || callState === "failed" || callState === "completed") ? (
          <button
            type="button"
            className="ph-call-btn"
            onClick={() => void handleStartCall()}
            disabled={!phoneRaw.trim()}
            aria-label="Appeler"
          >
            <PhoneCallIcon />
          </button>
        ) : (
          <button
            type="button"
            className="ph-call-btn ph-call-btn--busy"
            disabled
            aria-label="Appel en cours"
          >
            <PhoneCallIcon />
          </button>
        )}
        <button
          type="button"
          className="ph-backspace"
          onClick={backspace}
          disabled={!phoneRaw || callActive}
          aria-label="Effacer le dernier chiffre"
        >
          <BackspaceIcon />
        </button>
      </div>

      {callState !== "idle" && (
        <div className="ph-status">
          {callState === "initiating" && "Connexion…"}
          {callState === "ringing" && "Sonnerie…"}
          {callState === "answered" && `En cours · ${formatDuration(durationSec)}`}
          {callState === "completed" && `Appel terminé · ${formatDuration(durationSec)}`}
          {callState === "failed" && "Échec de l'appel"}
        </div>
      )}

      {(callState === "initiating" || callState === "ringing" || callState === "answered" || callState === "completed") && (
        <TwilioCallStatePanel callState={callState} durationSec={durationSec} />
      )}

      {callError && <div className="ph-error">{callError}</div>}

      {callHistory.length > 0 && (
        <div className="ph-card">
          <div className="ph-card__title">Enregistrement &amp; transcription</div>
          <CallHistoryPanel history={callHistory} />
        </div>
      )}

      {showForm && (
        <ConvertForm
          form={form}
          setForm={setForm}
          convertError={convertError}
          converting={converting}
          onSubmit={handleConvert}
        />
      )}

      {!showForm && callState !== "idle" && callState !== "failed" && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm(true)}>
          Remplir le formulaire maintenant
        </button>
      )}
    </div>
  );
}

// ── Convert form ────────────────────────────────────────────────────────
function ConvertForm({
  form, setForm, convertError, converting, onSubmit,
}: {
  form: ConvertForm;
  setForm: React.Dispatch<React.SetStateAction<ConvertForm>>;
  convertError: string | null;
  converting: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="ph-convert">
      <div className="ph-convert__title">Convertir en lead</div>

      <div className="ph-convert__grid">
        <ConvField label="Prénom *" value={form.first_name} onChange={(v) => setForm((f) => ({ ...f, first_name: v }))} placeholder="Jean" />
        <ConvField label="Nom *" value={form.last_name} onChange={(v) => setForm((f) => ({ ...f, last_name: v }))} placeholder="Tremblay" />
      </div>
      <ConvField label="Adresse" value={form.street} onChange={(v) => setForm((f) => ({ ...f, street: v }))} placeholder="123 rue des Érables" />
      <div className="ph-convert__grid ph-convert__grid--2-1">
        <ConvField label="Ville" value={form.city} onChange={(v) => setForm((f) => ({ ...f, city: v }))} placeholder="Montréal" />
        <ConvField label="Code postal" value={form.postal_code} onChange={(v) => setForm((f) => ({ ...f, postal_code: v }))} placeholder="H1A 1A1" />
      </div>

      <div className="ph-convert__field">
        <label>Intention</label>
        <select value={form.intent} onChange={(e) => setForm((f) => ({ ...f, intent: e.target.value as Intent }))}>
          <option value="cold">Froid</option>
          <option value="warm">Tiède</option>
          <option value="hot">Chaud</option>
        </select>
      </div>

      <div className="ph-convert__field">
        <label>Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          rows={3}
          placeholder="Ce que vous avez appris durant l'appel…"
        />
      </div>

      {convertError && <div className="ph-error">{convertError}</div>}

      <button
        type="button"
        className="btn btn--gold"
        onClick={onSubmit}
        disabled={converting || !form.first_name.trim() || !form.last_name.trim()}
      >
        {converting ? "Conversion en cours…" : "Convertir en lead"}
      </button>
    </div>
  );
}

function ConvField({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="ph-convert__field">
      <label>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

// ── Recents pane ────────────────────────────────────────────────────────
function RecentsPane({
  recents,
  onRecall,
}: {
  recents: RecentCall[];
  onRecall: (c: RecentCall) => void;
}) {
  if (recents.length === 0) {
    return <div className="ph-empty">Aucun appel récent.</div>;
  }
  return (
    <ul className="ph-recents">
      {recents.map((call) => {
        const linked = Boolean(call.leadId || call.contactId || call.investorId);
        const Body = (
          <>
            <span className="ph-recent__dir" aria-hidden="true">
              {call.direction === "inbound" ? <ArrowInIcon /> : <ArrowOutIcon />}
            </span>
            <span className="ph-recent__body">
              <span className="ph-recent__name">
                {call.name ?? (formatPhoneDisplay(call.number) || call.number)}
              </span>
              <span className="ph-recent__sub">
                {call.address ?? (call.name ? formatPhoneDisplay(call.number) : "Numéro inconnu")}
                {call.durationSec ? ` · ${formatDuration(call.durationSec)}` : ""}
              </span>
            </span>
            <span className="ph-recent__time">{formatRelativeDate(call.recordedAt)}</span>
          </>
        );
        return (
          <li key={call.id} className="ph-recent">
            {linked ? (
              <Link
                href={detailHref(call) as never}
                className={`ph-recent__main${call.missed ? " ph-recent__main--missed" : ""}`}
                aria-label={`Ouvrir ${call.name ?? call.number}`}
              >
                {Body}
              </Link>
            ) : (
              <button
                type="button"
                className={`ph-recent__main${call.missed ? " ph-recent__main--missed" : ""}`}
                onClick={() => onRecall(call)}
                aria-label={`Rappeler ${call.number}`}
              >
                {Body}
              </button>
            )}
            <button
              type="button"
              className="ph-recent__info"
              onClick={() => onRecall(call)}
              aria-label="Composer ce numéro"
              title="Composer ce numéro"
            >
              <PhoneSmallIcon />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function detailHref(call: RecentCall): string {
  if (call.leadId) return `/leads/${call.leadId}`;
  if (call.contactId) return `/contacts/${call.contactId}`;
  if (call.investorId) return `/investisseurs/${call.investorId}`;
  return "#";
}

// ── Icons ───────────────────────────────────────────────────────────────
function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function KeypadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {[5, 12, 19].flatMap((y) => [5, 12, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" />))}
    </svg>
  );
}
function PhoneCallIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" />
    </svg>
  );
}
function BackspaceIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 4H8L2 12l6 8h14a2 2 0 002-2V6a2 2 0 00-2-2z" />
      <path d="M18 9l-6 6M12 9l6 6" />
    </svg>
  );
}
function ArrowInIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 5L5 19M5 8v11h11" />
    </svg>
  );
}
function ArrowOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 19L19 5M8 5h11v11" />
    </svg>
  );
}
function PhoneSmallIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" />
    </svg>
  );
}
