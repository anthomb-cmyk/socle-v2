"use client";
import type { AugmentedLead } from "../QueueLeadList";
import type { Dict } from "@/lib/i18n";

type Props = {
  item: AugmentedLead;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  t: Dict;
};

function initials(name: string | null, company: string | null): string {
  const src = name ?? company ?? "?";
  const parts = src.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function outcomeVariant(status: string): "success" | "info" | "warn" | "danger" | "neutral" {
  if (status === "phone_verified") return "success";
  if (status === "in_outreach") return "info";
  if (status === "do_not_contact") return "danger";
  if (status === "no_answer") return "neutral";
  return "neutral";
}

export default function QueueRow({ item, selected, onSelect, onOpen, t }: Props) {
  const { lead, formattedPhone, overdueLabel, callCount } = item;
  const isHot = (lead.priority ?? 0) >= 80;
  const statusLabel = t.status[lead.status] ?? lead.status;
  const variant = outcomeVariant(lead.status);

  return (
    <li
      className={`queue-row${selected ? " queue-row--selected" : ""}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(e: { key: string }) => {
        if (e.key === "Enter") onOpen();
      }}
      role="row"
      aria-selected={selected}
      tabIndex={-1}
    >
      {/* Col 1: Owner */}
      <div className="queue-row__owner">
        <span className="queue-row__avatar" aria-hidden="true">
          {initials(lead.full_name, lead.company_name)}
        </span>
        <div className="queue-row__owner-info">
          <div className="queue-row__name">
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {lead.full_name ?? lead.company_name ?? "—"}
            </span>
            {isHot && <span className="queue-row__priority-dot" aria-label="Priorité haute" />}
          </div>
          <div className="queue-row__address">
            {lead.address}
            {lead.city ? `, ${lead.city}` : ""}
          </div>
        </div>
      </div>

      {/* Col 2: Campaign */}
      <div className="queue-row__campaign">{lead.campaign_name ?? "—"}</div>

      {/* Col 3: Units */}
      <div className="queue-row__units">{lead.num_units ?? "—"}</div>

      {/* Col 4: Phone */}
      <div className={`queue-row__phone${!formattedPhone ? " queue-row__phone--missing" : ""}`}>
        {formattedPhone ?? t.queue.phoneBad}
      </div>

      {/* Col 5: Outcome / status */}
      <div className="queue-row__outcome">
        {overdueLabel && (
          <span className="queue-overdue-badge" title={overdueLabel}>↻</span>
        )}
        {callCount === 0 ? (
          <span className={`queue-outcome queue-outcome--${lead.status === "phone_verified" ? "success" : "neutral"}`}>
            {lead.status === "phone_verified" ? t.queue.phoneVerified : t.queue.phoneNew}
          </span>
        ) : (
          <span className={`queue-outcome queue-outcome--${variant}`}>{statusLabel}</span>
        )}
      </div>
    </li>
  );
}
