"use client";
import { useRef, useEffect } from "react";
import { useLocale } from "@/components/locale-provider";
import type { PhoneCandidate } from "../PhoneReviewClient";

type Props = {
  candidate: PhoneCandidate;
  selected: boolean;
  isFocused: boolean;
  summary: string | null;   // AI one-liner shown directly on the row
  onToggleSelect: (id: string) => void;
  onSelect: (id: string) => void;
  onQuickAction: (id: string, action: "approve" | "reject") => void;
};

function formatPhone(raw: string | null): string {
  if (!raw) return "—";
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

function confidenceVariant(score: number): "high" | "mid" | "low" {
  if (score >= 80) return "high";
  if (score >= 50) return "mid";
  return "low";
}

/**
 * Compact list row with inline approve/reject buttons.
 * Quick action buttons are always visible so the user can process
 * all 178 candidates without opening the detail panel.
 * Clicking the row body still opens the detail panel for edge cases.
 */
export default function PhoneReviewListItem({
  candidate, selected, isFocused, summary, onToggleSelect, onSelect, onQuickAction,
}: Props) {
  const { t } = useLocale();
  const liRef = useRef<HTMLLIElement>(null);
  const contact = candidate.leads?.contacts;
  const property = candidate.leads?.properties;
  const name = contact?.full_name ?? contact?.company_name ?? "—";
  const address = property?.address ?? "—";
  const city = property?.city ?? "";
  const phoneText = formatPhone(candidate.phone_e164 ?? candidate.phone_raw);

  // Auto-scroll focused row into view when keyboard navigating
  useEffect(() => {
    if (isFocused && liRef.current) {
      liRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isFocused]);

  return (
    <li ref={liRef} className={`pr-list-item${isFocused ? " pr-list-item--focused" : ""}`}>
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(candidate.id)}
        className="pr-list-item__check"
        onClick={(e) => e.stopPropagation()}
        aria-label={name}
      />
      <button
        id={`pr-row-${candidate.id}`}
        type="button"
        onClick={(e) => { onSelect(candidate.id); (e.currentTarget as HTMLButtonElement).blur(); }}
        className="pr-list-item__row"
        aria-pressed={isFocused}
      >
        <div className="pr-list-item__main">
          <div className="pr-list-item__name">{name}</div>
          <div className="pr-list-item__address">
            {address}{city ? `, ${city}` : ""}
          </div>
          <div className="pr-list-item__phone" style={{ fontFeatureSettings: '"tnum" 1' }}>
            {phoneText}
          </div>
          {/* AI one-liner summary — visible right on the row */}
          <div className="pr-list-item__summary">
            {summary ?? <span className="pr-list-item__summary--loading">…</span>}
          </div>
        </div>
        <div className="pr-list-item__pills">
          <span className={`so-confidence-badge so-confidence-badge--${confidenceVariant(candidate.initial_confidence)}`}>
            {candidate.initial_confidence}%
          </span>
          <StagePill stage={candidate.stage} sourceLabel={candidate.source_label} />
        </div>
      </button>

      {/* Inline quick-action buttons — always visible, no panel needed.
          onMouseDown+preventDefault keeps keyboard focus on the page body
          so Enter/Space shortcuts work immediately after clicking. */}
      <div className="pr-list-item__actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="pr-list-item__approve"
          title={t.review.approveTitle}
          onMouseDown={(e) => { e.preventDefault(); onQuickAction(candidate.id, "approve"); }}
          aria-label={t.review.approveAria}
        >
          ✓
        </button>
        <button
          type="button"
          className="pr-list-item__reject"
          title={t.review.rejectTitle}
          onMouseDown={(e) => { e.preventDefault(); onQuickAction(candidate.id, "reject"); }}
          aria-label={t.review.rejectAria}
        >
          ✕
        </button>
      </div>
    </li>
  );
}

function StagePill({ stage, sourceLabel }: { stage: string; sourceLabel?: string | null }) {
  const { t } = useLocale();
  const ev = t.review.evidence;
  const labels: Record<string, string> = {
    address_search: ev.stageAddress,
    company_search: ev.stageCompany,
    req_address_lookup: "Lien REQ",
    name_postal_directory: "Nom + postal",
    reverse_address_lookup: "Adresse inverse",
    pages_jaunes_business: "Pages Jaunes",
    company_website: "Site entreprise",
    req_phone: "Lien REQ",
    openclaw:       "OpenClaw legacy",
  };
  const key = sourceLabel || stage;
  const variant: string =
    key === "address_search" || key === "req_address_lookup" || key === "reverse_address_lookup" ? "address"
    : key === "company_search" || key === "company_website" || key === "pages_jaunes_business" || key === "req_phone" ? "company"
    : key === "openclaw" ? "openclaw"
    : "via";
  return (
    <span className={`crm-pill crm-pill-stage--${variant}`}>{labels[key] ?? labels[stage] ?? key}</span>
  );
}
