"use client";

import { useState } from "react";
import Link from "next/link";

export type NextStepBannerKind = "enrich_done" | "review_done" | "queue_empty" | "import_done" | null;

export type ImportDoneCounts = {
  leadsCreated: number;
  leadsUpdated?: number;
  propertiesCreated: number;
  propertiesUpdated?: number;
  contactsCreated: number;
  contactsUpdated?: number;
  phonesCreated: number;
  errorsCount: number;
  campaignName: string | null;
  campaignId: string | null;
};

type Props = {
  kind: NextStepBannerKind;
  counts?: {
    ready: number;
    review: number;
    hotSellers: number;
  };
  importDone?: ImportDoneCounts;
  onEnrichImport?: () => void;
  enrichImportBusy?: boolean;
};

export default function NextStepBanner({ kind, counts, importDone, onEnrichImport, enrichImportBusy }: Props) {
  const [dismissed, setDismissed] = useState(false);

  if (!kind || dismissed) return null;

  const ready = counts?.ready ?? 0;
  const review = counts?.review ?? 0;
  const hotSellers = counts?.hotSellers ?? 0;

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
        border: "1px solid #6ee7b7",
        borderRadius: 14,
        padding: "14px 18px",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        marginBottom: 20,
        boxShadow: "0 1px 4px rgba(16,185,129,0.12)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {kind === "enrich_done" && (
          <>
            <p style={{ margin: "0 0 10px", fontSize: 14, color: "#065f46", fontWeight: 600 }}>
              Enrichissement terminé.{" "}
              <strong style={{ color: "#059669" }}>{ready}</strong> lead{ready !== 1 ? "s" : ""} prêt{ready !== 1 ? "s" : ""} à appeler
              {" · "}
              <strong style={{ color: "#d97706" }}>{review}</strong> candidat{review !== 1 ? "s" : ""} à réviser.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link
                href="/phone-review"
                style={{
                  fontSize: 13, fontWeight: 600, color: "#065f46",
                  background: "#fff", border: "1px solid #6ee7b7",
                  borderRadius: 8, padding: "5px 14px", textDecoration: "none",
                  transition: "background 0.15s",
                }}
              >
                Réviser les candidats →
              </Link>
              <Link
                href="/calls/queue"
                style={{
                  fontSize: 13, fontWeight: 600, color: "#fff",
                  background: "#059669", border: "1px solid #059669",
                  borderRadius: 8, padding: "5px 14px", textDecoration: "none",
                  transition: "background 0.15s",
                }}
              >
                Ouvrir la file d&apos;appels →
              </Link>
            </div>
          </>
        )}

        {kind === "review_done" && (
          <>
            <p style={{ margin: "0 0 10px", fontSize: 14, color: "#065f46", fontWeight: 600 }}>
              Approbation terminée.{" "}
              <strong style={{ color: "#059669" }}>{ready}</strong> lead{ready !== 1 ? "s" : ""} sont maintenant prêt{ready !== 1 ? "s" : ""} à appeler.
            </p>
            <Link
              href="/calls/queue"
              style={{
                fontSize: 13, fontWeight: 600, color: "#fff",
                background: "#059669", border: "1px solid #059669",
                borderRadius: 8, padding: "5px 14px", textDecoration: "none",
              }}
            >
              Ouvrir la file d&apos;appels →
            </Link>
          </>
        )}

        {kind === "queue_empty" && (
          <>
            <p style={{ margin: "0 0 10px", fontSize: 14, color: "#065f46", fontWeight: 600 }}>
              File d&apos;appels vide.{" "}
              <strong style={{ color: "#d97706" }}>{hotSellers}</strong> hot seller{hotSellers !== 1 ? "s" : ""} à réviser.
            </p>
            <Link
              href="/review"
              style={{
                fontSize: 13, fontWeight: 600, color: "#065f46",
                background: "#fff", border: "1px solid #6ee7b7",
                borderRadius: 8, padding: "5px 14px", textDecoration: "none",
              }}
            >
              Réviser hot sellers →
            </Link>
          </>
        )}

        {kind === "import_done" && importDone && (
          <>
            <p style={{ margin: "0 0 4px", fontSize: 14, color: "#065f46", fontWeight: 600 }}>
              Import réussi ·{" "}
              <strong style={{ color: "#059669" }}>{importDone.leadsCreated}</strong>{" "}
              lead{importDone.leadsCreated !== 1 ? "s" : ""} créé{importDone.leadsCreated !== 1 ? "s" : ""}
            </p>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "#047857" }}>
              {importDone.propertiesCreated} propriété{importDone.propertiesCreated !== 1 ? "s" : ""}{" "}
              créée{importDone.propertiesCreated !== 1 ? "s" : ""}
              {importDone.propertiesUpdated ? ` · ${importDone.propertiesUpdated} mise${importDone.propertiesUpdated !== 1 ? "s" : ""} à jour` : ""}
              · {importDone.contactsCreated} contact{importDone.contactsCreated !== 1 ? "s" : ""} créé{importDone.contactsCreated !== 1 ? "s" : ""}{" "}
              {importDone.contactsUpdated ? ` · ${importDone.contactsUpdated} contact${importDone.contactsUpdated !== 1 ? "s" : ""} mis à jour` : ""}
              · {importDone.phonesCreated} téléphone{importDone.phonesCreated !== 1 ? "s" : ""}{" "}
              · {importDone.errorsCount} erreur{importDone.errorsCount !== 1 ? "s" : ""}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {importDone.leadsCreated > 0 && (
                <button
                  onClick={onEnrichImport}
                  disabled={enrichImportBusy}
                  style={{
                    fontSize: 13, fontWeight: 600, color: "#fff",
                    background: enrichImportBusy ? "#9ca3af" : "#059669",
                    border: "1px solid #059669",
                    borderRadius: 8, padding: "5px 14px", cursor: enrichImportBusy ? "not-allowed" : "pointer",
                  }}
                >
                  {enrichImportBusy
                    ? "Lancement…"
                    : `Enrichir les ${importDone.leadsCreated} leads →`}
                </button>
              )}
              <Link
                href={
                  importDone.campaignId
                    ? `/leads?campaign_id=${importDone.campaignId}`
                    : "/leads"
                }
                style={{
                  fontSize: 13, fontWeight: 600, color: "#065f46",
                  background: "#fff", border: "1px solid #6ee7b7",
                  borderRadius: 8, padding: "5px 14px", textDecoration: "none",
                }}
              >
                Voir les leads →
              </Link>
            </div>
          </>
        )}
      </div>

      <button
        onClick={() => setDismissed(true)}
        aria-label="Fermer"
        style={{
          flexShrink: 0,
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 13,
          color: "#6ee7b7",
          fontWeight: 600,
          padding: "2px 4px",
          lineHeight: 1,
          borderRadius: 6,
        }}
      >
        Fermer
      </button>
    </div>
  );
}
