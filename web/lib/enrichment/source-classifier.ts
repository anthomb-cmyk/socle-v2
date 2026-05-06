// Layer C — Source classifier (v3 enrichment redesign).
//
// Decides per-result whether the URL+title points to ONE entity (authoritative)
// or to a category/list/locator/bulk page (aggregate). Decision uses three
// signal layers:
//
//   1. URL path shape    — /entreprise/{slug}/, /detail/, /profil/, /id={n}, ...
//   2. Title shape       — "All X in Y", "Succursales par province", aggregate
//                          markers, "vs", " | annuaire", etc.
//   3. Domain hint table — adjusts confidence (Canada411 detail page > random
//                          blog claiming to be a directory)
//
// The classifier is intentionally OPINIONATED about denylisting: bulk PDFs,
// CSVs, Scribd, eBay, government bulk lists, and "all retailers in X" pages
// fail outright. RC-4 from the audit.

import type { SourceClass, SourceClassification } from "./types";

// ── Domain hint table ────────────────────────────────────────────────────────
// "authoritative" = the domain HOSTS authoritative per-entity pages, but the
// page-shape signals still decide whether *this* URL is one of them.
// "aggregate" = the domain mostly hosts category/list pages; we treat it as
// aggregate unless very strong per-entity signals say otherwise.
// "bulk" = the domain hosts bulk lists (PDFs, CSVs, large directories).
// "commerce" / "social" / "municipal" = treated specially.

const DOMAIN_HINTS: Array<{ pattern: RegExp; bias: SourceClass; weight: number; label: string }> = [
  // ── Authoritative directories (per-entity detail pages) ─────────────────
  { pattern: /(?:^|\.)canada411\.ca$/i,           bias: "directory_authoritative", weight: 0.7, label: "canada411" },
  { pattern: /(?:^|\.)411\.ca$/i,                  bias: "directory_authoritative", weight: 0.5, label: "411.ca" },  // many category pages
  { pattern: /(?:^|\.)pagesjaunes\.ca$/i,          bias: "directory_authoritative", weight: 0.7, label: "pagesjaunes" },
  { pattern: /(?:^|\.)yellowpages\.ca$/i,          bias: "directory_authoritative", weight: 0.7, label: "yellowpages" },
  { pattern: /(?:^|\.)b2bhint\.com$/i,             bias: "directory_authoritative", weight: 0.85, label: "b2bhint" },
  { pattern: /(?:^|\.)opencorporates\.com$/i,       bias: "directory_authoritative", weight: 0.85, label: "opencorporates" },
  { pattern: /registreentreprises\.gouv\.qc\.ca$/i, bias: "directory_authoritative", weight: 0.95, label: "REQ" },
  { pattern: /req\.gouv\.qc\.ca$/i,                 bias: "directory_authoritative", weight: 0.95, label: "REQ" },
  { pattern: /\.req\.gouv\.qc\.ca$/i,                 bias: "directory_authoritative", weight: 0.95, label: "REQ" },

  // Professional orders & regulators (per-member detail pages are authoritative)
  { pattern: /(?:^|\.)oaciq\.com$/i,                bias: "directory_authoritative", weight: 0.9, label: "OACIQ" },
  { pattern: /(?:^|\.)oiq\.qc\.ca$/i,               bias: "directory_authoritative", weight: 0.9, label: "OIQ" },
  { pattern: /(?:^|\.)cnesst\.gouv\.qc\.ca$/i,      bias: "directory_authoritative", weight: 0.6, label: "CNESST" },
  { pattern: /(?:^|\.)ccq\.org$/i,                  bias: "directory_authoritative", weight: 0.85, label: "CCQ" },
  { pattern: /rbq\.gouv\.qc\.ca$/i,                 bias: "directory_authoritative", weight: 0.85, label: "RBQ" },
  { pattern: /(?:^|\.)cnq\.org$/i,                  bias: "directory_authoritative", weight: 0.85, label: "Chambre des notaires" },
  { pattern: /chambredesnotaires\.qc\.ca$/i,        bias: "directory_authoritative", weight: 0.9, label: "Chambre des notaires" },
  { pattern: /(?:^|\.)cpaquebec\.ca$/i,             bias: "directory_authoritative", weight: 0.9, label: "CPA Québec" },
  { pattern: /(?:^|\.)barreau\.qc\.ca$/i,           bias: "directory_authoritative", weight: 0.9, label: "Barreau" },
  { pattern: /(?:^|\.)oaq\.com$/i,                  bias: "directory_authoritative", weight: 0.9, label: "OAQ Architectes" },
  { pattern: /bbb\.org$/i,                          bias: "directory_authoritative", weight: 0.7, label: "BBB" },
  { pattern: /(?:^|\.)kompass\.com$/i,              bias: "directory_authoritative", weight: 0.6, label: "Kompass" },
  { pattern: /(?:^|\.)dnb\.com$/i,                  bias: "directory_authoritative", weight: 0.7, label: "Dun & Bradstreet" },

  // Maps & social (treated as social/per-entity but lower trust)
  { pattern: /google\.com\/maps/i,                  bias: "social",                  weight: 0.55, label: "Google Maps" },
  { pattern: /maps\.google\./i,                     bias: "social",                  weight: 0.55, label: "Google Maps" },
  { pattern: /(?:^|\.)facebook\.com$/i,             bias: "social",                  weight: 0.45, label: "Facebook" },
  { pattern: /(?:^|\.)linkedin\.com$/i,             bias: "social",                  weight: 0.5, label: "LinkedIn" },
  { pattern: /(?:^|\.)yelp\.(?:ca|com)$/i,          bias: "social",                  weight: 0.5, label: "Yelp" },
  { pattern: /(?:^|\.)twitter\.com$/i,              bias: "social",                  weight: 0.4, label: "Twitter" },
  { pattern: /(?:^|\.)x\.com$/i,                    bias: "social",                  weight: 0.4, label: "X" },
  { pattern: /(?:^|\.)instagram\.com$/i,            bias: "social",                  weight: 0.4, label: "Instagram" },

  // ── Aggregate / category / locator domains (mostly bad for our use case) ──
  { pattern: /(?:^|\.)depquebec\.com$/i,            bias: "directory_aggregate",     weight: 0.85, label: "depquebec category" },
  { pattern: /(?:^|\.)bottinexcel\.com$/i,          bias: "bulk_document",           weight: 0.9,  label: "bottinexcel postal lists" },
  { pattern: /(?:^|\.)jeancoutu\.com$/i,            bias: "directory_aggregate",     weight: 0.9,  label: "Jean Coutu locator" },
  { pattern: /(?:^|\.)pharmaprix\.ca$/i,            bias: "directory_aggregate",     weight: 0.9,  label: "Pharmaprix locator" },
  { pattern: /(?:^|\.)metro\.ca$/i,                 bias: "directory_aggregate",     weight: 0.85, label: "Metro locator" },
  { pattern: /(?:^|\.)iga\.net$/i,                  bias: "directory_aggregate",     weight: 0.85, label: "IGA locator" },
  { pattern: /(?:^|\.)provigo\.ca$/i,               bias: "directory_aggregate",     weight: 0.85, label: "Provigo locator" },
  { pattern: /(?:^|\.)tigre[\-_]?geant\.com$/i,     bias: "directory_aggregate",     weight: 0.85, label: "TG locator" },
  { pattern: /(?:^|\.)granby[-]?industriel\.com$/i, bias: "municipal_or_institutional", weight: 0.9,  label: "Granby Industriel" },
  { pattern: /(?:^|\.)granby\.ca$/i,                bias: "municipal_or_institutional", weight: 0.9,  label: "Ville de Granby" },
  { pattern: /(?:^|\.)usine231\.com$/i,             bias: "directory_aggregate",     weight: 0.85, label: "Usine 231 listings" },

  // ── Bulk documents / commerce / unrelated ──────────────────────────────
  { pattern: /(?:^|\.)scribd\.com$/i,               bias: "bulk_document",           weight: 0.95, label: "Scribd" },
  { pattern: /cdn-contenu\.quebec\.ca$/i,           bias: "bulk_document",           weight: 0.9,  label: "Quebec CSV/PDF CDN" },
  { pattern: /(?:^|\.)cai\.gouv\.qc\.ca$/i,         bias: "bulk_document",           weight: 0.85, label: "CAI bulk PDFs" },
  { pattern: /(?:^|\.)lautorite\.qc\.ca$/i,         bias: "bulk_document",           weight: 0.8,  label: "L'Autorité tables" },
  { pattern: /(?:^|\.)aqgp\.ca$/i,                  bias: "bulk_document",           weight: 0.8,  label: "AQGP member PDFs" },
  { pattern: /(?:^|\.)opengovca\.com$/i,            bias: "directory_authoritative", weight: 0.55, label: "OpenGovCA" },
  { pattern: /sante\.gouv\.qc\.ca$/i,               bias: "municipal_or_institutional", weight: 0.85, label: "Santé QC repertoire" },
  { pattern: /caissescolaire\.com$/i,               bias: "directory_aggregate",     weight: 0.85, label: "Caisse scolaire repertoire" },
  { pattern: /(?:^|\.)ebay\.(?:ca|com)$/i,          bias: "commerce_unrelated",      weight: 0.95, label: "eBay" },
  { pattern: /(?:^|\.)amazon\.(?:ca|com)$/i,        bias: "commerce_unrelated",      weight: 0.95, label: "Amazon" },
  { pattern: /(?:^|\.)kijiji\.ca$/i,                bias: "commerce_unrelated",      weight: 0.9,  label: "Kijiji" },
  { pattern: /(?:^|\.)mil20condos\.ca$/i,           bias: "directory_aggregate",     weight: 0.7,  label: "building rental site" },
  { pattern: /bromontmontagne\.com$/i,              bias: "municipal_or_institutional", weight: 0.85, label: "Bromont resort contact" },
  { pattern: /(?:^|\.)eebeauce\.com$/i,             bias: "directory_aggregate",     weight: 0.6,  label: "EEB business profile" },
];

const BULK_PATH_RE = /\.(?:pdf|csv|tsv|xlsx?|xml|zip|json)(?:\?|$)/i;
const AGGREGATE_PATH_RE = /\/(?:category|categories|categorie|cat|toutes|all|list|liste|repertoire|annuaire|directory|locator|locations|succursales|stores|magasins|members|membres|results)\b/i;
const DETAIL_PATH_RE = /\/(?:entreprise|company|profil|profile|detail|details|business|listing|fiche|membre|member|notaire|courtier|architecte|cabinet)\/[\w%-]+/i;
const ID_QUERY_PATH_RE = /[?&](?:id|listing|profile|entity|biz|item)=[\w-]+/i;
const STORE_LOCATOR_PATH_RE = /(?:store|shop|magasin)[-_]?(?:locator|finder)/i;

const AGGREGATE_TITLE_RE = /\b(?:all|tous|toutes les|in granby|in [A-Z][a-z]+(?:s+[A-Z][a-z]+)*\b)\b|d[eé]taillants|all retailers|succursales|store locator|find a store|find a location|repertoire|annuaire/i;

/** Classify a single Brave result. */
export function classifyResult(input: { url: string; title: string; description: string }): SourceClassification {
  const url = input.url || "";
  const title = input.title || "";
  // Description is intentionally not used in classification — page-shape
  // signals come from URL + title only. Kept in the input shape for symmetry
  // with downstream extractors that DO use the description.
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
  const path = (() => { try { return new URL(url).pathname + (new URL(url).search || ""); } catch { return ""; } })();

  // ── Hard catches first ────────────────────────────────────────────────
  if (BULK_PATH_RE.test(path) || /\.(?:pdf|csv)\b/i.test(url)) {
    return mk("bulk_document", 0.95, `bulk file extension in URL (${url.match(BULK_PATH_RE)?.[0] ?? "pdf/csv"})`, host, false);
  }
  if (STORE_LOCATOR_PATH_RE.test(url) || STORE_LOCATOR_PATH_RE.test(title)) {
    return mk("directory_aggregate", 0.9, "store-locator URL/title", host, false);
  }

  // ── Domain hint ───────────────────────────────────────────────────────
  let hint: { bias: SourceClass; weight: number; label: string } | null = null;
  for (const h of DOMAIN_HINTS) {
    if (h.pattern.test(host)) { hint = { bias: h.bias, weight: h.weight, label: h.label }; break; }
  }

  // ── Page-shape signals ────────────────────────────────────────────────
  const hasDetailPath = DETAIL_PATH_RE.test(path) || ID_QUERY_PATH_RE.test(path);
  const hasAggregatePath = AGGREGATE_PATH_RE.test(path);
  const hasAggregateTitle = AGGREGATE_TITLE_RE.test(title) || /^(all|tous|toutes)\b/i.test(title.trim());
  const titleLooksLikePerson = /^[A-ZÉÀÂÇÉÈÊËÎÏÔÛÜŸ][\p{L}'\-]+(?:\s+[A-Z][\p{L}'\-]+){1,3}\s*[\-|·]/u.test(title);
  const titleLooksLikeBusiness = /(inc\.|ltée?|ltd\.?|corp\.?|s\.e\.n\.c\.|s\.e\.c\.)/i.test(title) || /^[A-Z]{2,}[\s\w&'\-]{2,}$/.test(title.trim().split(/[\-|·]/)[0] ?? "");

  // ── Decide ────────────────────────────────────────────────────────────
  // 1. Aggregate signals win for non-detail pages.
  if (hasAggregatePath || hasAggregateTitle) {
    if (hasDetailPath) {
      // Conflicting — lean to aggregate as a safety measure.
      return mk("directory_aggregate", 0.7, "aggregate path/title overrides weak detail signal", host, !!hint);
    }
    return mk(hint?.bias === "bulk_document" ? "bulk_document" : "directory_aggregate", 0.85, "aggregate path or title", host, !!hint);
  }

  // 2. Detail path on an authoritative domain → authoritative.
  if (hint?.bias === "directory_authoritative" && hasDetailPath) {
    return mk("directory_authoritative", Math.max(hint.weight, 0.85), `${hint.label}: per-entity detail path`, host, true);
  }

  // 3. Detail path on a social domain → social.
  if (hint?.bias === "social" && (hasDetailPath || titleLooksLikePerson || titleLooksLikeBusiness)) {
    return mk("social", hint.weight, `${hint.label}: profile-shaped page`, host, true);
  }

  // 4. Authoritative domain but URL is the homepage / no detail signals → aggregate.
  if (hint?.bias === "directory_authoritative" && (path === "/" || path === "" || /^\/[a-z]{2}\/?$/i.test(path))) {
    return mk("directory_aggregate", 0.7, `${hint.label}: homepage/index, not a detail page`, host, true);
  }

  // 5. If the domain hint says aggregate / municipal / bulk / commerce, trust it.
  if (hint && (hint.bias === "directory_aggregate" || hint.bias === "municipal_or_institutional" || hint.bias === "bulk_document" || hint.bias === "commerce_unrelated")) {
    return mk(hint.bias, hint.weight, hint.label, host, true);
  }

  // 6. Page looks like a per-entity detail page even on an unknown domain.
  if (hasDetailPath || (titleLooksLikeBusiness && !hasAggregatePath && !hasAggregateTitle)) {
    return mk("web_other", 0.55, "unknown domain, detail-shaped path", host, false);
  }

  // 7. Fallback: web_other with low confidence — gates will likely quarantine.
  return mk("web_other", 0.4, "unknown domain, no detail signals", host, false);
}

function mk(sourceClass: SourceClass, confidence: number, reason: string, host: string, hint: boolean): SourceClassification {
  return { sourceClass, confidence, reason, host, domainHintApplied: hint };
}

/** Public lookup of which classes pass G2 (source gate). */
export function isAllowedSourceClass(c: SourceClass): boolean {
  return c === "directory_authoritative" || c === "social" || c === "company_website" || c === "web_other";
}

export function isHardDenySourceClass(c: SourceClass): boolean {
  return c === "directory_aggregate" || c === "bulk_document" || c === "commerce_unrelated" || c === "municipal_or_institutional";
}
