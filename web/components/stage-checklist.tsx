"use client";
import { useState, useEffect } from "react";

// ── Stage-specific action checklists ─────────────────────────────────────────
// Each item has an id (stable key), label, and optional "blocking" flag
// (items marked blocking = must be done before moving forward).

type CheckItem = { id: string; label: string; blocking?: boolean };

const STAGE_CHECKLISTS: Record<string, { title: string; nextStage: string; items: CheckItem[] }> = {
  new: {
    title: "Avant de passer à « À appeler »",
    nextStage: "ready_to_call",
    items: [
      { id: "check_address",  label: "Adresse et ville vérifiées", blocking: true },
      { id: "check_units",    label: "Nombre d'unités confirmé" },
      { id: "has_phone",      label: "Au moins un numéro de téléphone disponible", blocking: true },
      { id: "check_owner",    label: "Nom du propriétaire connu" },
      { id: "check_dnc",      label: "Propriétaire pas déjà sur liste DNC", blocking: true },
    ],
  },
  ready_to_call: {
    title: "Avant de passer le premier appel",
    nextStage: "in_outreach",
    items: [
      { id: "script_ready",   label: "Script d'appel préparé" },
      { id: "phone_valid",    label: "Numéro principal vérifié / en bon état" },
      { id: "best_time",      label: "Meilleur moment pour appeler identifié" },
      { id: "notes_read",     label: "Notes sur le lead lues" },
    ],
  },
  in_outreach: {
    title: "En cours de contact",
    nextStage: "meeting_set",
    items: [
      { id: "attempts_logged", label: "Toutes les tentatives d'appel enregistrées" },
      { id: "voicemail",       label: "Message vocal laissé (si applicable)" },
      { id: "notes_updated",   label: "Notes mises à jour après chaque appel" },
      { id: "follow_up_set",   label: "Suivi planifié si pas de réponse" },
    ],
  },
  no_answer: {
    title: "Sans réponse — actions suggérées",
    nextStage: "in_outreach",
    items: [
      { id: "try_diff_time",  label: "Essayé à un moment différent de la journée" },
      { id: "try_alt_phone",  label: "Essayé un numéro alternatif si disponible" },
      { id: "left_voicemail", label: "Message vocal laissé" },
      { id: "scheduled_retry", label: "Prochain essai planifié dans le calendrier" },
    ],
  },
  meeting_set: {
    title: "RDV fixé — préparation",
    nextStage: "qualified",
    items: [
      { id: "rdv_confirmed",   label: "Date et heure du RDV confirmées", blocking: true },
      { id: "prop_research",   label: "Recherche sur la propriété faite (évaluation, historique)" },
      { id: "offer_range",     label: "Fourchette de prix préliminaire calculée" },
      { id: "rdv_reminder",    label: "Rappel envoyé au propriétaire" },
      { id: "anthony_briefed", label: "Anthony briefé si c'est lui qui rappelle" },
    ],
  },
  qualified: {
    title: "Lead qualifié — étapes suivantes",
    nextStage: "rejected",
    items: [
      { id: "full_address",    label: "Adresse complète et num. de cadastre notés" },
      { id: "price_discussed", label: "Prix demandé / fourchette acceptée discutée" },
      { id: "motivation_noted", label: "Motivation du vendeur documentée" },
      { id: "timeline_noted",  label: "Échéance souhaitée du vendeur notée" },
      { id: "offer_ready",     label: "Offre d'achat préparée ou en cours", blocking: true },
    ],
  },
  rejected: {
    title: "Lead fermé — documenter avant d'archiver",
    nextStage: "do_not_contact",
    items: [
      { id: "reason_noted",   label: "Raison du refus documentée dans les notes", blocking: true },
      { id: "dnc_checked",    label: "Vérifier si à ajouter à la liste DNC" },
      { id: "reopen_date",    label: "Date de réouverture potentielle notée (si applicable)" },
    ],
  },
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function StageChecklist({ leadId, status }: { leadId: string; status: string }) {
  const config = STAGE_CHECKLISTS[status];

  const storageKey = `checklist_${leadId}_${status}`;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setChecked(new Set(JSON.parse(saved) as string[]));
    } catch { /* ignore */ }
    setLoaded(true);
  }, [storageKey]);

  function toggle(id: string) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  const total = config.items.length;
  const done = config.items.filter(i => checked.has(i.id)).length;
  const pct = Math.round((done / total) * 100);
  const allBlockingDone = config.items.filter(i => i.blocking).every(i => checked.has(i.id));

  if (!config || !loaded) return null;

  return (
    <div style={{
      background: "var(--crm-bg-alt, #F9FAFB)",
      border: "1px solid var(--crm-card-border, #E5E7EB)",
      borderRadius: 10,
      padding: "12px 14px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "var(--crm-text3, #6B7280)" }}>
          ✓ Checklist
        </span>
        <span style={{ fontSize: 11, color: "var(--crm-text3, #6B7280)" }}>{config.title}</span>
        <span style={{
          marginLeft: "auto", fontSize: 11, fontWeight: 700,
          color: pct === 100 ? "#059669" : "#6B7280",
        }}>
          {done}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: "#E5E7EB", borderRadius: 2, marginBottom: 10, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: pct === 100 ? "#059669" : "var(--crm-gold, #C9A84C)",
          borderRadius: 2, transition: "width 0.3s ease",
        }} />
      </div>

      {/* Items */}
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
        {config.items.map(item => {
          const isDone = checked.has(item.id);
          return (
            <li key={item.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => toggle(item.id)}
                style={{
                  width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                  border: `1.5px solid ${isDone ? "#059669" : item.blocking ? "#C9A84C" : "#D1D5DB"}`,
                  background: isDone ? "#059669" : "transparent",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  padding: 0,
                }}
                aria-label={isDone ? "Décocher" : "Cocher"}
              >
                {isDone && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4l2.5 2.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <span style={{
                fontSize: 12,
                color: isDone ? "#9CA3AF" : "#374151",
                textDecoration: isDone ? "line-through" : "none",
                flex: 1,
              }}>
                {item.label}
                {item.blocking && !isDone && (
                  <span style={{ marginLeft: 4, fontSize: 10, color: "#C9A84C", fontWeight: 600 }}>requis</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Completion hint */}
      {pct === 100 && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#059669", fontWeight: 600 }}>
          ✓ Toutes les étapes complètes — prêt à avancer !
        </div>
      )}
      {pct < 100 && !allBlockingDone && (
        <div style={{ marginTop: 10, fontSize: 11, color: "#C9A84C" }}>
          Complète les étapes requises avant de changer de statut.
        </div>
      )}
    </div>
  );
}
