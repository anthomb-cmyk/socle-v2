"use client";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

export type Phone = {
  id: string;
  e164: string;
  display: string | null;
  status: string;
  source: string;
  confidence: number;
};

type Props = {
  phones: Phone[];
  selectedPhoneId: string;
  onSelect: (id: string) => void;
};

/**
 * Phase 4 — multi-phone selector.
 * Renders a button-trigger + popover list. Local state (open/closed) is
 * cosmetic-only and explicitly allowed by the Phase 4 rules. The component
 * never reorders the array it receives — confidence-desc ordering is
 * preserved upstream.
 *
 * If phones.length <= 1, renders nothing (spec: "single-phone: not rendered").
 */
export default function PhoneSelector({ phones, selectedPhoneId, onSelect }: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  if (phones.length <= 1) return null;

  const selected = phones.find((p) => p.id === selectedPhoneId) ?? phones[0];

  return (
    <div className="cw-phone-selector">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="cw-phone-selector__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="cw-phone-selector__trigger-label">
          {labelForPhone(selected)}
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <ul className="cw-phone-selector__list" role="listbox">
          {phones.map((p) => {
            const isSelected = p.id === selectedPhoneId;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onSelect(p.id);
                    setOpen(false);
                  }}
                  className={`cw-phone-selector__option${isSelected ? " cw-phone-selector__option--selected" : ""}`}
                >
                  <span className="cw-phone-selector__option-num" style={{ fontFeatureSettings: '"tnum" 1' }}>
                    {p.display ?? p.e164}
                  </span>
                  <span className="cw-phone-selector__option-source">
                    {p.source}{p.status !== "unverified" ? ` · ${p.status}` : ""}
                  </span>
                  <span className={`so-confidence-badge so-confidence-badge--${confidenceVariant(p.confidence)}`}>
                    {p.confidence}%
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {/* Hidden screen-reader description so the button reads cleanly. */}
      <span className="sr-only">{t.workspace.phoneDialed}</span>
    </div>
  );
}

function labelForPhone(p: Phone): string {
  // "Mobile · 87%" style — kind cue + confidence
  const kind = p.source || "phone";
  return `${kind} · ${p.confidence}%`;
}

function confidenceVariant(score: number): "high" | "mid" | "low" {
  if (score >= 80) return "high";
  if (score >= 50) return "mid";
  return "low";
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="8"
      viewBox="0 0 12 8"
      fill="none"
      aria-hidden="true"
      style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}
    >
      <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
