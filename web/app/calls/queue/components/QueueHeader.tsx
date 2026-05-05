"use client";
import type { Dict } from "@/lib/i18n";

type Props = {
  eyebrow: string;
  t: Dict;
};

export default function QueueHeader({ eyebrow, t }: Props) {
  return (
    <div className="queue-header">
      <div className="queue-header__left">
        <p className="queue-header__eyebrow">{eyebrow}</p>
        <h1 className="queue-header__title">{t.queue.title}</h1>
      </div>
      <div className="queue-header__actions">
        <button type="button" className="so-btn so-btn-outline" aria-label={t.queue.filterBtn}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ marginRight: 6 }}>
            <path d="M2 4h12M5 8h6M7 12h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          {t.queue.filterBtn}
        </button>
        <button
          type="button"
          className="so-btn so-btn-primary"
          disabled
          title="Bientôt disponible"
          aria-label={t.queue.start}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ marginRight: 6 }}>
            <path d="M5 3l8 5-8 5V3z" fill="currentColor"/>
          </svg>
          {t.queue.start}
        </button>
      </div>
    </div>
  );
}
