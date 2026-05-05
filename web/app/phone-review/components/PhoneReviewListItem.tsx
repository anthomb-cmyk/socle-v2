"use client";
import type { PhoneCandidate } from "../PhoneReviewClient";

type Props = {
  candidate: PhoneCandidate;
  selected: boolean;
  isFocused: boolean;
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
  candidate, selected, isFocused, onToggleSelect, onSelect, onQuickAction,
}: Props) {
  const contact = candidate.leads?.contacts;
  const property = candidate.leads?.properties;
  const name = contact?.full_name ?? contact?.company_name ?? "—";
  const address = property?.address ?? "—";
  const city = property?.city ?? "";
  const phoneText = formatPhone(candidate.phone_e164 ?? candidate.phone_raw);

  // Show the name found at source so you can compare at a glance
  const foundName = candidate.candidate_name ?? null;
  const foundAddr = candidate.candidate_address ?? null;

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
          {/* What the source found — compare at a glance */}
          {(foundName || foundAddr) && (
            <div className="pr-list-item__found">
              {foundName && <span className="pr-list-item__found-name">→ {foundName}</span>}
              {foundAddr && <span className="pr-list-item__found-addr">{foundAddr}</span>}
            </div>
          )}
        </div>
        <div className="pr-list-item__pills">
          <span className={`so-confidence-badge so-confidence-badge--${confidenceVariant(candidate.initial_confidence)}`}>
            {candidate.initial_confidence}%
          </span>
          <StagePill stage={candidate.stage} />
        </div>
      </button>

      {/* Inline quick-action buttons — always visible, no panel needed */}
      <div className="pr-list-item__actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="pr-list-item__approve"
          title="Approuver"
          onClick={() => onQuickAction(candidate.id, "approve")}
          aria-label="Approuver"
        >
          ✓
        </button>
        <button
          type="button"
          className="pr-list-item__reject"
          title="Rejeter"
          onClick={() => onQuickAction(candidate.id, "reject")}
          aria-label="Rejeter"
        >
          ✕
        </button>
      </div>
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
