"use client";
import { useLocale } from "@/components/locale-provider";
import CallerDateTimeInput from "@/components/caller/CallerDateTimeInput";

type Props = {
  /** ISO datetime-local string (yyyy-mm-ddThh:mm), as accepted by the input. */
  value: string;
  onChange: (isoLocal: string) => void;
};

/**
 * Phase 4 — callback scheduler with quick chip presets + datetime input.
 * Pure controlled input. CallWorkspace.tsx owns the value state and
 * does the final ISO conversion in the outcome handler.
 *
 * Chip → preset time mapping (computed at click time relative to "now"):
 *   - "Dans 1h"          → +60 min
 *   - "Cet après-midi"   → today at 14:00 (or +60 min if already past 14:00)
 *   - "Demain matin"     → tomorrow at 09:00
 *   - "Demain après-midi"→ tomorrow at 14:00
 *   - "Personnalisé"     → no chip selected; user picks via datetime input
 *
 * Active chip is determined by exact match against the current `value`,
 * so manual edits via the datetime input deselect the chip automatically.
 */
export default function CallbackScheduler({ value, onChange }: Props) {
  const { t, locale } = useLocale();

  function applyPreset(preset: PresetKey) {
    onChange(toLocalIso(presetTime(preset)));
  }

  const activePreset = matchPreset(value);

  // Pretty-print preview line
  const previewDate = parseLocalIso(value);
  const previewLabel = previewDate
    ? formatPreview(previewDate, locale === "fr" ? "fr-CA" : "en-CA")
    : "";

  return (
    <div className="cw-card cw-callback-scheduler">
      <div className="cw-callback-scheduler__label">{t.workspace.scheduleCallback}</div>

      <div className="cw-callback-scheduler__chips">
        <Chip active={activePreset === "in1h"}  onClick={() => applyPreset("in1h")}  label={t.workspace.callbackPreset1h} />
        <Chip active={activePreset === "thisPm"} onClick={() => applyPreset("thisPm")} label={t.workspace.callbackPresetThisAfternoon} />
        <Chip active={activePreset === "tomAm"}  onClick={() => applyPreset("tomAm")}  label={t.workspace.callbackPresetTomorrowAm} />
        <Chip active={activePreset === "tomPm"}  onClick={() => applyPreset("tomPm")}  label={t.workspace.callbackPresetTomorrowPm} />
        <Chip active={activePreset === null}     onClick={() => { /* keep current value, just hint custom */ }} label={t.workspace.callbackPresetCustom} />
      </div>

      <CallerDateTimeInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />

      {previewLabel && (
        <div className="cw-callback-scheduler__preview">
          {t.workspace.callbackPreview(previewLabel)}
        </div>
      )}
    </div>
  );
}

function Chip({
  active, onClick, label,
}: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cw-callback-chip${active ? " cw-callback-chip--active" : ""}`}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

// ── Preset time math ────────────────────────────────────────────────────────
type PresetKey = "in1h" | "thisPm" | "tomAm" | "tomPm";

function presetTime(p: PresetKey): Date {
  const d = new Date();
  if (p === "in1h") {
    d.setMinutes(d.getMinutes() + 60, 0, 0);
    return d;
  }
  if (p === "thisPm") {
    const target = new Date();
    target.setHours(14, 0, 0, 0);
    if (target.getTime() <= Date.now() + 30 * 60_000) {
      // Already past 13:30 — fall back to "tomorrow afternoon"
      target.setDate(target.getDate() + 1);
    }
    return target;
  }
  if (p === "tomAm") {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  // tomPm
  d.setDate(d.getDate() + 1);
  d.setHours(14, 0, 0, 0);
  return d;
}

function matchPreset(value: string): PresetKey | null {
  if (!value) return null;
  for (const p of ["in1h", "thisPm", "tomAm", "tomPm"] as PresetKey[]) {
    if (value === toLocalIso(presetTime(p))) return p;
  }
  return null;
}

// ── Local-ISO helpers (no timezone shift; matches CallerDateTimeInput format) ─
function toLocalIso(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocalIso(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatPreview(d: Date, loc: string): string {
  return d.toLocaleString(loc, {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
