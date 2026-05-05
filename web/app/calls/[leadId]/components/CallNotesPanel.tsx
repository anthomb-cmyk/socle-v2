"use client";
import { useLocale } from "@/components/locale-provider";

type Props = {
  value: string;
  onChange: (v: string) => void;
};

/**
 * Phase 4 — call notes textarea, stylistically aligned with the new
 * caller card system. Pure controlled input — value lives in
 * CallWorkspace.tsx state.
 */
export default function CallNotesPanel({ value, onChange }: Props) {
  const { t } = useLocale();
  const charCount = value.length;

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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="crm-notes-textarea crm-input cw-notes-panel__textarea"
        placeholder={t.workspace.notesPlaceholder}
      />
    </div>
  );
}
