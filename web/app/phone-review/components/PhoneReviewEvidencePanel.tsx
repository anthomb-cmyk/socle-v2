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

type EvidenceDict = {
  mailingAddress: string;
  city: string;
  postalPrefix: string;
  contactName: string;
  companyName: string;
  relatedEntity: string;
  fetchedPage: string;
  directory: (domain: string) => string;
  [key: string]: string | ((domain: string) => string);
};

function evidenceLabel(token: string, ev: EvidenceDict): string {
  const t = token.trim();
  if (t === "mailing_address") return ev.mailingAddress;
  if (t === "city")            return ev.city;
  if (t === "postal_prefix")   return ev.postalPrefix;
  if (t === "contact_name")    return ev.contactName;
  if (t === "company_name")    return ev.companyName;
  if (t === "related_entity")  return ev.relatedEntity;
  if (t === "fetched_page")    return ev.fetchedPage;
  if (t.startsWith("public_directory:")) {
    let domain = t.slice("public_directory:".length);
    if (domain.length > 22) domain = domain.slice(0, 20) + "…";
    return (ev.directory as (d: string) => string)(domain);
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
 *
 * B-2: all hardcoded FR-only strings routed through t.review.evidence.
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

  const ev = t.review.evidence;

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
            {ev.mailingPrefix} {contact.mailing_address}
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
            <div><strong>{ev.nameFound} </strong>{candidate.candidate_name}</div>
          )}
          {candidate.candidate_address && (
            <div><strong>{ev.sourceAddress} </strong>{candidate.candidate_address}</div>
          )}
          {candidate.search_query && (
            <div className="pr-evidence__query">{ev.query} {candidate.search_query}</div>
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
              {snippetExpanded ? ev.showLess : ev.showMore}
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

      {/* Review reason — shown prominently so you know why it needs review */}
      {candidate.review_reason && (
        <div className="pr-evidence__reason">{candidate.review_reason}</div>
      )}

      {/* OpenClaw analysis — always expanded so reasoning is immediately visible */}
      {(candidate.openclaw_reasoning || candidate.openclaw_evidence) && (
        <details className="pr-evidence__openclaw" open>
          <summary className="pr-evidence__openclaw-summary">
            {t.review.openClawAnalysis}
            {candidate.openclaw_confidence != null && (
              <span className={`so-confidence-badge so-confidence-badge--${confidenceVariant(candidate.openclaw_confidence)}`} style={{ marginLeft: 8 }}>
                {candidate.openclaw_confidence}%
              </span>
            )}
            {candidate.openclaw_verdict && (
              <VerdictBadge verdict={candidate.openclaw_verdict} />
            )}
          </summary>
          <div className="pr-evidence__openclaw-body">
            {candidate.openclaw_evidence && (
              <div className="pr-evidence__openclaw-evidence">{candidate.openclaw_evidence}</div>
            )}
            {candidate.openclaw_reasoning && (
              <div className="pr-evidence__openclaw-reasoning" style={{ whiteSpace: "pre-wrap" }}>{candidate.openclaw_reasoning}</div>
            )}
          </div>
        </details>
      )}

      {/* Fallback: no OpenClaw data at all */}
      {!candidate.openclaw_reasoning && !candidate.openclaw_evidence && (
        <div className="pr-evidence__reason" style={{ color: "var(--so-fg-4)" }}>
          Aucune analyse OpenClaw disponible pour ce candidat.
        </div>
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
  const { t } = useLocale();
  const ev = t.review.evidence;

  if (!matchedOn) return null;
  const tokens = matchedOn.split(";").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  const chips: Array<{ label: string; variant: "high" | "mid" | "warning" }> = tokens.map((t) => {
    const base = t.startsWith("public_directory:") ? "public_directory" : t;
    return { label: evidenceLabel(t, ev as EvidenceDict), variant: HIGH_TRUST.has(base) ? "high" : "mid" };
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
          {ev.tenantWarning}
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
  const { t } = useLocale();
  const ev = t.review.evidence;
  const labels: Record<string, string> = {
    address_search: ev.stageAddress,
    company_search: ev.stageCompany,
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
  const { t } = useLocale();
  const ev = t.review.evidence;

  if (!matchedOn) return null;
  const labels: Record<string, string> = {
    mailing_address:      ev.matchedMailingAddress,
    mailing_postal:       ev.matchedPostal,
    address_company:      ev.matchedAddressCompany,
    property_address:     ev.matchedPropertyAddress,
    company_name:         ev.matchedCompanyName,
    director_name:        ev.matchedDirectorName,
    related_company:      ev.matchedRelatedCompany,
    same_address_company: ev.matchedSameAddress,
    public_directory:     ev.matchedPublicDirectory,
    company_website:      ev.matchedCompanyWebsite,
    public_b2bhint_page:  ev.matchedB2BHint,
    openclaw:             "OpenClaw",
  };
  return (
    <span className="crm-pill crm-pill-via">via {labels[matchedOn] ?? matchedOn}</span>
  );
}
