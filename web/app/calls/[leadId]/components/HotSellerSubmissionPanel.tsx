"use client";
import { useLocale } from "@/components/locale-provider";
import CallerField from "@/components/caller/CallerField";
import CallerSelect from "@/components/caller/CallerSelect";
import CallerInput from "@/components/caller/CallerInput";

export type InterestValue = "cold" | "warm" | "hot" | "wants_offer";
export type TimelineValue = "immediate" | "3_months" | "6_months" | "no_rush" | "unknown";

export type SubmissionValues = {
  interest: InterestValue;
  timeline: TimelineValue;
  motivation: string;
  askingPrice: string;
  callerSummary: string;
};

type Props = {
  outcome: string;
  values: SubmissionValues;
  onChange: <K extends keyof SubmissionValues>(key: K, value: SubmissionValues[K]) => void;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
  onSkip: () => void;
};

/**
 * Phase 4 — Anthony submission form for escalating outcomes.
 * Pure controlled inputs. CallWorkspace.tsx owns all field state and
 * the POST /api/submissions call; this panel only renders the form
 * and forwards user input via callbacks.
 *
 * IMPORTANT: the underlying value enums (cold/warm/hot/wants_offer for
 * interest; immediate/3_months/6_months/no_rush/unknown for timeline)
 * are routing keys for /api/submissions and are NOT renamed here.
 * Display labels come from i18n; the values stay verbatim.
 *
 * `motivation` stays a free-form text input (matches today's API contract).
 * The spec proposed a CallerSelect with predefined motivation options, but
 * changing that would change the value space the API stores; out of scope
 * for a UI-only refactor.
 */
export default function HotSellerSubmissionPanel({
  outcome, values, onChange, submitting, error, onSubmit, onSkip,
}: Props) {
  const { t } = useLocale();
  const outcomeLabel = t.outcome[outcome] ?? outcome;

  return (
    <div className="cw-card cw-submission-panel">
      <div className="cw-submission-panel__head">
        <h3 className="cw-submission-panel__title">{t.workspace.submitTitle}</h3>
        <span className="so-badge so-badge--gold">{outcomeLabel}</span>
      </div>
      <p className="cw-submission-panel__sub">{t.workspace.submitSubtitle(outcomeLabel)}</p>

      <div className="cw-submission-panel__grid">
        <CallerField label={t.workspace.interestLevel}>
          <CallerSelect
            value={values.interest}
            onChange={(e) => onChange("interest", e.target.value as InterestValue)}
            disabled={submitting}
          >
            <option value="cold">{t.workspace.interestLow}</option>
            <option value="warm">{t.workspace.interestMid}</option>
            <option value="hot">{t.workspace.interestHigh}</option>
            <option value="wants_offer">{t.workspace.interestVeryHigh}</option>
          </CallerSelect>
        </CallerField>
        <CallerField label={t.workspace.timeline}>
          <CallerSelect
            value={values.timeline}
            onChange={(e) => onChange("timeline", e.target.value as TimelineValue)}
            disabled={submitting}
          >
            <option value="immediate">{t.workspace.timelineSoon}</option>
            <option value="3_months">{t.workspace.timeline3m}</option>
            <option value="6_months">{t.workspace.timeline6m}</option>
            <option value="no_rush">{t.workspace.timelineLater}</option>
            <option value="unknown">{t.workspace.timelineUnknown}</option>
          </CallerSelect>
        </CallerField>
      </div>

      <CallerField label={t.workspace.motivation}>
        <CallerInput
          value={values.motivation}
          onChange={(e) => onChange("motivation", e.target.value)}
          placeholder={t.workspace.motivationPlaceholder}
          disabled={submitting}
        />
      </CallerField>

      <CallerField label={t.workspace.askingPrice}>
        <CallerInput
          type="number"
          value={values.askingPrice}
          onChange={(e) => onChange("askingPrice", e.target.value)}
          placeholder="e.g. 1600000"
          disabled={submitting}
        />
      </CallerField>

      <CallerField label={t.workspace.summary}>
        <textarea
          value={values.callerSummary}
          onChange={(e) => onChange("callerSummary", e.target.value)}
          rows={4}
          className="crm-notes-textarea crm-input"
          placeholder={t.workspace.summaryPlaceholder}
          disabled={submitting}
        />
      </CallerField>

      {error && <p className="cw-submission-panel__error">{error}</p>}

      <div className="cw-submission-panel__actions">
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="cw-call-btn cw-call-btn--primary cw-submission-panel__submit"
        >
          {submitting ? t.workspace.submitting : t.workspace.submitBtn}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={submitting}
          className="crm-btn"
        >
          {t.workspace.skipSubmission}
        </button>
      </div>
    </div>
  );
}
