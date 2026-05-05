"use client";
import * as React from "react";
import Link from "next/link";
import { useLocale } from "@/components/locale-provider";

export type FollowUp = {
  id: string;
  lead_id: string | null;
  due_at: string;
  note: string;
  priority: number;
  status: string;
  source: string | null;
  lead: {
    full_name: string | null;
    company_name: string | null;
    address: string;
    city: string | null;
    best_phone: string | null;
  } | null;
};

type Props = {
  f: FollowUp;
  bucket: "overdue" | "today" | "upcoming";
  busy: boolean;
  onComplete: () => void;
  onCancel: () => void;
};

/**
 * Phase 7 — single follow-up card. Pure presentation. The bucket variant
 * controls the left accent rail; complete/cancel callbacks fire the
 * existing FollowUpsList handlers (bodies byte-identical) which hit
 * /api/follow-ups/{id}/complete and DELETE /api/follow-ups/{id}.
 *
 * Phase 8.1: all display strings now routed through useLocale().t.
 *
 * Existing 📅 emoji marker is preserved verbatim — directive tolerates
 * pre-existing emojis but forbids adding new ones.
 */
export default function FollowUpCard({ f, bucket, busy, onComplete, onCancel }: Props) {
  const { t, locale } = useLocale();
  const owner = f.lead?.full_name ?? f.lead?.company_name ?? "—";
  const priorityClass =
    f.priority >= 80 ? "fu-card__priority-dot--hot"
    : f.priority >= 50 ? "fu-card__priority-dot--warm"
    : "fu-card__priority-dot--low";

  function fmtDue(iso: string): string {
    return new Date(iso).toLocaleString(locale === "fr" ? "fr-CA" : "en-CA", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <li className={`fu-card fu-card--${bucket}`}>
      <div className="fu-card__main">
        <div className="fu-card__head">
          <span className="fu-card__name">{owner}</span>
          {f.lead?.city && <span className="fu-card__city">{f.lead.city}</span>}
          <span
            className={`fu-card__priority-dot ${priorityClass}`}
            title={t.followUps.priorityAria(f.priority)}
            aria-hidden="true"
          />
        </div>
        {f.note && <p className="fu-card__note">{f.note}</p>}
        <div className="fu-card__meta">
          <span className="fu-card__due" style={{ fontFeatureSettings: '"tnum" 1' }}>
            📅 {fmtDue(f.due_at)}
          </span>
          {f.lead?.best_phone && (
            <a
              href={`tel:${f.lead.best_phone.replace(/\D/g, "")}`}
              className="crm-phone-link"
              style={{ fontSize: 12 }}
            >
              {f.lead.best_phone}
            </a>
          )}
          {f.source && <span className="fu-card__source">via {f.source}</span>}
          {f.lead_id && (
            <>
              <Link href={`/calls/${f.lead_id}` as never} className="fu-card__open-call">
                {t.workspace.call}
              </Link>
              <Link href={`/leads/${f.lead_id}` as never} className="crm-open-lead-link">
                {t.followUps.viewLead}
              </Link>
            </>
          )}
        </div>
      </div>
      <div className="fu-card__actions">
        <button
          type="button"
          onClick={onComplete}
          disabled={busy}
          className="fu-card__btn fu-card__btn--complete"
        >
          {busy ? "…" : t.followUps.done}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="fu-card__btn fu-card__btn--cancel"
        >
          {t.followUps.cancel}
        </button>
      </div>
    </li>
  );
}
