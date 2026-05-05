"use client";
import type { PhoneCandidate } from "../PhoneReviewClient";

type Props = {
  candidate: PhoneCandidate;
  selected: boolean;       // included in the bulk-selection set
  isFocused: boolean;       // currently shown in the right rail / slide-over
  onToggleSelect: (id: string) => void;
  onSelect: (id: string) => void;
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
 * Phase 5 — compact list row. Pure presentation. Click → onSelect(id)
 * to focus the row in the right-rail evidence panel (or open the mobile
 * slide-over). Checkbox toggles bulk-selection.
 */
export default function PhoneReviewListItem({
  candidate, selected, isFocused, onToggleSelect, onSelect,
}: Props) {
  const contact = candidate.leads?.contacts;
  const property = candidate.leads?.properties;
  const name = contact?.full_name ?? contact?.company_name ?? "—";
  const address = property?.address ?? "—";
  const city = property?.city ?? "";
  const phoneText = formatPhone(candidate.phone_e164 ?? candidate.phone_raw);

  return (
    <li className={`pr-list-item${isFocused ? " pr-list-item--focused" : ""}`}>
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
        onClick={() => onSelect(candidate.id)}
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
        </div>
        <div className="pr-list-item__pills">
          <span className={`so-confidence-badge so-confidence-badge--${confidenceVariant(candidate.initial_confidence)}`}>
            {candidate.initial_confidence}%
          </span>
          <StagePill stage={candidate.stage} />
        </div>
      </button>
    </li>
  );
}

function StagePill({ stage }: { stage: string }) {
  const labels: Record<string, string> = {
    address_search: "Adresse",
    company_search: "Entreprise",
    openclaw:       "OpenClaw",
  };
  const variant: string =
    stage === "address_search" ? "address"
    : stage === "company_search" ? "company"
    : stage === "openclaw" ? "openclaw"
    : "via";
  return (
    <span className={`crm-pill crm-pill-stage--${variant}`}>{labels[stage] ?? stage}</span>
  );
}
