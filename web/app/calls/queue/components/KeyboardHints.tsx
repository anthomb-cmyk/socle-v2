"use client";
import type { Dict } from "@/lib/i18n";

type Props = { t: Dict };

export default function KeyboardHints({ t }: Props) {
  return (
    <div className="queue-kbd-strip" aria-hidden="true">
      <span className="queue-kbd-strip__hint">
        <kbd className="queue-kbd">↑↓</kbd>
        {t.queue.kbd.navigate}
      </span>
      <span className="queue-kbd-strip__hint">
        <kbd className="queue-kbd">↵</kbd>
        {t.queue.kbd.open}
      </span>
      <span className="queue-kbd-strip__hint">
        <kbd className="queue-kbd">/</kbd>
        {t.queue.kbd.search}
      </span>
      <span className="queue-kbd-strip__hint">
        <kbd className="queue-kbd">c</kbd>
        {t.queue.kbd.call}
      </span>
      <span className="queue-kbd-strip__hint">
        <kbd className="queue-kbd">s</kbd>
        {t.queue.kbd.hot}
      </span>
    </div>
  );
}
