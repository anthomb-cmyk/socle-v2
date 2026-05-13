"use client";
// LeadBriefingCard — displays the AI-generated French briefing for a lead.

import { useState } from "react";

type Props = {
  leadId: string;
  initialText: string | null;
  initialGeneratedAt: string | null;
};

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 2) return "à l'instant";
  if (diffMinutes < 60) return `il y a ${diffMinutes} min`;
  if (diffHours < 24) return `il y a ${diffHours}h`;
  if (diffDays === 1) return "hier";
  return `il y a ${diffDays} jours`;
}

export default function LeadBriefingCard({ leadId, initialText, initialGeneratedAt }: Props) {
  const [text, setText] = useState<string | null>(initialText);
  const [generatedAt, setGeneratedAt] = useState<string | null>(initialGeneratedAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegen() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/briefing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate: true }),
      });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error ?? "Erreur inconnue");
      } else {
        setText(j.data.text);
        setGeneratedAt(j.data.generatedAt);
      }
    } catch (err) {
      setError((err as Error).message ?? "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="briefing">
      {/* Header row */}
      <div className="briefing__h" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Icon name="clipboard" />
          <span className="briefing__h__t">
            Briefing
          </span>
          {generatedAt && (
            <span className="briefing__time">
              — Mis à jour {relativeTime(generatedAt)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleRegen}
          disabled={loading}
          className="btn btn--sm"
          style={{ whiteSpace: "nowrap", opacity: loading ? 0.55 : 1 }}
        >
          {loading ? "Génération…" : "Régénérer"}
        </button>
      </div>

      {/* Body */}
      {error && (
        <p
          style={{
            fontSize: 12,
            color: "var(--crm-red, #C0392B)",
            margin: "0 0 8px 0",
          }}
        >
          {error}
        </p>
      )}

      {text ? (
        <p className="briefing__body" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {text}
        </p>
      ) : (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--crm-text3, #A0A0A0)",
            fontStyle: "italic",
          }}
        >
          Aucun briefing disponible — cliquez Régénérer pour en créer un.
        </p>
      )}
    </div>
  );
}

function Icon({ name, size = 15 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    clipboard: <path d="M9 5h6M9 3h6a2 2 0 0 1 2 2h1a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1a2 2 0 0 1 2-2zM9 11h6M9 15h4" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
