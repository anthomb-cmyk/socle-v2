"use client";
import { useLocale } from "@/components/locale-provider";

type Props = {
  name: string;
  statusKey: string;
  priority: "hot" | "normal" | "low";
  campaign: string | null;
  attempts: number;
};

/**
 * Phase 4 — owner identity card.
 * Pure presentation: receives already-resolved data, renders JSX, no state
 * or side effects. Status pill mapping reuses the existing crm-pill--*
 * taxonomy so colors stay consistent with the rest of the CRM.
 */
export default function OwnerCard({ name, statusKey, priority, campaign, attempts }: Props) {
  const { t } = useLocale();
  const statusLabel = t.status[statusKey] ?? statusKey;
  const pillKey = mapPillKey(statusKey);
  const dotClass =
    priority === "hot"  ? "cw-priority-dot--hot"
    : priority === "low" ? "cw-priority-dot--low"
    : "cw-priority-dot--normal";

  return (
    <div className={`cw-card cw-owner-card${priority === "hot" ? " cw-owner-card--hot" : ""}`}>
      <div className="cw-owner-card__row">
        <span className={`cw-priority-dot ${dotClass}`} aria-hidden="true" />
        <h2 className="cw-owner-card__name">{name}</h2>
        <span className={`crm-pill crm-pill--${pillKey} cw-owner-card__pill`}>{statusLabel}</span>
      </div>
      {(campaign || attempts > 0) && (
        <div className="cw-owner-card__meta">
          {campaign && <span>{campaign}</span>}
          {campaign && attempts > 0 && <span aria-hidden="true">·</span>}
          {attempts > 0 && <span>{t.workspace.attempts(attempts)}</span>}
        </div>
      )}
    </div>
  );
}

function mapPillKey(status: string): string {
  return status === "no_answer"      ? "sans-reponse"
       : status === "in_outreach"    ? "contacte"
       : status === "phone_verified" ? "a-appeler"
       : status === "do_not_contact" ? "dnc"
       : status === "qualified"      ? "qualifie"
       : "nouveau";
}
