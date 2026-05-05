"use client";
import Link from "next/link";
import { useLocale } from "@/components/locale-provider";
import type { QueueLead } from "@/app/calls/queue/QueueLeadList";

type Props = {
  lead: QueueLead;
  callCount: number;
  formattedPhone: string | null;
  overdueLabel: string | null;
  lastContactedAgo: string | null;
};

/**
 * Mobile app-list card for the call queue. Visible at <768px.
 * Same data + click target as CallerLeadRow; layout stacked instead of
 * grid. Phone displayed prominently as a tap-to-call link.
 */
export default function CallerLeadCard({
  lead, callCount, formattedPhone, overdueLabel, lastContactedAgo,
}: Props) {
  const { t } = useLocale();
  const status = t.status[lead.status] ?? lead.status;
  const railClass = priorityRailClass(lead.priority, !!overdueLabel);
  const name = lead.full_name ?? lead.company_name ?? "—";

  return (
    <li>
      <Link
        href={`/calls/${lead.lead_id}` as never}
        className={`so-queue-card so-priority-rail ${railClass}`}
      >
        <div className="so-queue-card__head">
          <span className="so-queue-card__name">{name}</span>
          <span className={`crm-pill crm-pill--${pillKey(lead.status)}`}>{status}</span>
        </div>

        <div className="so-queue-card__address">
          {lead.address}
          {lead.city ? `, ${lead.city}` : ""}
        </div>

        <div className="so-queue-card__row">
          {formattedPhone && lead.best_phone ? (
            <a
              href={`tel:${lead.best_phone}`}
              onClick={(e) => e.stopPropagation()}
              className="so-queue-card__phone"
              aria-label={formattedPhone}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
              {formattedPhone}
            </a>
          ) : (
            <span className="so-queue-card__phone-empty">sans tél.</span>
          )}
          {overdueLabel && (
            <span className="so-badge so-badge--info">{overdueLabel}</span>
          )}
        </div>

        <div className="so-queue-card__meta">
          {lead.num_units != null && (
            <span className="so-icon-chip">{lead.num_units} log.</span>
          )}
          {lead.campaign_name && <span>{lead.campaign_name}</span>}
          {callCount > 0 && (
            <span>· {callCount} appel{callCount !== 1 ? "s" : ""}</span>
          )}
          {lastContactedAgo && <span>· {lastContactedAgo}</span>}
        </div>
      </Link>
    </li>
  );
}

function priorityRailClass(p: number | null, isOverdue: boolean): string {
  if (isOverdue) return "so-priority-rail--cold";
  if (p == null) return "so-priority-rail--normal";
  if (p >= 80)   return "so-priority-rail--hot";
  if (p >= 50)   return "so-priority-rail--warm";
  return "so-priority-rail--normal";
}

function pillKey(status: string): string {
  return status === "no_answer"      ? "sans-reponse"
       : status === "in_outreach"    ? "contacte"
       : status === "phone_verified" ? "a-appeler"
       : "nouveau";
}
