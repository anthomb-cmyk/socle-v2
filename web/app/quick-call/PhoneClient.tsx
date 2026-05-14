"use client";

import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from "react";
import Link from "next/link";
import TwilioCallStatePanel, { type CallState } from "@/app/calls/[leadId]/components/TwilioCallStatePanel";
import CallHistoryPanel from "@/app/calls/[leadId]/CallHistoryPanel";
import type { HistoryRow } from "@/app/calls/[leadId]/components/CallHistoryEntry";
import { normalizePhone } from "@/lib/twilio";
import { useLocale } from "@/components/locale-provider";
import { useToast } from "@/components/toast-provider";

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
  notes: string | null;
  transcript: string | null;
  transcriptStatus: string | null;
  summary: string | null;
  outcome: string | null;
  missed: boolean;
};

type View = "recents" | "dialer";
type RecentsFilter = "all" | "missed" | "inbound" | "outbound";
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

type Recipient = {
  id: string;
  label: string;
  sublabel: string | null;
  number: string;
  contactId: string | null;
  leadId: string | null;
  dealId: string | null;
  dealTitle: string | null;
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
  return `${m} m ${String(s).padStart(2, "0")} s`;
}

function formatTime(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("fr-CA", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

const DAY_FULL = new Intl.DateTimeFormat("fr-CA", { weekday: "long", day: "numeric", month: "long" });
const DAY_KEY = new Intl.DateTimeFormat("fr-CA", { year: "numeric", month: "2-digit", day: "2-digit" });

function dayLabel(date: Date, today: Date, yesterday: Date): string {
  const k = DAY_KEY.format(date);
  if (k === DAY_KEY.format(today)) return `Aujourd'hui · ${DAY_FULL.format(date)}`;
  if (k === DAY_KEY.format(yesterday)) return `Hier · ${DAY_FULL.format(date)}`;
  const cap = DAY_FULL.format(date);
  return cap.charAt(0).toUpperCase() + cap.slice(1);
}

function initialsFor(name: string | null): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "";
}

function firstNameOf(name: string | null): string | null {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0];
  return first || null;
}

function inferNameFromTranscript(text: string | null): string | null {
  if (!text) return null;
  const compact = text.replace(/\s+/g, " ").trim();
  const patterns = [
    /\b(?:mon nom est|moi c'est|je suis|c'est)\s+([A-ZÀ-ÖØ-Þ][\p{L}'-]+(?:\s+[A-ZÀ-ÖØ-Þ][\p{L}'-]+){0,2})/iu,
    /\b(?:my name is|this is|i am|i'm)\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+){0,2})/i,
  ];
  for (const pattern of patterns) {
    const match = compact.match(pattern);
    const name = match?.[1]?.trim();
    if (name && name.length <= 60) return name;
  }
  return null;
}

function hasCallText(call: RecentCall): boolean {
  return Boolean(call.notes?.trim() || call.summary?.trim() || call.transcript?.trim() || call.outcome);
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
  initialTab: "keypad" | "recents";
  recents: RecentCall[];
}) {
  const { t } = useLocale();
  const { showToast } = useToast();
  const [view, setView] = useState<View>(initialTab === "recents" ? "recents" : "dialer");
  const [recentsFilter, setRecentsFilter] = useState<RecentsFilter>("all");
  const [savedLeadId, setSavedLeadId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ first_name?: string; last_name?: string }>({});

  // ── Keypad / call state (preserved) ──────────────────────────────────
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

  // ── Dialer search & contact suggestion ───────────────────────────────
  const [dialerQuery, setDialerQuery] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const recipientsLoadedRef = useRef(false);

  useEffect(() => {
    if (view !== "dialer" || recipientsLoadedRef.current) return;
    recipientsLoadedRef.current = true;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/textos/recipients", { signal: controller.signal, cache: "no-store" });
        const json = await res.json();
        if (json.ok && Array.isArray(json.data)) setRecipients(json.data as Recipient[]);
      } catch { /* non-fatal */ }
    })();
    return () => controller.abort();
  }, [view]);

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
    const errs: { first_name?: string; last_name?: string } = {};
    if (!form.first_name.trim()) errs.first_name = t.validation.firstNameRequired;
    if (!form.last_name.trim())  errs.last_name  = t.validation.lastNameRequired;
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

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
      setConverting(false);
      setSavedLeadId(j.data.leadId);
      setShowForm(false);
      showToast({ message: t.toasts.leadSaved, tone: "success" });
    } catch {
      setConvertError(t.common.networkErr);
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

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      const digits = text.replace(/[^\d+#*]/g, "");
      if (digits) {
        setPhoneError(null);
        setPhoneRaw(digits);
      }
    } catch {
      /* clipboard denied or unavailable — silent */
    }
  }

  // ── Recents counts & filtering ───────────────────────────────────────
  const counts = useMemo(() => ({
    all: recents.length,
    missed: recents.filter((r) => r.missed).length,
    inbound: recents.filter((r) => r.direction === "inbound" && !r.missed).length,
    outbound: recents.filter((r) => r.direction === "outbound").length,
  }), [recents]);

  const filteredRecents = useMemo(() => {
    if (recentsFilter === "missed") return recents.filter((r) => r.missed);
    if (recentsFilter === "inbound") return recents.filter((r) => r.direction === "inbound" && !r.missed);
    if (recentsFilter === "outbound") return recents.filter((r) => r.direction === "outbound");
    return recents;
  }, [recents, recentsFilter]);

  const recentsByDay = useMemo(() => groupByDay(filteredRecents), [filteredRecents]);

  // ── Suggestion: match typed digits against recipients / recents ──────
  const matchedContact = useMemo(() => {
    const digits = phoneRaw.replace(/\D/g, "");
    if (digits.length < 4) return null;
    const tail = digits.slice(-10);
    for (const r of recipients) {
      const rd = r.number.replace(/\D/g, "");
      if (rd.endsWith(tail) || rd.includes(digits)) return r;
    }
    for (const rc of recents) {
      const rd = rc.number.replace(/\D/g, "");
      if (rc.name && (rd.endsWith(tail) || rd.includes(digits))) {
        return {
          id: rc.id,
          label: rc.name,
          sublabel: rc.address,
          number: rc.number,
          contactId: rc.contactId,
          leadId: rc.leadId,
          dealId: null,
          dealTitle: null,
        } satisfies Recipient;
      }
    }
    return null;
  }, [phoneRaw, recipients, recents]);

  // ── Search results in dialer (when query typed) ──────────────────────
  const searchResults = useMemo(() => {
    const q = dialerQuery.trim().toLowerCase();
    if (!q) return [] as Recipient[];
    return recipients
      .filter((r) =>
        r.label.toLowerCase().includes(q)
        || (r.sublabel ?? "").toLowerCase().includes(q)
        || (r.dealTitle ?? "").toLowerCase().includes(q)
        || r.number.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [dialerQuery, recipients]);

  function recallFrom(call: RecentCall) {
    if (!call.number) return;
    const digits = call.number.replace(/\D/g, "");
    setPhoneRaw(digits || call.number);
    setView("dialer");
  }

  function pickRecipient(r: Recipient) {
    const digits = r.number.replace(/\D/g, "");
    setPhoneRaw(digits || r.number);
    setDialerQuery("");
  }

  function dismissPostConvert() {
    setSavedLeadId(null);
    setPhoneRaw("");
    setCallState("idle");
    setDurationSec(0);
    setCallHistory([]);
    historyLoadedRef.current = false;
    activeCallLogId.current = null;
    setForm({
      first_name: "", last_name: "", street: "", city: "", postal_code: "", notes: "", intent: "cold",
    });
    setFieldErrors({});
    setConvertError(null);
  }

  const callActive = callState === "initiating" || callState === "ringing" || callState === "answered";

  return (
    <main className="ph-page">
      <header className="ph-head">
        <h1 className="ph-head__title">Appels</h1>
        <div className="ph-head__sub mono">Numéro Socle</div>
      </header>

      <div className="ph-vt" role="tablist" aria-label="Vue téléphone">
        <button
          type="button"
          role="tab"
          aria-selected={view === "recents"}
          className={`ph-vt__btn${view === "recents" ? " ph-vt__btn--active" : ""}`}
          onClick={() => setView("recents")}
        >
          <ClockIcon />
          <span>Récents</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "dialer"}
          className={`ph-vt__btn${view === "dialer" ? " ph-vt__btn--active" : ""}`}
          onClick={() => setView("dialer")}
        >
          <KeypadIcon />
          <span>Clavier</span>
        </button>
      </div>

      <div className="ph-body">
        {view === "recents" ? (
          <RecentsPane
            groups={recentsByDay}
            counts={counts}
            filter={recentsFilter}
            onFilterChange={setRecentsFilter}
            onRecall={recallFrom}
          />
        ) : (
          <DialerPane
            phoneRaw={phoneRaw}
            phoneError={phoneError}
            callState={callState}
            callError={callError}
            durationSec={durationSec}
            callActive={callActive}
            press={press}
            backspace={backspace}
            pasteFromClipboard={pasteFromClipboard}
            handleStartCall={handleStartCall}
            callHistory={callHistory}
            showForm={showForm}
            setShowForm={setShowForm}
            form={form}
            setForm={setForm}
            convertError={convertError}
            converting={converting}
            handleConvert={handleConvert}
            fieldErrors={fieldErrors}
            savedLeadId={savedLeadId}
            dismissPostConvert={dismissPostConvert}
            dialerQuery={dialerQuery}
            setDialerQuery={setDialerQuery}
            matchedContact={matchedContact}
            searchResults={searchResults}
            pickRecipient={pickRecipient}
          />
        )}
      </div>
    </main>
  );
}

// ── Day grouping ────────────────────────────────────────────────────────
type DayGroup = { key: string; label: string; items: RecentCall[] };

function groupByDay(calls: RecentCall[]): DayGroup[] {
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const c of calls) {
    const at = c.recordedAt ? new Date(c.recordedAt) : null;
    if (!at || Number.isNaN(at.getTime())) continue;
    const key = DAY_KEY.format(at);
    let g = byKey.get(key);
    if (!g) {
      g = { key, label: dayLabel(at, today, yesterday), items: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.items.push(c);
  }
  return groups;
}

// ── Recents pane ────────────────────────────────────────────────────────
function RecentsPane({
  groups, counts, filter, onFilterChange, onRecall,
}: {
  groups: DayGroup[];
  counts: { all: number; missed: number; inbound: number; outbound: number };
  filter: RecentsFilter;
  onFilterChange: (f: RecentsFilter) => void;
  onRecall: (c: RecentCall) => void;
}) {
  const filters: Array<{ key: RecentsFilter; label: string; count: number; red?: boolean }> = [
    { key: "all", label: "Tous", count: counts.all },
    { key: "missed", label: "Manqués", count: counts.missed, red: true },
    { key: "inbound", label: "Entrants", count: counts.inbound },
    { key: "outbound", label: "Sortants", count: counts.outbound },
  ];

  return (
    <>
      <div className="ph-filters" role="tablist" aria-label="Filtrer les appels">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={`ph-fchip${filter === f.key ? " ph-fchip--active" : ""}${f.red ? " ph-fchip--red" : ""}`}
            onClick={() => onFilterChange(f.key)}
          >
            {f.label}
            <span className="ph-fchip__c">{f.count}</span>
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="ph-empty">Aucun appel dans cette catégorie.</div>
      ) : (
        groups.map((group) => (
          <Fragment key={group.key}>
            <div className="ph-day">{group.label}</div>
            <div className="ph-calls">
              {group.items.map((call) => (
                <CallRow key={call.id} call={call} onRecall={onRecall} />
              ))}
            </div>
          </Fragment>
        ))
      )}
    </>
  );
}

function CallRow({ call, onRecall }: { call: RecentCall; onRecall: (c: RecentCall) => void }) {
  const [open, setOpen] = useState(false);
  const isUnknown = !call.name;
  const linked = Boolean(call.leadId || call.contactId || call.investorId);
  const initials = initialsFor(call.name);
  const inferredName = isUnknown ? inferNameFromTranscript(call.transcript || call.summary || call.notes) : null;
  const canOpen = hasCallText(call);

  const dirIconCls = call.missed
    ? "ph-call-av__dir ph-call-av__dir--miss"
    : call.direction === "inbound"
      ? "ph-call-av__dir ph-call-av__dir--in"
      : "ph-call-av__dir ph-call-av__dir--out";

  const body = (
    <>
      <div className={`ph-call-av${isUnknown ? " ph-call-av--u" : ""}`}>
        {isUnknown ? <UserPlusIcon /> : <span>{initials || "?"}</span>}
        <span className={dirIconCls} aria-hidden="true">
          {call.missed ? <ArrowMissIcon /> : call.direction === "inbound" ? <ArrowInIcon /> : <ArrowOutIcon />}
        </span>
      </div>
      <div className="ph-call-body">
        <div className="ph-call-top">
          <span className={`ph-call-n${isUnknown ? " mono" : ""}`}>
            {call.name ?? (formatPhoneDisplay(call.number) || call.number || "Numéro inconnu")}
          </span>
          <span className="ph-call-time">{formatTime(call.recordedAt)}</span>
        </div>
        <div className="ph-call-meta">
          <span>
            {call.missed ? "Manqué" : call.direction === "inbound" ? "Entrant" : "Sortant"}
          </span>
          {call.durationSec ? (
            <>
              <span className="ph-call-meta__dot" />
              <span className="ph-call-meta__dur mono">{formatDuration(call.durationSec)}</span>
            </>
          ) : null}
        </div>
        {call.address ? (
          <span className="ph-call-deal">
            <PipelineIcon />
            {call.address}
          </span>
        ) : inferredName ? (
          <span className="ph-call-link">
            <SearchIcon />
            Possible: {inferredName}
          </span>
        ) : isUnknown ? (
          <span className="ph-call-link">
            <PlusIcon />
            {call.missed ? "Lier à un lead" : "Identifier le numéro"}
          </span>
        ) : null}
      </div>
    </>
  );

  return (
    <div className={`ph-call${call.missed ? " ph-call--missed" : ""}`}>
      {linked ? (
        <Link
          href={detailHref(call) as never}
          className="ph-call__main"
          aria-label={`Ouvrir ${call.name ?? call.number}`}
        >
          {body}
        </Link>
      ) : (
        <button
          type="button"
          className="ph-call__main"
          onClick={() => onRecall(call)}
          aria-label={`Rappeler ${call.number}`}
        >
          {body}
        </button>
      )}
      {canOpen ? (
        <button
          type="button"
          className="ph-call-note-toggle"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Masquer" : "Notes"}
        </button>
      ) : null}
      <button
        type="button"
        className="ph-call-action"
        onClick={() => onRecall(call)}
        aria-label={call.name ? `Rappeler ${call.name}` : "Rappeler ce numéro"}
      >
        <PhoneSmallIcon />
      </button>
      {open && canOpen ? <CallTextPanel call={call} inferredName={inferredName} /> : null}
    </div>
  );
}

function CallTextPanel({ call, inferredName }: { call: RecentCall; inferredName: string | null }) {
  return (
    <div className="ph-call-text">
      <div className="ph-call-text__grid">
        <div>
          <span>Direction</span>
          <strong>{call.direction === "inbound" ? "Entrant" : "Sortant"}</strong>
        </div>
        <div>
          <span>Outcome</span>
          <strong>{call.outcome ? call.outcome.replace(/_/g, " ") : "—"}</strong>
        </div>
        <div>
          <span>Transcript</span>
          <strong>{call.transcriptStatus ?? (call.transcript ? "completed" : "—")}</strong>
        </div>
      </div>
      {inferredName ? (
        <div className="ph-call-text__hint">
          Suggested name from transcript: <strong>{inferredName}</strong>
        </div>
      ) : null}
      {call.summary ? (
        <section>
          <h4>Summary</h4>
          <p>{call.summary}</p>
        </section>
      ) : null}
      {call.notes ? (
        <section>
          <h4>Notes</h4>
          <p>{call.notes}</p>
        </section>
      ) : null}
      {call.transcript ? (
        <section>
          <h4>Transcript</h4>
          <pre>{call.transcript}</pre>
        </section>
      ) : null}
    </div>
  );
}

function detailHref(call: RecentCall): string {
  if (call.leadId) return `/leads/${call.leadId}`;
  if (call.contactId) return `/contacts/${call.contactId}`;
  if (call.investorId) return `/investisseurs/${call.investorId}`;
  return "#";
}

// ── Dialer pane ─────────────────────────────────────────────────────────
function DialerPane(props: {
  phoneRaw: string;
  phoneError: string | null;
  callState: CallState;
  callError: string | null;
  durationSec: number;
  callActive: boolean;
  press: (d: string) => void;
  backspace: () => void;
  pasteFromClipboard: () => void;
  handleStartCall: () => void;
  callHistory: HistoryRow[];
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  form: ConvertForm;
  setForm: React.Dispatch<React.SetStateAction<ConvertForm>>;
  convertError: string | null;
  converting: boolean;
  handleConvert: () => void;
  fieldErrors: { first_name?: string; last_name?: string };
  savedLeadId: string | null;
  dismissPostConvert: () => void;
  dialerQuery: string;
  setDialerQuery: (s: string) => void;
  matchedContact: Recipient | null;
  searchResults: Recipient[];
  pickRecipient: (r: Recipient) => void;
}) {
  const {
    phoneRaw, phoneError, callState, callError, durationSec,
    callActive, press, backspace, pasteFromClipboard, handleStartCall,
    callHistory, showForm, setShowForm, form, setForm, convertError, converting,
    handleConvert, fieldErrors, savedLeadId, dismissPostConvert,
    dialerQuery, setDialerQuery, matchedContact, searchResults, pickRecipient,
  } = props;
  const { t } = useLocale();

  const phoneDisplay = phoneRaw ? formatPhoneDisplay(phoneRaw) : "";
  const callLabel = matchedContact
    ? `Appeler ${firstNameOf(matchedContact.label) ?? matchedContact.label}`
    : "Appeler";

  return (
    <div className="ph-dialer">
      <div className="ph-dial-search">
        <SearchIcon />
        <input
          type="search"
          value={dialerQuery}
          onChange={(e) => setDialerQuery(e.target.value)}
          placeholder="Chercher un contact, lead ou deal…"
          aria-label="Rechercher un contact"
        />
      </div>

      {searchResults.length > 0 && (
        <ul className="ph-dial-results">
          {searchResults.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="ph-dial-result"
                onClick={() => pickRecipient(r)}
              >
                <span className="ph-dial-result__l">{r.label}</span>
                <span className="ph-dial-result__s">
                  {[r.sublabel, r.dealTitle].filter(Boolean).join(" · ")}
                </span>
                <span className="ph-dial-result__n mono">{r.number}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="ph-dial-display">
        <div className={`ph-dial-num${!phoneRaw ? " ph-dial-num--empty" : " mono"}`} aria-live="polite">
          {phoneDisplay || "Entre un numéro"}
        </div>
        {matchedContact && (
          <div className="ph-dial-hint">
            <span className="mono">{matchedContact.label}</span>
            {matchedContact.sublabel || matchedContact.dealTitle ? (
              <>
                <span className="ph-dial-hint__dot" />
                {matchedContact.dealId ? (
                  <Link href={`/pipeline/${matchedContact.dealId}` as never}>
                    {matchedContact.dealTitle ?? matchedContact.sublabel}
                  </Link>
                ) : matchedContact.leadId ? (
                  <Link href={`/leads/${matchedContact.leadId}` as never}>
                    {matchedContact.sublabel ?? matchedContact.dealTitle}
                  </Link>
                ) : (
                  <span>{matchedContact.sublabel ?? matchedContact.dealTitle}</span>
                )}
              </>
            ) : null}
          </div>
        )}
        {phoneError && <div className="ph-dial-err">{phoneError}</div>}
      </div>

      <div className="ph-keypad-grid" role="group" aria-label="Clavier numérique">
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
            <span className="ph-key__l">{k.letters || " "}</span>
          </button>
        ))}
      </div>

      <div className="ph-dial-actions">
        <button
          type="button"
          className="ph-dial-iconbtn"
          onClick={pasteFromClipboard}
          disabled={callActive}
          aria-label="Coller depuis le presse-papier"
        >
          <PasteIcon />
        </button>
        {callActive ? (
          <button type="button" className="ph-dial-call ph-dial-call--busy" disabled aria-label="Appel en cours">
            <PhoneCallIcon />
            {callState === "initiating" ? "Connexion…"
              : callState === "ringing" ? "Sonnerie…"
              : `En cours · ${formatDurationShort(durationSec)}`}
          </button>
        ) : (
          <button
            type="button"
            className="ph-dial-call"
            onClick={() => void handleStartCall()}
            disabled={!phoneRaw.trim()}
            aria-label={callLabel}
          >
            <PhoneCallIcon />
            {callLabel}
          </button>
        )}
        <button
          type="button"
          className="ph-dial-iconbtn"
          onClick={backspace}
          disabled={!phoneRaw || callActive}
          aria-label="Effacer le dernier chiffre"
        >
          <BackspaceIcon />
        </button>
      </div>

      {(callState === "initiating" || callState === "ringing" || callState === "answered" || callState === "completed") && (
        <div className="ph-dial-callstate">
          <TwilioCallStatePanel callState={callState} durationSec={durationSec} />
        </div>
      )}

      {callError && <div className="ph-error">{callError}</div>}

      {callHistory.length > 0 && (
        <div className="ph-card">
          <div className="ph-card__title">Enregistrement &amp; transcription</div>
          <CallHistoryPanel history={callHistory} />
        </div>
      )}

      {showForm && (
        <ConvertFormPanel
          form={form}
          setForm={setForm}
          convertError={convertError}
          converting={converting}
          onSubmit={handleConvert}
          fieldErrors={fieldErrors}
        />
      )}

      {savedLeadId && (
        <div className="ph-card ph-post-convert" role="status">
          <div className="ph-card__title">{t.toasts.leadSaved}</div>
          <Link
            href={`/leads/${savedLeadId}` as never}
            className="btn btn--gold"
            onClick={dismissPostConvert}
          >
            Ouvrir la fiche
          </Link>
          <Link
            href={"/calls/queue" as never}
            className="btn btn--ghost"
            onClick={dismissPostConvert}
          >
            Prochain appel · file →
          </Link>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={dismissPostConvert}
          >
            Nouveau numéro
          </button>
        </div>
      )}

      {!showForm && !savedLeadId && callState !== "idle" && callState !== "failed" && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowForm(true)}>
          Remplir le formulaire maintenant
        </button>
      )}
    </div>
  );
}

function formatDurationShort(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Convert form ────────────────────────────────────────────────────────
function ConvertFormPanel({
  form, setForm, convertError, converting, onSubmit, fieldErrors,
}: {
  form: ConvertForm;
  setForm: React.Dispatch<React.SetStateAction<ConvertForm>>;
  convertError: string | null;
  converting: boolean;
  onSubmit: () => void;
  fieldErrors: { first_name?: string; last_name?: string };
}) {
  return (
    <div className="ph-convert">
      <div className="ph-convert__title">Convertir en lead</div>

      <div className="ph-convert__grid">
        <ConvField
          label="Prénom *"
          value={form.first_name}
          onChange={(v) => setForm((f) => ({ ...f, first_name: v }))}
          placeholder="Jean"
          error={fieldErrors.first_name}
          required
        />
        <ConvField
          label="Nom *"
          value={form.last_name}
          onChange={(v) => setForm((f) => ({ ...f, last_name: v }))}
          placeholder="Tremblay"
          error={fieldErrors.last_name}
          required
        />
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
  label, value, onChange, placeholder, error, required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <div className={`ph-convert__field${error ? " ph-convert__field--err" : ""}`}>
      <label>{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={error ? "true" : undefined}
        aria-required={required ? "true" : undefined}
      />
      {error && <div className="ph-convert__field-err" role="alert">{error}</div>}
    </div>
  );
}

// ── Icons ───────────────────────────────────────────────────────────────
function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function KeypadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {[6, 12, 18].flatMap((y) => [6, 12, 18].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" />))}
    </svg>
  );
}
function PhoneCallIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" />
    </svg>
  );
}
function PhoneSmallIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" />
    </svg>
  );
}
function BackspaceIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 5H8l-6 7 6 7h13a1 1 0 001-1V6a1 1 0 00-1-1z" />
      <path d="M11 9l6 6M17 9l-6 6" />
    </svg>
  );
}
function PasteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M5 7h2v14h10V7h2" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-5-5" />
    </svg>
  );
}
function ArrowInIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 5L5 19M5 8v11h11" />
    </svg>
  );
}
function ArrowOutIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 19L19 5M8 5h11v11" />
    </svg>
  );
}
function ArrowMissIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}
function UserPlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="11" r="3" />
      <path d="M12 14v4M9 18h6" />
    </svg>
  );
}
function PipelineIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M9 17V7m6 10V7M5 7h14M5 17h14" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
