"use client";
// LeadBriefingCard — displays the AI-generated French briefing for a lead.
//
// Style follows the established panel pattern from PhoneReviewEvidencePanel:
// --so-bg-2 background, --so-accent left border, crm-card border radius.
// Emoji used as plain text label (no design-system emoji restriction found in
// codebase; all other components use emoji freely, e.g. 🔥 in QueueLeadList).

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
    <div
      style={{
        background: "var(--so-bg-2, #fafaf7)",
        border: "1px solid var(--crm-card-border, #E8E3DA)",
        borderLeft: "4px solid var(--so-accent, var(--crm-gold, #C9A84C))",
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 16,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 15 }}>📋</span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--crm-text, #1A1A1A)",
              letterSpacing: "-0.1px",
            }}
          >
            Briefing
          </span>
          {generatedAt && (
            <span
              style={{
                fontSize: 11,
                color: "var(--crm-text3, #A0A0A0)",
                fontStyle: "italic",
              }}
            >
              — Mis à jour {relativeTime(generatedAt)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleRegen}
          disabled={loading}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--crm-gold-border, #E9D9AA)",
            background: loading
              ? "var(--crm-bg-alt, #F5F2ED)"
              : "var(--crm-gold-light, #F5EDD6)",
            color: "var(--crm-amber, #B7791F)",
            cursor: loading ? "not-allowed" : "pointer",
            transition: "background 0.15s",
            whiteSpace: "nowrap",
          }}
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
        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.65,
            color: "var(--crm-text, #1A1A1A)",
            whiteSpace: "pre-wrap",
          }}
        >
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
