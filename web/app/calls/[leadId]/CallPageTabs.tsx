"use client";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

type Props = {
  /** Number of history entries — shown as badge on the history tab. */
  historyCount: number;
  /**
   * Exactly two children: [0] = workspace, [1] = history panel.
   * Using children slots keeps the server-rendered data flowing through
   * the RSC boundary without re-fetching on tab switch.
   */
  children: [React.ReactNode, React.ReactNode];
};

/**
 * Thin client shell that wraps the call workspace + history panel with
 * a two-tab switcher.
 *
 * Tab 0 — "Appel / Call" : the workspace (OwnerCard, PhoneCard, outcomes).
 * Tab 1 — "Historique / Call history" : the call history timeline.
 *
 * The workspace stays mounted so Twilio state is never lost. History mounts
 * lazily on first open, which avoids hydrating transcripts on the hot path.
 */
export default function CallPageTabs({ historyCount, children }: Props) {
  const { t } = useLocale();
  const [active, setActive] = useState<0 | 1>(0);
  const [historyMounted, setHistoryMounted] = useState(false);

  return (
    <div className="cw-page-tabs">
      {/* Tab bar */}
      <div className="cw-page-tabs__bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={active === 0}
          className={`cw-page-tab${active === 0 ? " cw-page-tab--active" : ""}`}
          onClick={() => setActive(0)}
        >
          {t.workspace.tabCall}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === 1}
          className={`cw-page-tab${active === 1 ? " cw-page-tab--active" : ""}`}
          onClick={() => {
            setHistoryMounted(true);
            setActive(1);
          }}
        >
          {t.workspace.tabHistory}
          {historyCount > 0 && (
            <span className="cw-page-tab__badge">{historyCount}</span>
          )}
        </button>
      </div>

      {/* Panels — both always mounted; only visibility changes */}
      <div style={{ display: active === 0 ? "block" : "none" }}>
        {children[0]}
      </div>
      {historyMounted && (
        <div style={{ display: active === 1 ? "block" : "none" }}>
          {children[1]}
        </div>
      )}
    </div>
  );
}
