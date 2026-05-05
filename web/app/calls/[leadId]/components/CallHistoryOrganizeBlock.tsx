"use client";
import { useState } from "react";
import { useLocale } from "@/components/locale-provider";

type OrganizedNotes = {
  seller_name?: string | null;
  intent_level?: string | null;
  asking_price?: number | null;
  objections?: string[];
  next_steps?: string[];
  summary?: string | null;
};

type Props = {
  callLogId: string;
};

/**
 * Phase 6 — extracted AI Organize block. The fetch call site is
 * byte-identical to the previous OrganizeBlock — POST /api/calls/{id}/organize
 * with no body. Internal state (loading / result / err) stays here, exactly
 * as it was before the extraction.
 */
export default function CallHistoryOrganizeBlock({ callLogId }: Props) {
  const { t, locale } = useLocale();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OrganizedNotes | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function organize() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/calls/${callLogId}/organize`, { method: "POST" });
      const j = await r.json();
      if (!j.ok) { setErr(j.error); return; }
      setResult(j.data);
    } catch {
      setErr(t.history.networkError);
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    const intent = (result.intent_level ?? "cold").replace(/[^a-z_]/gi, "_");
    return (
      <div className="ch-organize">
        <div className="ch-organize__head">
          <span className="ch-organize__title">{t.history.aiAnalysis}</span>
          {result.seller_name && (
            <span className="ch-organize__seller">{result.seller_name}</span>
          )}
          {result.intent_level && (
            <span className={`ch-organize__intent ch-organize__intent--${intent}`}>
              {result.intent_level.replace(/_/g, " ")}
            </span>
          )}
          {result.asking_price && (
            <span className="ch-organize__price" style={{ fontFeatureSettings: '"tnum" 1' }}>
              {new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", {
                style: "currency",
                currency: "CAD",
                maximumFractionDigits: 0,
              }).format(result.asking_price)}
            </span>
          )}
        </div>

        {result.summary && (
          <div className="ch-organize__summary">{result.summary}</div>
        )}

        {result.objections && result.objections.length > 0 && (
          <div className="ch-organize__row">
            <span className="ch-organize__label">{t.history.objections}</span>
            <span className="ch-organize__value">{result.objections.join(" · ")}</span>
          </div>
        )}

        {result.next_steps && result.next_steps.length > 0 && (
          <div className="ch-organize__row">
            <span className="ch-organize__label">{t.history.nextSteps}</span>
            <ul className="ch-organize__list">
              {result.next_steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ch-organize__trigger-row">
      <button
        type="button"
        onClick={organize}
        disabled={loading}
        className="ch-organize__trigger"
      >
        {loading ? t.history.aiAnalyzing : t.history.aiAnalyzeBtn}
      </button>
      {err && <span className="ch-organize__error">{err}</span>}
    </div>
  );
}
