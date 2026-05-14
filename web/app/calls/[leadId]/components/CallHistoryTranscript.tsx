"use client";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";
import CallHistoryOrganizeBlock from "./CallHistoryOrganizeBlock";

type Row = {
  id: string;
  recording_url: string | null;
  transcript_status: string | null;
  transcript: string | null;
};

type Props = {
  row: Row;
};

/**
 * Phase 6 — extracted transcript block. Polling cadence and detection
 * logic byte-identical to the previous TranscriptBlock:
 *  - POST /api/calls/{id}/transcribe to request a new transcript
 *  - then poll GET /api/calls/status?callLogId={id} every 3 seconds
 *  - states: none | processing | completed | failed
 */
export default function CallHistoryTranscript({ row }: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(row.transcript_status ?? "none");
  const [text, setText] = useState(row.transcript ?? "");
  const [err, setErr] = useState<string | null>(null);

  const hasRecording = Boolean(row.recording_url);
  if (!hasRecording) return null;

  async function loadTranscript() {
    if (text) {
      setOpen((o) => !o);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/calls/status?callLogId=${row.id}`);
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error ?? t.history.networkError);
        return;
      }
      const nextText = json.data?.transcript ?? "";
      if (nextText) {
        setText(nextText);
        setOpen(true);
      } else {
        setErr(t.history.transcriptFailed);
      }
    } catch {
      setErr(t.history.networkError);
    } finally {
      setLoading(false);
    }
  }

  async function requestTranscript() {
    if (status === "processing") return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/calls/${row.id}/transcribe`, { method: "POST" });
      const j = await r.json();
      if (!j.ok) { setErr(j.error); setLoading(false); return; }
      setStatus("processing");
      setLoading(false);
      // Poll until done
      const iv = setInterval(async () => {
        const pr = await fetch(`/api/calls/status?callLogId=${row.id}`);
        const pj = await pr.json();
        if (!pj.ok) return;
        const ts: string = pj.data?.transcriptStatus ?? "";
        setStatus(ts);
        if (ts === "completed" || ts === "failed") {
          clearInterval(iv);
          if (ts === "completed") {
            const tr = await fetch(`/api/calls/status?callLogId=${row.id}`);
            const tj = await tr.json();
            if (tj.ok) setText(tj.data?.transcript ?? "");
          }
        }
      }, 3000);
    } catch {
      setErr(t.history.networkError);
      setLoading(false);
    }
  }

  return (
    <div className="ch-transcript">
      {status === "completed" && text ? (
        <div>
          <div className="ch-transcript__row">
            <button
              type="button"
              onClick={loadTranscript}
              className="crm-link-btn"
            >
              {open ? t.history.hideTranscript : t.history.showTranscript}
            </button>
            <CallHistoryOrganizeBlock callLogId={row.id} />
          </div>
          {open && (
            <div className="ch-transcript__body">{text}</div>
          )}
        </div>
      ) : status === "completed" ? (
        <button
          type="button"
          onClick={loadTranscript}
          disabled={loading}
          className="crm-link-btn"
        >
          {loading ? t.history.requesting : t.history.showTranscript}
        </button>
      ) : status === "processing" ? (
        <span className="ch-transcript__pending">{t.history.transcribing}</span>
      ) : status === "failed" ? (
        <span className="ch-transcript__failed">
          {t.history.transcriptFailed} ·{" "}
          <button type="button" onClick={requestTranscript} className="crm-link-btn">
            {t.history.retry}
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={requestTranscript}
          disabled={loading}
          className="crm-link-btn"
        >
          {loading ? t.history.requesting : t.history.getTranscript}
        </button>
      )}
      {err && <span className="ch-transcript__err">{err}</span>}
    </div>
  );
}
