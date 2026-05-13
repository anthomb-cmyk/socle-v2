"use client";
import type React from "react";
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

function railClass(priority: number | null, status: string): string {
  if (status === "do_not_contact") return "rail-done";
  if ((priority ?? 0) >= 80) return "rail-hot";
  if ((priority ?? 0) >= 50 || status === "in_outreach") return "rail-warm";
  if (status === "phone_verified") return "rail-cold";
  return "rail-normal";
}

function pillClass(status: string, isHot: boolean): string {
  if (isHot) return "pill--hot";
  if (status === "phone_verified" || status === "ready_to_call") return "pill--ready";
  if (status === "in_outreach") return "pill--review";
  return "pill--cold";
}

export default function QueueRow({ item, selected, onSelect, onOpen, t }: Props) {
  const { lead, formattedPhone, overdueLabel, callCount } = item;
  const isHot = (lead.priority ?? 0) >= 80;
  const statusLabel = t.status[lead.status] ?? lead.status;
  const variant = outcomeVariant(lead.status);

  return (
    <li
      className={`queue-row ${railClass(lead.priority, lead.status)}${selected ? " queue-row--selected" : ""}`}
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
          <span className="queue-overdue-badge" title={overdueLabel}><Icon name="refresh" /></span>
        )}
        {callCount === 0 ? (
          <span className={`pill ${pillClass(lead.status, isHot)}`}>
            <span className="pill__dot" />
            {lead.status === "phone_verified" ? t.queue.phoneVerified : t.queue.phoneNew}
          </span>
        ) : (
          <span className={`pill ${pillClass(lead.status, isHot)}`} data-variant={variant}><span className="pill__dot" />{statusLabel}</span>
        )}
      </div>
    </li>
  );
}

function Icon({ name, size = 13 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    refresh: <path d="M20 6v5h-5M4 18v-5h5M18.5 9A7 7 0 0 0 6.6 6.6L4 9m2 6a7 7 0 0 0 11.4 2.4L20 15" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
