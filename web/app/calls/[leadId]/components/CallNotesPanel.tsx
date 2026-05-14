"use client";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

type Props = {
  initialValue?: string;
  onChange: (v: string) => void;
};

/**
 * Phase 4 — call notes textarea, stylistically aligned with the new
 * caller card system. Keeps its own local character count so typing notes
 * does not re-render the entire call workspace on every keystroke.
 */
export default function CallNotesPanel({ initialValue = "", onChange }: Props) {
  const { t } = useLocale();
  const [charCount, setCharCount] = useState(initialValue.length);

  return (
    <div className="cw-card cw-notes-panel">
      <div className="cw-notes-panel__head">
        <label htmlFor="cw-notes-textarea" className="cw-notes-panel__label">
          {t.workspace.notesLabel}
        </label>
        {charCount > 0 && (
          <span
            className="cw-notes-panel__count"
            style={{ fontFeatureSettings: '"tnum" 1' }}
          >
            {charCount}
          </span>
        )}
      </div>
      <textarea
        id="cw-notes-textarea"
        defaultValue={initialValue}
        onChange={(e) => {
          const nextValue = e.target.value;
          setCharCount(nextValue.length);
          onChange(nextValue);
        }}
        rows={4}
        className="crm-notes-textarea crm-input cw-notes-panel__textarea"
        placeholder={t.workspace.notesPlaceholder}
      />
    </div>
  );
}
