export type ReviewPriority = "priority" | "judgment" | "noisy";

export type PhoneEvidenceSource = {
  key: string;
  label: string;
  kind: "directory" | "business_site" | "web" | "generic_web" | "unknown";
  host: string | null;
  phoneBearing: boolean;
};

export type OwnerLinkSource = {
  key: "req_address" | "req_entity" | "cross_property" | "director" | "none";
  label: string;
};

export type ReviewTrustCandidate = {
  candidate_status?: string | null;
  initial_confidence?: number | string | null;
  source_label?: string | null;
  source_class?: string | null;
  matched_on?: string | null;
  source_url?: string | null;
  snippet?: string | null;
  review_reason?: string | null;
  openclaw_verdict?: string | null;
  openclaw_evidence?: string | null;
  openclaw_reasoning?: string | null;
};

export type ReviewTrustClassification = {
  phoneEvidenceSource: PhoneEvidenceSource;
  ownerLinkSource: OwnerLinkSource;
  reviewPriority: ReviewPriority;
  host: string | null;
  noisyReason: string | null;
  summary: string;
};

export const REVIEWABLE_CANDIDATE_STATUSES = new Set(["needs_anthony_review", "weak_review"]);
export const APPROVED_CANDIDATE_STATUSES = new Set(["approved_by_anthony", "approved_by_codex", "auto_attached"]);
export const REJECTED_CANDIDATE_STATUSES = new Set([
  "rejected_by_openclaw",
  "rejected_by_anthony",
  "rejected_by_codex",
  "pipeline_rejected",
  "quarantined",
]);

const DIRECTORY_HOST_RE = /(canada411|411\.ca|pagesjaunes|yellowpages|whitepages|registre\.ccq|b2bhint)/i;
const BUSINESS_HOST_RE = /(pagesjaunes|yellowpages|facebook|linkedin|google|maps|b2bhint)/i;
const REQ_HOST_RE = /(registreentreprises|req\.gouv|registreentreprise)/i;
const NOISY_HOST_RE = /(krispcall|callhippo|cloudtalk|justcall|openphone|textmagic|mightycall|virtual-phone|numero-virtuel|phone-number)/i;
const NOISY_PATH_RE = /(privacy|confidentialit|terms|conditions|modalites|pdf|pluginfile|forcedownload|download|wp-content\/uploads)/i;
const NOISY_TEXT_RE = /(privacy policy|politique de confidentialit|virtual phone|num[eé]ro virtuel|fax|t[eé]l[eé]copieur|bank of employers|banque d['’]?employeurs|liste des employeurs|pluginfile|forcedownload)/i;

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function sourceHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function countPhoneLikeTokens(value: string): number {
  const matches = value.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g);
  return matches?.length ?? 0;
}

function noisyReason(candidate: ReviewTrustCandidate, host: string | null): string | null {
  const sourceUrl = candidate.source_url ?? "";
  const evidenceText = [
    candidate.snippet,
    candidate.openclaw_evidence,
    candidate.openclaw_reasoning,
    candidate.review_reason,
  ].filter(Boolean).join(" ");
  const blob = `${sourceUrl} ${evidenceText}`;
  const phoneCount = countPhoneLikeTokens(blob);

  if (host && NOISY_HOST_RE.test(host)) return "Source generique de telephonie";
  if (NOISY_PATH_RE.test(sourceUrl)) return "Page fichier/PDF/politique";
  if (NOISY_TEXT_RE.test(blob)) return "Snippet bruyant";
  if (phoneCount >= 4) return "Plusieurs telephones dans la meme preuve";
  if (candidate.openclaw_verdict === "unlikely_match") return "Juge IA defavorable";
  return null;
}

function phoneEvidenceSource(candidate: ReviewTrustCandidate, host: string | null): PhoneEvidenceSource {
  const label = candidate.source_label ?? "";
  const sourceClass = candidate.source_class ?? "";
  const matchedOn = candidate.matched_on ?? "";
  const hostLabel = host ?? "source inconnue";
  const evidenceText = [
    candidate.snippet,
    candidate.openclaw_evidence,
    candidate.openclaw_reasoning,
    candidate.review_reason,
  ].filter(Boolean).join(" ");

  if (label === "name_postal_directory" || sourceClass === "directory_authoritative" || (host && DIRECTORY_HOST_RE.test(host))) {
    return {
      key: host ? `directory:${host}` : "directory",
      label: host ? `Annuaire - ${host}` : "Annuaire",
      kind: "directory",
      host,
      phoneBearing: true,
    };
  }

  if (host && REQ_HOST_RE.test(host)) {
    const reqShowsPhone = countPhoneLikeTokens(evidenceText) > 0;
    return {
      key: reqShowsPhone ? `req_visible:${host}` : "req_no_phone_source",
      label: reqShowsPhone ? `Source REQ visible - ${host}` : "Source telephone absente",
      kind: "web",
      host,
      phoneBearing: reqShowsPhone,
    };
  }

  if (label === "company_website" || sourceClass === "company_website") {
    return {
      key: host ? `business_site:${host}` : "business_site",
      label: host ? `Site entreprise - ${host}` : "Site entreprise",
      kind: "business_site",
      host,
      phoneBearing: true,
    };
  }

  if (label === "pages_jaunes_business" || (host && BUSINESS_HOST_RE.test(host))) {
    return {
      key: host ? `business_directory:${host}` : "business_directory",
      label: host ? `Source entreprise - ${host}` : "Source entreprise",
      kind: "business_site",
      host,
      phoneBearing: true,
    };
  }

  if (label === "req_phone") {
    return {
      key: host ? `web:${host}` : "req_no_phone_source",
      label: host ? `Web - ${host}` : "Source telephone absente",
      kind: host ? "web" : "unknown",
      host,
      phoneBearing: Boolean(host),
    };
  }

  if (label === "req_address_lookup") {
    return {
      key: host ? `web:${host}` : "req_no_phone_source",
      label: host ? `Web - ${host}` : "Source telephone absente",
      kind: host ? "web" : "unknown",
      host,
      phoneBearing: Boolean(host),
    };
  }

  if (label === "cross_property") {
    return {
      key: "socle_crm",
      label: "CRM Socle",
      kind: "unknown",
      host: null,
      phoneBearing: true,
    };
  }

  if (label === "reverse_address_lookup" || label === "reverse_address" || matchedOn.includes("property_address") || matchedOn.includes("mailing_address")) {
    return {
      key: host ? `web:${host}` : "address_web",
      label: host ? `Web - ${host}` : "Source web par adresse",
      kind: host ? "web" : "generic_web",
      host,
      phoneBearing: Boolean(host),
    };
  }

  if (host) {
    return {
      key: `web:${host}`,
      label: `Web - ${hostLabel}`,
      kind: "web",
      host,
      phoneBearing: true,
    };
  }

  return {
    key: "unknown",
    label: "Source telephone inconnue",
    kind: "unknown",
    host: null,
    phoneBearing: false,
  };
}

function ownerLinkSource(candidate: ReviewTrustCandidate): OwnerLinkSource {
  const label = candidate.source_label ?? "";
  const matchedOn = candidate.matched_on ?? "";

  if (label === "req_address_lookup") return { key: "req_address", label: "Lien REQ" };
  if (label === "req_phone") return { key: "req_entity", label: "Entite REQ" };
  if (label === "cross_property") return { key: "cross_property", label: "Lien CRM" };
  if (matchedOn.includes("director_name")) return { key: "director", label: "Administrateur lie" };
  return { key: "none", label: "Aucun lien proprietaire" };
}

function cleanSpecificSource(candidate: ReviewTrustCandidate, phoneSource: PhoneEvidenceSource): boolean {
  if (!phoneSource.phoneBearing || phoneSource.kind === "unknown" || phoneSource.kind === "generic_web") return false;
  if (candidate.source_label === "name_postal_directory") return false;
  if (candidate.source_label === "req_address_lookup") {
    return phoneSource.host !== null && (phoneSource.kind === "business_site" || phoneSource.kind === "directory");
  }
  return phoneSource.kind === "business_site" || phoneSource.kind === "directory" || phoneSource.kind === "web";
}

export function classifyPhoneReviewTrust(candidate: ReviewTrustCandidate): ReviewTrustClassification {
  const host = sourceHost(candidate.source_url);
  const phoneSource = phoneEvidenceSource(candidate, host);
  const ownerSource = ownerLinkSource(candidate);
  const noisy = noisyReason(candidate, host);
  const confidence = toFiniteNumber(candidate.initial_confidence) ?? 0;
  const isLikely = candidate.openclaw_verdict === "likely_match";
  const cleanSpecific = cleanSpecificSource(candidate, phoneSource);

  let reviewPriority: ReviewPriority = "judgment";
  if (noisy) {
    reviewPriority = "noisy";
  } else if (candidate.source_label === "name_postal_directory") {
    reviewPriority = "judgment";
  } else if (candidate.source_label === "req_address_lookup") {
    reviewPriority = cleanSpecific && (isLikely || confidence >= 70) ? "priority" : "judgment";
  } else if (cleanSpecific && (isLikely || confidence >= 70 || phoneSource.kind === "directory")) {
    reviewPriority = "priority";
  }

  const summary = ownerSource.key === "req_address"
    ? `Lien REQ confirme l'entite; telephone trouve via ${phoneSource.host ?? phoneSource.label}.`
    : `${phoneSource.label}${ownerSource.key !== "none" ? `; ${ownerSource.label}` : ""}.`;

  return {
    phoneEvidenceSource: phoneSource,
    ownerLinkSource: ownerSource,
    reviewPriority,
    host,
    noisyReason: noisy,
    summary,
  };
}

export function reviewPriorityLabel(priority: ReviewPriority): string {
  if (priority === "priority") return "Prioritaire";
  if (priority === "noisy") return "Bruit probable";
  return "A juger";
}

export function reviewPriorityRank(priority: ReviewPriority): number {
  if (priority === "priority") return 3;
  if (priority === "judgment") return 2;
  return 1;
}

export function hasReqOwnerLink(candidate: ReviewTrustCandidate): boolean {
  return ownerLinkSource(candidate).key === "req_address" || ownerLinkSource(candidate).key === "req_entity";
}
