"use client";
import Link from "next/link";
import type { AugmentedLead } from "../QueueLeadList";
import type { Dict } from "@/lib/i18n";

type Props = {
  item: AugmentedLead | null;
  t: Dict;
};

function initials(name: string | null, company: string | null): string {
  const src = name ?? company ?? "?";
  const parts = src.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export default function QueuePreviewCard({ item, t }: Props) {
  if (!item) {
    return (
      <div className="queue-preview">
        <div className="queue-preview__no-selection">{t.queue.empty}</div>
      </div>
    );
  }

  const { lead, formattedPhone, lastContactedAgo, callCount } = item;
  const isHot = (lead.priority ?? 0) >= 80;
  const isVerified = lead.status === "phone_verified";

  return (
    <div className="queue-preview" key={lead.lead_id}>
      {/* Header */}
      <div className="queue-preview__header">
        <span className="queue-preview__avatar" aria-hidden="true">
          {initials(lead.full_name, lead.company_name)}
        </span>
        <div className="queue-preview__name-wrap">
          <p className="queue-preview__name">
            {lead.full_name ?? lead.company_name ?? "—"}
          </p>
          {lead.campaign_name && (
            <p className="queue-preview__campaign">{lead.campaign_name}</p>
          )}
        </div>
        {isHot && (
          <span className="queue-outcome queue-outcome--danger" style={{ flexShrink: 0 }}>
            {t.queue.priorityHot}
          </span>
        )}
      </div>

      <hr className="queue-preview__divider" />

      {/* Immeuble section */}
      <div className="queue-preview__section">
        <p className="queue-preview__section-label">Immeuble</p>
        <p className="queue-preview__address">{lead.address}</p>
        {lead.city && <p className="queue-preview__city">{lead.city}</p>}

        <div className="queue-preview__mini-stats">
          <div className="queue-preview__mini-stat">
            <p className="queue-preview__mini-label">{t.queue.preview.units}</p>
            <p className="queue-preview__mini-value">{lead.num_units ?? "—"}</p>
          </div>
          <div className="queue-preview__mini-stat">
            <p className="queue-preview__mini-label">{t.workspace.attempts(callCount)}</p>
            <p className="queue-preview__mini-value">{callCount}</p>
          </div>
          <div className="queue-preview__mini-stat">
            <p className="queue-preview__mini-label">{t.queue.preview.lastCall}</p>
            <p className="queue-preview__mini-value" style={{ fontSize: 12, lineHeight: 1.3 }}>
              {lastContactedAgo ?? "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Phone CTA */}
      <div className="queue-preview__phone-cta">
        <p className="queue-preview__phone-eyebrow">{t.queue.preview.activeNumber}</p>
        {formattedPhone ? (
          <>
            <p className="queue-preview__phone-num">{formattedPhone}</p>
            <div className="queue-preview__phone-status">
              {isVerified ? (
                <span className="queue-outcome queue-outcome--success">✓ {t.queue.phoneVerified}</span>
              ) : (
                <span className="queue-outcome queue-outcome--neutral">{t.queue.phoneNew}</span>
              )}
            </div>
            <Link
              href={`/calls/${lead.lead_id}` as never}
              className="queue-preview__call-btn"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M5 4h2.5l1 3-1.5 1a7 7 0 003 3l1-1.5 3 1V13a1.5 1.5 0 01-1.5 1.5A12 12 0 013.5 5.5 1.5 1.5 0 015 4z"
                  fill="currentColor"
                />
              </svg>
              {t.queue.preview.call}
            </Link>
          </>
        ) : (
          <p style={{ fontSize: 13, color: "var(--so-danger)", margin: "8px 0 0" }}>
            {t.queue.phoneBad}
          </p>
        )}
      </div>
    </div>
  );
}
