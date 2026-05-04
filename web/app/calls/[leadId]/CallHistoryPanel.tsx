"use client";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

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

// ── AI Organize result display ────────────────────────────────────────────────
type OrganizedNotes = {
  seller_name?: string | null;
  intent_level?: string | null;
  asking_price?: number | null;
  objections?: string[];
  next_steps?: string[];
  summary?: string | null;
};

const INTENT_COLORS: Record<string, { bg: string; text: string }> = {
  very_hot:       { bg: "#FEF2F2", text: "#B91C1C" },
  hot:            { bg: "#FFFBEB", text: "#92400E" },
  warm:           { bg: "#F0FDF4", text: "#166534" },
  cold:           { bg: "#F9FAFB", text: "#4B5563" },
  not_interested: { bg: "#F3F4F6", text: "#6B7280" },
};

function OrganizeBlock({ callLogId }: { callLogId: string }) {
  const { t } = useLocale();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OrganizedNotes | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function organize() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/calls/${callLogId}/organize`, { method: "POST" });
      const j = await r.json();
      if (!j.ok) { setErr(j.error); return; }
      setResult(j.data);
    } catch {
      setErr(t.history.networkError);
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    const ic = INTENT_COLORS[result.intent_level ?? "cold"] ?? INTENT_COLORS.cold;
    return (
      <div style={{
        marginTop: 8, background: "#FAFAFA", border: "1px solid #E5E7EB",
        borderRadius: 10, padding: "10px 12px", fontSize: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 12, color: "#374151" }}>{t.history.aiAnalysis}</span>
          {result.seller_name && (
            <span style={{ color: "#6B7280" }}>{result.seller_name}</span>
          )}
          {result.intent_level && (
            <span style={{
              padding: "2px 8px", borderRadius: 10, fontWeight: 600, fontSize: 11,
              background: ic.bg, color: ic.text,
            }}>
              {result.intent_level.replace("_", " ")}
            </span>
          )}
          {result.asking_price && (
            <span style={{ color: "#059669", fontWeight: 600 }}>
              {new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(result.asking_price)}
            </span>
          )}
        </div>

        {result.summary && (
          <div style={{ color: "#374151", marginBottom: 6, lineHeight: 1.5 }}>{result.summary}</div>
        )}

        {result.objections && result.objections.length > 0 && (
          <div style={{ marginBottom: 4 }}>
            <span style={{ fontWeight: 600, color: "#6B7280" }}>{t.history.objections} </span>
            <span style={{ color: "#374151" }}>{result.objections.join(" · ")}</span>
          </div>
        )}

        {result.next_steps && result.next_steps.length > 0 && (
          <div>
            <span style={{ fontWeight: 600, color: "#6B7280" }}>{t.history.nextSteps}</span>
            <ul style={{ margin: "2px 0 0 0", paddingLeft: 16 }}>
              {result.next_steps.map((s, i) => (
                <li key={i} style={{ color: "#374151", marginBottom: 2 }}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={organize}
        disabled={loading}
        style={{
          fontSize: 11, color: "#7C3AED", background: "#F5F3FF",
          border: "1px solid #DDD6FE", borderRadius: 6,
          padding: "3px 9px", cursor: "pointer",
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? t.history.aiAnalyzing : t.history.aiAnalyzeBtn}
      </button>
      {err && <span style={{ fontSize: 11, color: "#EF4444", marginLeft: 6 }}>{err}</span>}
    </div>
  );
}

// ── TranscriptBlock ───────────────────────────────────────────────────────────
function TranscriptBlock({ row }: { row: HistoryRow }) {
  const { t } = useLocale();
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
    <div className="mt-1">
      {status === "completed" && text ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => setOpen(o => !o)}
              className="text-xs text-indigo-600 hover:underline"
            >
              {open ? t.history.hideTranscript : t.history.showTranscript}
            </button>
            <OrganizeBlock callLogId={row.id} />
          </div>
          {open && (
            <div className="mt-1 bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-xs text-zinc-700 whitespace-pre-wrap leading-relaxed">
              {text}
            </div>
          )}
        </div>
      ) : status === "processing" ? (
        <span className="text-xs text-zinc-400 animate-pulse">{t.history.transcribing}</span>
      ) : status === "failed" ? (
        <span className="text-xs text-red-500">
          {t.history.transcriptFailed} ·{" "}
          <button onClick={requestTranscript} className="underline">{t.history.retry}</button>
        </span>
      ) : (
        hasRecording && (
          <button
            onClick={requestTranscript}
            disabled={loading}
            className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
          >
            {loading ? t.history.requesting : t.history.getTranscript}
          </button>
        )
      )}
      {err && <span className="text-xs text-red-500 ml-2">{err}</span>}
    </div>
  );
}

// ── CallHistoryPanel ──────────────────────────────────────────────────────────
export default function CallHistoryPanel({ history }: { history: HistoryRow[] }) {
  const { t } = useLocale();

  return (
    <section className="mt-8">
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
        {t.history.title(history.length)}
      </h2>
      <ul className="space-y-3">
        {history.map((h) => {
          const dur = formatDuration(h.duration_sec);
          // Translate outcome if available; fallback to raw value
          const outcomeLabel = h.outcome
            ? (t.outcome[h.outcome] ?? h.outcome)
            : "—";
          return (
            <li key={h.id} className="text-sm border-l-2 border-zinc-200 pl-3">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-medium text-zinc-800">{outcomeLabel}</span>
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
