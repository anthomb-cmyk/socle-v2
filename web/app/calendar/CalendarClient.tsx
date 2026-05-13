"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CalendarFollowUp, CalendarGoogleEvent } from "./page";

type CalendarItem = {
  id: string;
  kind: "follow-up" | "google";
  title: string;
  startsAt: string;
  detail: string | null;
  href: string | null;
  tone: "red" | "gold" | "green" | "neutral";
  followUp?: CalendarFollowUp;
  google?: CalendarGoogleEvent;
};

const MONTH_NAMES_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];
const DAY_NAMES_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export default function CalendarClient({
  followUps,
  googleEvents,
  googleConnected,
  googleError,
}: {
  followUps: CalendarFollowUp[];
  googleEvents: CalendarGoogleEvent[];
  googleConnected: boolean;
  googleError: string | null;
}) {
  const [current, setCurrent] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => buildItems(followUps, googleEvents, dismissed), [followUps, googleEvents, dismissed]);
  const byDate = useMemo(() => groupItems(items), [items]);
  const selectedItems = byDate[selectedDay] ?? [];
  const overdue = followUps.filter((item) => !dismissed.has(item.id) && new Date(item.due_at) < startOfToday());
  const todayItems = byDate[todayKey()] ?? [];
  const synced = followUps.filter((item) => item.sync_status === "synced" || item.gcal_event_id).length;

  async function complete(id: string) {
    setBusyId(id);
    setError(null);
    const response = await fetch(`/api/follow-ups/${id}/complete`, { method: "POST" });
    const json = await response.json();
    setBusyId(null);
    if (!json.ok) {
      setError(json.error ?? "Impossible de compléter le suivi.");
      return;
    }
    setDismissed((prev) => new Set([...prev, id]));
  }

  return (
    <div className="cal-shell">
      <section className="cal-summary" aria-label="Résumé calendrier">
        <SummaryTile label="Aujourd'hui" value={todayItems.length} />
        <SummaryTile label="En retard" value={overdue.length} tone={overdue.length > 0 ? "red" : undefined} />
        <SummaryTile label="Sync Google" value={`${synced}/${followUps.length}`} />
        <SummaryTile label="Événements Gmail" value={googleEvents.length} />
      </section>

      <section className="cal-google-card">
        <div>
          <div className="cal-google-card__label">Connexion Google Calendar</div>
          <p>
            {googleConnected
              ? googleError
                ? `Connecté, mais lecture impossible: ${googleError}`
                : "Connecté. Les événements Google Calendar apparaissent dans la grille avec les suivis CRM."
              : "Non connecté pour cette session. Reconnecte-toi avec Google pour afficher ton calendrier Gmail ici."}
          </p>
        </div>
        <Link href="/login?next=%2Fcalendar" className="btn">{googleConnected ? "Reconnecter" : "Connecter Google"}</Link>
      </section>

      {error && <div className="cal-error">{error}</div>}

      <div className="cal-layout">
        <section className="cal-board" aria-label="Calendrier mensuel">
          <div className="cal-toolbar">
            <button type="button" onClick={() => setCurrent(new Date(current.getFullYear(), current.getMonth() - 1, 1))} aria-label="Mois précédent">‹</button>
            <h2>{MONTH_NAMES_FR[current.getMonth()]} {current.getFullYear()}</h2>
            <button type="button" onClick={() => setCurrent(new Date(current.getFullYear(), current.getMonth() + 1, 1))} aria-label="Mois suivant">›</button>
          </div>

          <div className="cal-grid">
            {DAY_NAMES_FR.map((day) => <div key={day} className="cal-dow">{day}</div>)}
            {monthCells(current).map((dateKey, index) => {
              const dayItems = dateKey ? byDate[dateKey] ?? [] : [];
              const isTodayCell = dateKey === todayKey();
              const isSelected = dateKey === selectedDay;
              return (
                <button
                  key={`${dateKey ?? "blank"}-${index}`}
                  type="button"
                  className={`cal-cell${dateKey ? "" : " cal-cell--blank"}${isTodayCell ? " cal-cell--today" : ""}${isSelected ? " cal-cell--selected" : ""}`}
                  disabled={!dateKey}
                  onClick={() => dateKey && setSelectedDay(dateKey)}
                >
                  {dateKey && (
                    <>
                      <span className="cal-cell__day">{Number(dateKey.slice(8))}</span>
                      <span className="cal-cell__events">
                        {dayItems.slice(0, 3).map((item) => (
                          <span key={item.id} className={`cal-chip cal-chip--${item.tone}`}>
                            {timeLabel(item.startsAt)} · {item.title}
                          </span>
                        ))}
                        {dayItems.length > 3 && <span className="cal-more">+{dayItems.length - 3}</span>}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="cal-day-panel" aria-label="Détails du jour sélectionné">
          <div className="cal-day-panel__head">
            <div>
              <div className="cal-day-panel__label">{selectedDay === todayKey() ? "Aujourd'hui" : "Journée"}</div>
              <h2>{dateHeader(selectedDay)}</h2>
            </div>
            <span>{selectedItems.length}</span>
          </div>

          {selectedItems.length === 0 ? (
            <div className="cal-empty">Aucun événement.</div>
          ) : (
            <div className="cal-agenda">
              {selectedItems.map((item) => (
                <article key={item.id} className={`cal-agenda-item cal-agenda-item--${item.tone}`}>
                  <time>{timeLabel(item.startsAt)}</time>
                  <div>
                    <h3>{item.title}</h3>
                    {item.detail && <p>{item.detail}</p>}
                    <div className="cal-agenda-item__actions">
                      {item.href && item.kind === "follow-up" && <Link href={item.href as never}>Ouvrir lead</Link>}
                      {item.href && item.kind === "google" && <a href={item.href} target="_blank" rel="noopener noreferrer">Ouvrir Google</a>}
                      {item.followUp?.lead?.best_phone && <a href={`tel:${item.followUp.lead.best_phone.replace(/\D/g, "")}`}>Appeler</a>}
                      {item.followUp && (
                        <button type="button" disabled={busyId === item.followUp.id} onClick={() => complete(item.followUp!.id)}>
                          {busyId === item.followUp.id ? "..." : "Fait"}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number | string; tone?: "red" }) {
  return (
    <div className={`cal-summary-tile${tone ? ` cal-summary-tile--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildItems(followUps: CalendarFollowUp[], googleEvents: CalendarGoogleEvent[], dismissed: Set<string>): CalendarItem[] {
  const followUpItems: CalendarItem[] = followUps
    .filter((followUp) => !dismissed.has(followUp.id))
    .map((followUp) => {
      const owner = followUp.lead?.full_name ?? followUp.lead?.company_name ?? "Suivi";
      const past = new Date(followUp.due_at) < startOfToday();
      return {
        id: `fu-${followUp.id}`,
        kind: "follow-up",
        title: owner,
        startsAt: followUp.due_at,
        detail: [followUp.note, followUp.lead?.address].filter(Boolean).join(" · ") || null,
        href: followUp.lead_id ? `/leads/${followUp.lead_id}` : null,
        tone: past ? "red" : followUp.priority >= 70 ? "gold" : "green",
        followUp,
      };
    });

  const googleItems: CalendarItem[] = googleEvents.map((event) => ({
    id: `gcal-${event.id}`,
    kind: "google",
    title: event.title,
    startsAt: event.starts_at,
    detail: event.location,
    href: event.html_link,
    tone: "neutral",
    google: event,
  }));

  return [...followUpItems, ...googleItems].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

function groupItems(items: CalendarItem[]) {
  const grouped: Record<string, CalendarItem[]> = {};
  for (const item of items) {
    const key = item.startsAt.slice(0, 10);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }
  return grouped;
}

function monthCells(current: Date) {
  const year = current.getFullYear();
  const month = current.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = (firstDay.getDay() + 6) % 7;
  const cells: (string | null)[] = [];
  for (let i = 0; i < startDow; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });
}

function dateHeader(dateKey: string) {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString("fr-CA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
