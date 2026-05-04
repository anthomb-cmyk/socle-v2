"use client";
import { useState } from "react";

type HistoryRow = {
  id: string;
  outcome: string | null;
  notes: string | null;
  recorded_at: string | null;
  duration_sec: number | null;
  recording_url: string | null;
  transcript_status: string | null;
  transcript: string | null;
};

function formatDuration(sec: number | null): string {
  if (!sec || sec <= 0) return "";
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m${sec % 60 > 0 ? `${sec % 60}s` : ""}`;
}

function TranscriptBlock({ row }: { row: HistoryRow }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(row.transcript_status ?? "none");
  const [text, setText] = useState(row.transcript ?? "");
  const [err, setErr] = useState<string | null>(null);

  const hasRecording = Boolean(row.recording_url);
  if (!hasRecording) return null;

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
            // Reload transcript text via a simple page refresh signal
            // (simplest approach: trigger a reload of the transcript text)
            const tr = await fetch(`/api/calls/status?callLogId=${row.id}`);
            const tj = await tr.json();
            if (tj.ok) setText(tj.data?.transcript ?? "");
          }
        }
      }, 3000);
    } catch {
      setErr("Erreur réseau");
      setLoading(false);
    }
  }

  return (
    <div className="mt-1">
      {status === "completed" && text ? (
        <div>
          <button
            onClick={() => setOpen(o => !o)}
            className="text-xs text-indigo-600 hover:underline"
          >
            {open ? "▲ Masquer la transcription" : "▼ Voir la transcription"}
          </button>
          {open && (
            <div className="mt-1 bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-xs text-zinc-700 whitespace-pre-wrap leading-relaxed">
              {text}
            </div>
          )}
        </div>
      ) : status === "processing" ? (
        <span className="text-xs text-zinc-400 animate-pulse">⏳ Transcription en cours…</span>
      ) : status === "failed" ? (
        <span className="text-xs text-red-500">Transcription échouée · <button onClick={requestTranscript} className="underline">réessayer</button></span>
      ) : (
        // "none", "pending_recording", "disabled" — show button if recording exists
        hasRecording && (
          <button
            onClick={requestTranscript}
            disabled={loading}
            className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
          >
            {loading ? "Demande envoyée…" : "📝 Obtenir la transcription"}
          </button>
        )
      )}
      {err && <span className="text-xs text-red-500 ml-2">{err}</span>}
    </div>
  );
}

export default function CallHistoryPanel({ history }: { history: HistoryRow[] }) {
  return (
    <section className="mt-8">
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
        Historique des appels ({history.length})
      </h2>
      <ul className="space-y-3">
        {history.map((h) => {
          const dur = formatDuration(h.duration_sec);
          return (
            <li key={h.id} className="text-sm border-l-2 border-zinc-200 pl-3">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-medium text-zinc-800">{h.outcome ?? "—"}</span>
                {dur && <span className="text-xs text-zinc-500">{dur}</span>}
                {h.recording_url && <span className="text-xs text-zinc-400">🎙</span>}
                <span className="text-xs text-zinc-400">
                  {h.recorded_at ? new Date(h.recorded_at).toLocaleString("fr-CA", {
                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                  }) : ""}
                </span>
              </div>
              {h.notes && <div className="text-zinc-600 text-xs mt-0.5">{h.notes}</div>}
              <TranscriptBlock row={h} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
