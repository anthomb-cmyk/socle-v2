"use client";
// Phase 6 — orchestrator. The transcript polling cadence and the
// AI Organize POST endpoint are byte-identical to the previous
// implementation; they live in CallHistoryTranscript and
// CallHistoryOrganizeBlock respectively. CallHistoryPanel itself is
// now a thin pass-through to the timeline shell.

import CallHistoryTimeline from "./components/CallHistoryTimeline";
import type { HistoryRow } from "./components/CallHistoryEntry";

export default function CallHistoryPanel({ history }: { history: HistoryRow[] }) {
  return <CallHistoryTimeline rows={history} />;
}
