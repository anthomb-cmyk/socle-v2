"use client";
import * as React from "react";

export type OutcomeVariant = "neutral" | "info" | "negative" | "danger" | "positive" | "escalating";

export type OutcomeOption = {
  value: string;
  label: string;
  variant: OutcomeVariant;
};

type Props = {
  options: ReadonlyArray<OutcomeOption>;
  onSelect: (value: string) => void;
  disabled?: boolean;
};

export default function OutcomeButtonGroup({ options, onSelect, disabled }: Props) {
  return (
    <div className="crm-outcome-grid">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(o.value)}
          className={`crm-outcome-btn crm-outcome-btn--${o.variant}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
