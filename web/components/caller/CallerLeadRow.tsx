"use client";
import Link from "next/link";
import { useLocale } from "@/components/locale-provider";
import type { QueueLead } from "@/app/calls/queue/QueueLeadList";

type Props = {
  lead: QueueLead;
  callCount: number;
  /** Pretty-formatted phone, or null when missing. */
  formattedPhone: string | null;
  /** Pre-built overdue label (e.g. "Rappel en retard — 2j"), or null. */
  overdueLabel: string | null;
  /** Pre-built time-ago for last contact, or null. */
  lastContactedAgo: string | null;
};

/**
 * Desktop tabular row for the call queue. Visible at >=768px.
 * The whole row is a Link to /calls/[leadId]; the phone tel: link
 * sits inside and uses stopPropagation so tapping the number dials
 * directly without navigating to the workspace first.
 */
export default function CallerLeadRow({
  lead, callCount, formattedPhone, overdueLabel, lastContactedAgo,
}: Props) {
  const { t } = useLocale();
  const status = t.status[lead.status] ?? lead.status;
  const railClass = priorityRailClass(lead.priority, !!overdueLabel);

  return (
    <li>
      <Link
        href={`/calls/${lead.lead_id}` as never}
        className={`so-queue-row so-priority-rail ${railClass}`}
      >
        <div className="so-queue-row__main">
          <div className="so-queue-row__name">
            {lead.full_name ?? lead.company_name ?? "—"}
          </div>
          <div className="so-queue-row__address">
            {lead.address}
            {lead.city ? `, ${lead.city}` : ""}
          </div>
          <div className="so-queue-row__meta">
            {lead.num_units != null && (
              <span className="so-icon-chip">{lead.num_units} log.</span>
            )}
            {lead.campaign_name && <span>{lead.campaign_name}</span>}
            {callCount > 0 && (
              <span>· {callCount} appel{callCount !== 1 ? "s" : ""}</span>
            )}
            {lastContactedAgo && <span>· {lastContactedAgo}</span>}
            {overdueLabel && (
              <span className="so-badge so-badge--info">{overdueLabel}</span>
            )}
          </div>
        </div>
        <div className="so-queue-row__phone">
          {formattedPhone && lead.best_phone ? (
            <a
              href={`tel:${lead.best_phone}`}
              onClick={(e) => e.stopPropagation()}
              className="crm-queue-phone-link"
            >
              {formattedPhone}
            </a>
          ) : (
            <span className="crm-no-phone">sans tél.</span>
          )}
        </div>
        <div className="so-queue-row__status">
          <span className={`crm-pill crm-pill--${pillKey(lead.status)}`}>{status}</span>
        </div>
        <span className="so-queue-row__chevron" aria-hidden="true">→</span>
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
