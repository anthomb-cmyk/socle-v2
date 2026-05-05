"use client";
import { useState, useTransition } from "react";
import { useLocale } from "@/components/locale-provider";
import type { PhoneCandidate } from "../PhoneReviewClient";

type Action = "approve" | "reject" | "retry" | "keep_unresolved";

type Props = {
  candidate: PhoneCandidate | null;
  snippetExpanded: boolean;
  errorText: string | null;
  onToggleSnippet: (id: string) => void;
  onAction: (id: string, action: Action, note?: string) => void;
};

const SNIPPET_COLLAPSE_THRESHOLD = 200;

const HIGH_TRUST = new Set([
  "mailing_address", "contact_name", "company_name", "related_entity",
]);

const TENANT_PREFIX_RE =
  /CLINIQUE|CLINIC|PHARMACIE|RESTAURANT|GARAGE|ATELIER|BOUTIQUE|ÉPICERIE|EPICERIE|DÉPANNEUR|DEPANNEUR|COIFFURE|SALON|DENTAIRE|DENTAL|VÉTÉRINAIRE|VETERINAIRE|OPTIQUE|NOTAIRE|COMPTABLE|AVOCAT|HÔTEL|HOTEL|CAFÉ|CAFE|BAR|BANQUE/i;

function evidenceLabel(token: string): string {
  const t = token.trim();
  if (t === "mailing_address") return "Adresse mail. ✓";
  if (t === "city")            return "Ville ✓";
  if (t === "postal_prefix")   return "Code postal ✓";
  if (t === "contact_name")    return "Nom ✓";
  if (t === "company_name")    return "Compagnie ✓";
  if (t === "related_entity")  return "Entité reliée ✓";
  if (t === "fetched_page")    return "Page lue";
  if (t.startsWith("public_directory:")) {
    let domain = t.slice("public_directory:".length);
    if (domain.length > 22) domain = domain.slice(0, 20) + "…";
    return `Annuaire (${domain})`;
  }
  return t;
}

function formatPhone(raw: string | null): string {
  if (!raw) return "—";
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

function confidenceVariant(score: number): "high" | "mid" | "low" {
  if (score >= 80) return "high";
  if (score >= 50) return "mid";
  return "low";
}

/**
 * Phase 5 — full evidence detail. Pure presentation; only cosmetic local
 * state (note input, action-pending transition). The note value flows
 * straight into onAction(id, action, note?), preserving the existing
 * orchestrator handler signatures byte-identical.
 */
export default function PhoneReviewEvidencePanel({
  candidate, snippetExpanded, errorText, onToggleSnippet, onAction,
}: Props) {
  const { t } = useLocale();
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!candidate) {
    return (
      <div className="pr-evidence-empty">
        <div className="pr-evidence-empty__title">{t.review.noSelectionTitle}</div>
        <div className="pr-evidence-empty__sub">{t.review.noSelectionSub}</div>
      </div>
    );
  }

  function act(action: Action) {
    if (!candidate) return;
    const id = candidate.id;
    startTransition(() => onAction(id, action, note || undefined));
  }

  const contact = candidate.leads?.contacts;
  const property = candidate.leads?.properties;
  const name = contact?.full_name ?? contact?.company_name ?? "—";
  const address = property?.address ?? "—";
  const city = property?.city ?? "";

  const snippet = candidate.snippet ?? "";
  const isLong = snippet.length > SNIPPET_COLLAPSE_THRESHOLD;
  const visibleSnippet = isLong && !snippetExpanded
    ? snippet.slice(0, SNIPPET_COLLAPSE_THRESHOLD)
    : snippet;

  return (
    <div className="pr-evidence">
      {/* Header */}
      <div className="pr-evidence__head">
        <div className="pr-evidence__name">{name}</div>
        <div className="pr-evidence__address">
          {address}{city ? `, ${city}` : ""}
          {property?.num_units ? ` · ${property.num_units} log.` : ""}
        </div>
        {contact?.mailing_address && (
          <div className="pr-evidence__mailing">
            Mail : {contact.mailing_address}
            {contact.mailing_city ? `, ${contact.mailing_city}` : ""}
            {contact.mailing_postal ? ` ${contact.mailing_postal}` : ""}
          </div>
        )}
        <div className="pr-evidence__pills">
          <StagePill stage={candidate.stage} />
          <span className={`so-confidence-badge so-confidence-badge--${confidenceVariant(candidate.initial_confidence)}`}>
            {candidate.initial_confidence}%
          </span>
          <MatchedOnPill matchedOn={candidate.matched_on} />
          {candidate.openclaw_verdict && <VerdictBadge verdict={candidate.openclaw_verdict} />}
        </div>
      </div>

      {/* Phone */}
      <div className="pr-evidence__phone">
        <span className="pr-evidence__phone-num" style={{ fontFeatureSettings: '"tnum" 1' }}>
          {formatPhone(candidate.phone_e164 ?? candidate.phone_raw)}
        </span>
        {candidate.phone_e164 && (
          <span className="pr-evidence__phone-e164">{candidate.phone_e164}</span>
        )}
        {candidate.source_label && (
          <span className="pr-evidence__phone-source">{candidate.source_label}</span>
        )}
      </div>

      {/* Evidence chips */}
      <EvidenceChips
        matchedOn={candidate.matched_on}
        snippet={candidate.snippet}
        companyName={contact?.company_name}
      />

      {/* Match context */}
      {(candidate.candidate_name || candidate.candidate_address) && (
        <div className="pr-evidence__context">
          {candidate.candidate_name && (
            <div><strong>Nom trouvé : </strong>{candidate.candidate_name}</div>
          )}
          {candidate.candidate_address && (
            <div><strong>Adresse source : </strong>{candidate.candidate_address}</div>
          )}
          {candidate.search_query && (
            <div className="pr-evidence__query">Requête : {candidate.search_query}</div>
          )}
        </div>
      )}

      {/* Snippet */}
      {snippet && (
        <div className="pr-evidence__snippet">
          {visibleSnippet}
          {isLong && !snippetExpanded && <span style={{ color: "var(--so-fg-5)" }}>…</span>}
          {isLong && (
            <button
              type="button"
              onClick={() => onToggleSnippet(candidate.id)}
              className="crm-link-btn"
              style={{ display: "block", marginTop: 6 }}
            >
              {snippetExpanded ? "[voir moins]" : "[voir plus]"}
            </button>
          )}
        </div>
      )}

      {candidate.source_url && (
        <a
          href={candidate.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="crm-link-btn pr-evidence__url"
        >
          {candidate.source_url}
        </a>
      )}

      {/* OpenClaw analysis */}
      {(candidate.openclaw_reasoning || candidate.openclaw_evidence) && (
        <details className="pr-evidence__openclaw">
          <summary className="pr-evidence__openclaw-summary">
            {t.review.openClawAnalysis}
          </summary>
          <div className="pr-evidence__openclaw-body">
            {candidate.openclaw_confidence != null && (
              <div>{t.review.confidence} <strong>{candidate.openclaw_confidence}%</strong></div>
            )}
            {candidate.openclaw_evidence && <div>{candidate.openclaw_evidence}</div>}
            {candidate.openclaw_reasoning && (
              <div style={{ whiteSpace: "pre-wrap" }}>{candidate.openclaw_reasoning}</div>
            )}
          </div>
        </details>
      )}

      {/* Review reason */}
      {candidate.review_reason && (
        <div className="pr-evidence__reason">{candidate.review_reason}</div>
      )}

      {/* Note + actions */}
      <input
        type="text"
        placeholder={t.review.notePlaceholder}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="crm-input"
        disabled={isPending}
      />

      {errorText && <p className="pr-evidence__error">{errorText}</p>}

      <div className="pr-evidence__actions">
        <button
          type="button"
          onClick={() => act("approve")}
          disabled={isPending}
          className="crm-action-btn crm-action-btn--primary"
        >
          {t.review.approve}
        </button>
        <button
          type="button"
          onClick={() => act("reject")}
          disabled={isPending}
          className="crm-action-btn crm-action-btn--danger"
        >
          {t.review.reject}
        </button>
        <button
          type="button"
          onClick={() => act("retry")}
          disabled={isPending}
          className="crm-action-btn crm-action-btn--ghost"
        >
          {t.review.retryPipeline}
        </button>
        <button
          type="button"
          onClick={() => act("keep_unresolved")}
          disabled={isPending}
          className="crm-action-btn crm-action-btn--ghost"
        >
          {t.review.keepUnresolved}
        </button>
      </div>
    </div>
  );
}

function EvidenceChips({
  matchedOn, snippet, companyName,
}: { matchedOn: string | null; snippet: string | null; companyName: string | null | undefined }) {
  if (!matchedOn) return null;
  const tokens = matchedOn.split(";").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  const chips: Array<{ label: string; variant: "high" | "mid" | "warning" }> = tokens.map((t) => {
    const base = t.startsWith("public_directory:") ? "public_directory" : t;
    return { label: evidenceLabel(t), variant: HIGH_TRUST.has(base) ? "high" : "mid" };
  });
  const snippetHead = (snippet ?? "").slice(0, 80);
  const company = (companyName ?? "").toLowerCase();
  const tenantMatch = TENANT_PREFIX_RE.exec(snippetHead);
  const tenantChip = tenantMatch !== null && !company.includes(tenantMatch[0].toLowerCase());
  return (
    <div className="crm-evidence-row">
      {chips.map((chip, i) => (
        <span key={i} className={`crm-evidence-chip crm-evidence-chip--${chip.variant}`}>
          {chip.label}
        </span>
      ))}
      {tenantChip && (
        <span className="crm-evidence-chip crm-evidence-chip--warning">
          Tenant possible — vérifier
        </span>
      )}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return null;
  const variant: "likely" | "uncertain" | "unlikely" | null =
    verdict === "likely_match" ? "likely"
    : verdict === "uncertain" ? "uncertain"
    : verdict === "unlikely_match" ? "unlikely"
    : null;
  const labels: Record<string, string> = {
    likely_match: "Likely match",
    uncertain: "Uncertain",
    unlikely_match: "Unlikely match",
  };
  return (
    <span className={`crm-pill ${variant ? `crm-pill-verdict--${variant}` : ""}`}>
      OpenClaw: {labels[verdict] ?? verdict}
    </span>
  );
}

function StagePill({ stage }: { stage: string }) {
  const labels: Record<string, string> = {
    address_search: "Adresse",
    company_search: "Entreprise",
    openclaw:       "OpenClaw",
  };
  const variant: string =
    stage === "address_search" ? "address"
    : stage === "company_search" ? "company"
    : stage === "openclaw" ? "openclaw"
    : "via";
  return (
    <span className={`crm-pill crm-pill-stage--${variant}`}>{labels[stage] ?? stage}</span>
  );
}

function MatchedOnPill({ matchedOn }: { matchedOn: string | null }) {
  if (!matchedOn) return null;
  const labels: Record<string, string> = {
    mailing_address:    "adresse postale",
    mailing_postal:     "code postal",
    address_company:    "co. à l'adresse",
    property_address:   "adresse immeuble",
    company_name:       "nom entreprise",
    director_name:      "nom directeur",
    related_company:    "co. liée",
    same_address_company: "co. même adresse",
    public_directory:   "annuaire public",
    company_website:    "site web co.",
    public_b2bhint_page: "B2BHint public",
    openclaw:           "OpenClaw",
  };
  return (
    <span className="crm-pill crm-pill-via">via {labels[matchedOn] ?? matchedOn}</span>
  );
}
