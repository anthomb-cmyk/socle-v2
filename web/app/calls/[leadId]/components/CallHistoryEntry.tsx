"use client";
import { useLocale } from "@/components/locale-provider";
import CallHistoryTranscript from "./CallHistoryTranscript";

export type HistoryRow = {
  id: string;
  outcome: string | null;
  notes: string | null;
  recorded_at: string | null;
  duration_sec: number | null;
  recording_url: string | null;
  transcript_status: string | null;
  transcript: string | null;
};

type Props = {
  row: HistoryRow;
  isCurrent: boolean;
};

function formatDuration(sec: number | null): string {
  if (!sec || sec <= 0) return "";
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m${sec % 60 > 0 ? `${sec % 60}s` : ""}`;
}

function pillKeyForOutcome(outcome: string | null): string {
  if (!outcome) return "nouveau";
  if (outcome === "no_answer" || outcome === "voicemail_left") return "sans-reponse";
  if (outcome === "wrong_number" || outcome === "bad_number") return "a-verifier";
  if (outcome === "not_interested" || outcome === "do_not_contact") return "dnc";
  if (outcome === "maybe_later" || outcome === "call_back_later") return "contacte";
  // escalating
  if (
    outcome === "wants_more_info" || outcome === "open_to_selling" ||
    outcome === "wants_offer" || outcome === "hot_seller" ||
    outcome === "follow_up_booked"
  ) return "qualifie";
  return "nouveau";
}

/**
 * Phase 6 — single row in the history timeline. Renders the timeline rail
 * (dot + connector) on the left and the entry content on the right. The
 * recording 🎙 marker is preserved verbatim per directive — pre-existing
 * emoji tolerated, no new emojis added by Phase 6.
 */
export default function CallHistoryEntry({ row, isCurrent }: Props) {
  const { t, locale } = useLocale();
  const dur = formatDuration(row.duration_sec);
  const outcomeLabel = row.outcome ? (t.outcome[row.outcome] ?? row.outcome) : "—";
  const pillKey = pillKeyForOutcome(row.outcome);
  const recordedAt = row.recorded_at
    ? new Date(row.recorded_at).toLocaleString(locale === "fr" ? "fr-CA" : "en-CA", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "";

  return (
    <li className={`ch-entry${isCurrent ? " ch-entry--current" : ""}`}>
      <div className="ch-entry__rail" aria-hidden="true">
        <span className={`ch-entry__dot${isCurrent ? " ch-entry__dot--current" : ""}`} />
      </div>
      <div className="ch-entry__body">
        <div className="ch-entry__head">
          <span className={`crm-pill crm-pill--${pillKey}`}>{outcomeLabel}</span>
          {dur && <span className="ch-entry__duration" style={{ fontFeatureSettings: '"tnum" 1' }}>{dur}</span>}
          {row.recording_url && <span className="ch-entry__rec" aria-label="recording" style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--crm-text3)" }}>Enr.</span>}
          <span className="ch-entry__when">{recordedAt}</span>
        </div>
        {row.notes && <div className="ch-entry__notes">{row.notes}</div>}
        <CallHistoryTranscript row={row} />
      </div>
    </li>
  );
}
