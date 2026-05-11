"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import TwilioCallStatePanel, { type CallState } from "@/app/calls/[leadId]/components/TwilioCallStatePanel";
import CallHistoryPanel from "@/app/calls/[leadId]/CallHistoryPanel";
import type { HistoryRow } from "@/app/calls/[leadId]/components/CallHistoryEntry";
import { normalizePhone } from "@/lib/twilio";

// ── Types ─────────────────────────────────────────────────────────────────────
type Intent = "cold" | "warm" | "hot";

type ConvertForm = {
  first_name:  string;
  last_name:   string;
  street:      string;
  city:        string;
  postal_code: string;
  notes:       string;
  intent:      Intent;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatPhoneDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  }
  return raw;
}

// ── Input component ───────────────────────────────────────────────────────────
function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>
        {label}{required && <span style={{ color: "#EF4444", marginLeft: 2 }}>*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: "8px 12px",
          border: "1px solid #E5E7EB",
          borderRadius: 8,
          fontSize: 14,
          outline: "none",
          color: "#111827",
          background: "#fff",
          width: "100%",
          boxSizing: "border-box",
        }}
        onFocus={e => (e.currentTarget.style.borderColor = "#C9A84C")}
        onBlur={e => (e.currentTarget.style.borderColor = "#E5E7EB")}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function QuickCallClient() {
  const router = useRouter();

  // Phone input state
  const [phoneRaw, setPhoneRaw]   = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);

  // Call state (mirrors DealWorkspaceClient pattern)
  const [callState, setCallState]     = useState<CallState>("idle");
  const [callError, setCallError]     = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState<number>(0);
  const activeCallLogId               = useRef<string | null>(null);
  const pollRef                       = useRef<ReturnType<typeof setInterval> | null>(null);

  // Post-call history (shown once call_log has a recording)
  const [callHistory, setCallHistory] = useState<HistoryRow[]>([]);
  const historyLoadedRef              = useRef(false);

  // Convert form
  const [showForm, setShowForm]   = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [form, setForm] = useState<ConvertForm>({
    first_name:  "",
    last_name:   "",
    street:      "",
    city:        "",
    postal_code: "",
    notes:       "",
    intent:      "cold",
  });

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
        if (typeof j.data?.durationSec === "number") setDurationSec(j.data.durationSec);
        if (last === "completed" || (j.data?.durationSec != null && last === "")) {
          setCallState("completed");
          stopPolling();
          // Show the convert form and load call history
          setShowForm(true);
          void loadCallHistory(callLogId);
        }
      } catch { /* non-fatal */ }
    }, 3000);
  }

  async function loadCallHistory(callLogId: string) {
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    try {
      const r = await fetch(`/api/quick-call/history?callLogId=${callLogId}`);
      const j = await r.json();
      if (j.ok && j.data) setCallHistory(j.data);
    } catch { /* non-fatal */ }
  }

  useEffect(() => () => stopPolling(), []);

  async function handleStartCall() {
    setPhoneError(null);
    const normalized = normalizePhone(phoneRaw);
    if (!normalized) {
      setPhoneError("Numéro invalide. Saisir un numéro à 10 chiffres ou E.164.");
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
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ phone_e164: normalized }),
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
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          first_name:  form.first_name.trim(),
          last_name:   form.last_name.trim(),
          street:      form.street.trim() || undefined,
          city:        form.city.trim() || undefined,
          postal_code: form.postal_code.trim() || undefined,
          notes:       form.notes.trim() || undefined,
          intent:      form.intent,
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

  const callActive =
    callState === "initiating" ||
    callState === "ringing" ||
    callState === "answered";

  const phoneDisplay = phoneRaw ? formatPhoneDisplay(phoneRaw) : "";
  const normalized   = normalizePhone(phoneRaw);

  return (
    <div style={{ padding: "0 0 60px" }}>
      {/* ── Header ── */}
      <div style={{
        borderBottom: "1px solid var(--crm-card-border, #E5E7EB)",
        padding: "16px 24px",
        background: "#fff",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "#111827" }}>
          Appel rapide
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6B7280" }}>
          Appelez un numéro inconnu, enregistrez la conversation et convertissez en lead.
        </p>
      </div>

      {/* ── Body ── */}
      <div style={{ padding: 24, maxWidth: 520, display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── Phone input card ── */}
        <div style={{
          background: "#fff",
          border: "1px solid #E5E7EB",
          borderRadius: 14,
          padding: "20px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Numéro à appeler</div>

          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <input
                type="tel"
                value={phoneRaw}
                onChange={e => { setPhoneRaw(e.target.value); setPhoneError(null); }}
                onKeyDown={e => { if (e.key === "Enter" && !callActive) void handleStartCall(); }}
                placeholder="514 555-1234"
                disabled={callActive}
                style={{
                  padding: "10px 14px",
                  border: `1px solid ${phoneError ? "#EF4444" : "#E5E7EB"}`,
                  borderRadius: 10,
                  fontSize: 20,
                  fontWeight: 700,
                  letterSpacing: "1px",
                  outline: "none",
                  color: "#111827",
                  background: callActive ? "#F9FAFB" : "#fff",
                  width: "100%",
                  boxSizing: "border-box",
                }}
                onFocus={e => { if (!phoneError) e.currentTarget.style.borderColor = "#C9A84C"; }}
                onBlur={e => { if (!phoneError) e.currentTarget.style.borderColor = "#E5E7EB"; }}
              />
              {normalized && !phoneError && (
                <div style={{ fontSize: 12, color: "#6B7280", paddingLeft: 2 }}>
                  {phoneDisplay} → <span style={{ fontFamily: "monospace" }}>{normalized}</span>
                </div>
              )}
              {phoneError && (
                <div style={{ fontSize: 12, color: "#EF4444" }}>{phoneError}</div>
              )}
            </div>

            {/* Appeler button */}
            {(callState === "idle" || callState === "failed" || callState === "completed") ? (
              <button
                type="button"
                onClick={() => void handleStartCall()}
                disabled={!phoneRaw.trim()}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "10px 20px",
                  background: phoneRaw.trim() ? "var(--crm-gold, #C9A84C)" : "#E5E7EB",
                  color: phoneRaw.trim() ? "#fff" : "#9CA3AF",
                  borderRadius: 10, fontSize: 14, fontWeight: 700,
                  border: "none", cursor: phoneRaw.trim() ? "pointer" : "not-allowed",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"
                    stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
                Appeler
              </button>
            ) : (
              <button
                type="button"
                disabled
                style={{
                  padding: "10px 20px",
                  background: "#F3F4F6", color: "#6B7280",
                  borderRadius: 10, fontSize: 14, fontWeight: 700,
                  border: "none", cursor: "not-allowed",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                {callState === "initiating" ? "Connexion…"
                  : callState === "ringing"  ? "Sonnerie…"
                  : "En cours…"}
              </button>
            )}
          </div>

          {/* Fallback manual dial link */}
          {normalized && (
            <a
              href={`tel:${normalized}`}
              style={{
                display: "inline-block",
                fontSize: 12, color: "#6B7280", textDecoration: "none",
                textAlign: "center",
              }}
            >
              Composer manuellement
            </a>
          )}

          {/* Live call state panel */}
          {(callState === "initiating" || callState === "ringing" || callState === "answered" || callState === "completed") && (
            <div style={{ marginTop: 4 }}>
              <TwilioCallStatePanel callState={callState} durationSec={durationSec} />
            </div>
          )}

          {callError && (
            <div style={{ fontSize: 13, color: "#EF4444", fontWeight: 600 }}>{callError}</div>
          )}
        </div>

        {/* ── Call history (recording + transcript) ── */}
        {callHistory.length > 0 && (
          <div style={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 14,
            padding: "18px 20px",
          }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", marginBottom: 12 }}>
              Enregistrement &amp; transcription
            </div>
            <CallHistoryPanel history={callHistory} />
          </div>
        )}

        {/* ── Convert to lead form ── */}
        {showForm && (
          <div style={{
            background: "#fff",
            border: "2px solid var(--crm-gold, #C9A84C)",
            borderRadius: 14,
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>
              Informations sur l&apos;appelant
            </div>

            {/* Name row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field
                label="Prénom"
                value={form.first_name}
                onChange={v => setForm(f => ({ ...f, first_name: v }))}
                placeholder="Jean"
                required
              />
              <Field
                label="Nom"
                value={form.last_name}
                onChange={v => setForm(f => ({ ...f, last_name: v }))}
                placeholder="Tremblay"
                required
              />
            </div>

            {/* Address */}
            <Field
              label="Adresse (rue)"
              value={form.street}
              onChange={v => setForm(f => ({ ...f, street: v }))}
              placeholder="123 rue des Érables"
            />

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
              <Field
                label="Ville"
                value={form.city}
                onChange={v => setForm(f => ({ ...f, city: v }))}
                placeholder="Montréal"
              />
              <Field
                label="Code postal"
                value={form.postal_code}
                onChange={v => setForm(f => ({ ...f, postal_code: v }))}
                placeholder="H1A 1A1"
              />
            </div>

            {/* Intent */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Intention
              </label>
              <select
                value={form.intent}
                onChange={e => setForm(f => ({ ...f, intent: e.target.value as Intent }))}
                style={{
                  padding: "8px 12px",
                  border: "1px solid #E5E7EB",
                  borderRadius: 8,
                  fontSize: 14,
                  outline: "none",
                  background: "#fff",
                  color: "#111827",
                }}
              >
                <option value="cold">Froid — pas encore prêt à vendre</option>
                <option value="warm">Tiède — potentiellement intéressé</option>
                <option value="hot">Chaud — veut vendre</option>
              </select>
            </div>

            {/* Notes */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Notes
              </label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={3}
                placeholder="Ce que vous avez appris durant l'appel…"
                style={{
                  padding: "8px 12px",
                  border: "1px solid #E5E7EB",
                  borderRadius: 8,
                  fontSize: 14,
                  outline: "none",
                  resize: "vertical",
                  background: "#fff",
                  color: "#111827",
                  fontFamily: "inherit",
                }}
                onFocus={e => (e.currentTarget.style.borderColor = "#C9A84C")}
                onBlur={e => (e.currentTarget.style.borderColor = "#E5E7EB")}
              />
            </div>

            {convertError && (
              <div style={{ fontSize: 13, color: "#EF4444", fontWeight: 600 }}>{convertError}</div>
            )}

            <button
              type="button"
              onClick={() => void handleConvert()}
              disabled={converting || !form.first_name.trim() || !form.last_name.trim()}
              style={{
                padding: "12px",
                background:
                  converting || !form.first_name.trim() || !form.last_name.trim()
                    ? "#E5E7EB"
                    : "var(--crm-gold, #C9A84C)",
                color:
                  converting || !form.first_name.trim() || !form.last_name.trim()
                    ? "#9CA3AF"
                    : "#fff",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 800,
                border: "none",
                cursor:
                  converting || !form.first_name.trim() || !form.last_name.trim()
                    ? "not-allowed"
                    : "pointer",
                letterSpacing: "0.3px",
              }}
            >
              {converting ? "Conversion en cours…" : "Convertir en lead"}
            </button>
          </div>
        )}

        {/* Show form button even during active call (optional) */}
        {!showForm && callState !== "idle" && callState !== "failed" && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            style={{
              padding: "10px",
              background: "transparent",
              color: "var(--crm-gold, #C9A84C)",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              border: "1px solid var(--crm-gold, #C9A84C)",
              cursor: "pointer",
            }}
          >
            Remplir le formulaire maintenant
          </button>
        )}
      </div>
    </div>
  );
}
