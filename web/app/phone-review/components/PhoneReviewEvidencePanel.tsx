"use client";
import { useEffect, useState, useTransition } from "react";
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

// ── Which tool found this number? ─────────────────────────────────────────
// Identifies the actual data source so the reviewer knows whether to trust it.
type ToolInfo = { name: string; description: string };
function getToolInfo(c: PhoneCandidate): ToolInfo {
  const stage = c.stage;
  const url = c.source_url ?? "";
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* ignore */ }

  if (stage === "openclaw") {
    return { name: "OpenClaw legacy", description: "Recherche multi-sources approfondie de l'ancien pipeline. Utilise seulement le flux legacy quand ENRICHMENT_USE_LEGACY=true." };
  }
  if (host.includes("canada411") || host === "411.ca" || host.includes("pagesjaunes") || host.includes("yellowpages")) {
    return { name: `Annuaire public — ${host}`, description: "Annuaire téléphonique officiel. Si le nom du proprio y figure, le numéro est généralement fiable." };
  }
  if (host.includes("b2bhint")) {
    return { name: "B2BHint", description: "Annuaire d'entreprises canadiennes (basé sur REQ + sources publiques). Bon pour les compagnies, à recouper pour les particuliers." };
  }
  if (host.includes("registreentreprises") || host.includes("req.gouv") || host.includes("registreentreprise")) {
    return { name: "REQ — Registraire des entreprises Québec", description: "Source officielle. Si le numéro y est listé, c'est l'entreprise qui l'a déclaré." };
  }
  if (host.includes("google.com/maps") || host.includes("maps.google") || host.includes("g.co")) {
    return { name: "Google Maps", description: "Profil d'établissement Google. Risque élevé : c'est souvent le numéro du locataire/commerce, pas du propriétaire foncier." };
  }
  if (host.includes("facebook.com")) {
    return { name: "Facebook", description: "Page publique Facebook. Risque modéré : peut être le proprio, le locataire, ou un tiers." };
  }
  if (host.includes("linkedin.com")) {
    return { name: "LinkedIn", description: "Profil professionnel public." };
  }
  if (host.includes("ccq.org") || host.includes("rbq.gouv")) {
    return { name: `Régulateur — ${host}`, description: "Source officielle (CCQ/RBQ). Fiable si le nom concorde." };
  }
  if (stage === "address_search") {
    return { name: `Recherche Brave — ${host || "web"}`, description: "Recherche web par adresse postale. Le numéro a été extrait d'une page trouvée via Brave Search." };
  }
  if (stage === "company_search") {
    return { name: `Recherche Brave — ${host || "web"}`, description: "Recherche web par nom d'entreprise/proprio. Le numéro a été extrait d'une page trouvée via Brave Search." };
  }
  return { name: host || stage, description: "Source web non catégorisée." };
}

// ── Pros/Cons analysis from the candidate data ────────────────────────────
// Lays out exactly WHY the number is here and WHAT supports/opposes it.
type Analysis = { pros: string[]; cons: string[]; recommendation: "approve" | "reject" | "verify" };
function computeAnalysis(c: PhoneCandidate): Analysis {
  const pros: string[] = [];
  const cons: string[] = [];
  const phone7 = (c.phone_e164 ?? c.phone_raw ?? "").replace(/\D/g, "").slice(-7);
  const blob = `${c.snippet ?? ""} ${c.openclaw_evidence ?? ""} ${c.openclaw_reasoning ?? ""}`.toLowerCase();
  const contact = c.leads?.contacts;
  const ownerName = (contact?.full_name ?? contact?.company_name ?? "").trim();
  const ownerLast = (ownerName.toLowerCase().split(/\s+/).pop() ?? "").replace(/[^\p{L}]/gu, "");
  const matched = (c.matched_on ?? "").split(/[;,\s]+/).filter(Boolean);

  // ── PROS ─────────────────────────────────────────────────────────────
  if (matched.some((m) => m === "mailing_address" || m === "address_company")) {
    pros.push(`Adresse postale exacte du proprio${contact?.mailing_address ? ` (${contact.mailing_address})` : ""}`);
  }
  if (matched.some((m) => m.startsWith("public_directory"))) {
    pros.push("Inscrit dans un annuaire public officiel");
  }
  if (matched.includes("contact_name") || matched.includes("director_name")) {
    pros.push(`Nom du proprio « ${ownerName} » visible dans la source`);
  } else if (ownerLast && ownerLast.length >= 4 && blob.includes(ownerLast)) {
    pros.push(`Nom de famille « ${ownerLast} » présent dans le snippet`);
  }
  if (matched.includes("company_name") && contact?.company_name) {
    pros.push(`Entreprise « ${contact.company_name} » concorde`);
  }
  if (matched.includes("related_entity") || matched.includes("related_company")) {
    pros.push("Entreprise liée au proprio confirmée");
  }
  if (c.openclaw_verdict === "likely_match") {
    pros.push(`Juge IA confirme - confiance ${c.openclaw_confidence ?? c.initial_confidence}%`);
  }
  if (c.initial_confidence >= 80 && pros.length === 0) {
    pros.push(`Score de confiance élevé (${c.initial_confidence}%)`);
  }

  // ── CONS ─────────────────────────────────────────────────────────────
  // Fax detection (phone labelled as fax in source)
  if (phone7) {
    const faxNear = new RegExp(`(fax|t[eé]l[eé]copieur)[\\s:.-]{0,5}.{0,30}${phone7.slice(0,3)}.?${phone7.slice(3,6)}.?${phone7.slice(6)}`, "i");
    if (faxNear.test(blob)) {
      cons.push("Numéro étiqueté « Fax: » dans la source");
    }
  }
  // Residence/institution
  if (/r[ée]sidence pour a[îi]n[ée]s|chsld|rpa|manoir|centre d['e]?h[ée]bergement/i.test(blob)) {
    cons.push("Source = établissement (résidence pour aînés / CHSLD / RPA)");
  }
  // Different last name
  if (c.candidate_name && ownerName) {
    const sourceName = c.candidate_name.toLowerCase();
    const sourceLast = (sourceName.split(/\s+/).pop() ?? "").replace(/[^\p{L}]/gu, "");
    if (ownerLast && sourceLast && ownerLast.length >= 3 && sourceLast.length >= 3 && ownerLast !== sourceLast && !sourceName.includes(ownerLast) && !ownerName.toLowerCase().includes(sourceLast)) {
      cons.push(`Nom source « ${c.candidate_name} » ≠ proprio « ${ownerName} »`);
    }
  }
  // Weak match types
  if (c.matched_on === "postal_prefix") {
    cons.push("Seulement le code postal correspond — ni la rue, ni le nom");
  }
  if (c.matched_on === "city") {
    cons.push("Seulement la ville correspond — lien faible");
  }
  // Judge rejection
  if (c.openclaw_verdict === "unlikely_match") {
    cons.push(`Juge IA rejette : ${c.openclaw_reasoning ?? "incompatibilité détectée"}`);
  }
  // No name at all on a non-directory source
  const url = c.source_url ?? "";
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
  const isDirectory = host.includes("canada411") || host === "411.ca" || host.includes("pagesjaunes") || host.includes("yellowpages") || host.includes("b2bhint");
  if (ownerLast && ownerLast.length >= 4 && !blob.includes(ownerLast) && !isDirectory && pros.length === 0) {
    cons.push(`Nom du proprio « ${ownerLast} » absent du snippet`);
  }
  // Very low confidence
  if (c.initial_confidence < 25 && cons.length === 0) {
    cons.push(`Score de confiance très faible (${c.initial_confidence}%)`);
  }

  // ── Recommendation ───────────────────────────────────────────────────
  let recommendation: "approve" | "reject" | "verify" = "verify";
  if (c.openclaw_verdict === "unlikely_match" || c.initial_confidence < 25 || cons.length >= 2) {
    recommendation = "reject";
  } else if (pros.length >= 2 && cons.length === 0 && c.initial_confidence >= 70) {
    recommendation = "approve";
  } else if (pros.length >= 1 && cons.length === 0 && c.openclaw_verdict === "likely_match") {
    recommendation = "approve";
  }

  return { pros, cons, recommendation };
}

type Tone = "success" | "warn" | "danger" | "neutral";

type JudgeStatus = {
  label: string;
  detail: string;
  tone: Tone;
  failed: boolean;
};

function hasJudgeFailure(c: PhoneCandidate): boolean {
  const text = `${c.openclaw_reasoning ?? ""} ${c.openclaw_evidence ?? ""}`.toLowerCase();
  return /llm judge failed|overloaded|overloaded_error|rate limited|rate_limit|request failed|api error|\b529\b/.test(text);
}

function getJudgeStatus(c: PhoneCandidate): JudgeStatus {
  const failed = hasJudgeFailure(c);
  if (failed) {
    return {
      label: "Juge IA indisponible",
      detail: "Le juge IA n'a pas validé ce numéro. Il a eu une erreur et a routé le candidat en revue humaine.",
      tone: "warn",
      failed: true,
    };
  }

  if (c.openclaw_verdict === "likely_match") {
    return {
      label: "Juge IA favorable",
      detail: `Le juge IA a classé ce numéro comme probablement correct${c.openclaw_confidence != null ? ` (${c.openclaw_confidence}%)` : ""}.`,
      tone: "success",
      failed: false,
    };
  }

  if (c.openclaw_verdict === "unlikely_match") {
    return {
      label: "Juge IA défavorable",
      detail: "Le juge IA a classé ce numéro comme probablement incorrect.",
      tone: "danger",
      failed: false,
    };
  }

  if (c.openclaw_verdict === "uncertain") {
    return {
      label: "Juge IA incertain",
      detail: "Le juge IA n'a pas assez de preuves pour valider ce numéro.",
      tone: "warn",
      failed: false,
    };
  }

  return {
    label: "Pas de verdict IA",
    detail: "Aucun verdict automatique n'est disponible. Ce numéro doit être jugé à partir des preuves affichées.",
    tone: "neutral",
    failed: false,
  };
}

function getToneStyle(tone: Tone): { background: string; border: string; color: string } {
  if (tone === "success") {
    return { background: "#f1f8f1", border: "#b9d8bf", color: "var(--so-success,#2d7a3e)" };
  }
  if (tone === "danger") {
    return { background: "#fff5f4", border: "#efc7c3", color: "var(--so-danger,#b04545)" };
  }
  if (tone === "warn") {
    return { background: "#fff8e8", border: "#ead39a", color: "var(--so-warn,#b7791f)" };
  }
  return { background: "var(--so-bg-2,#fafaf7)", border: "var(--so-border,#e8e4d8)", color: "var(--so-fg-4,#4f4a42)" };
}

function getDecisionSummary(analysis: Analysis, c: PhoneCandidate, judge: JudgeStatus) {
  if (judge.failed) {
    return {
      tone: "warn" as Tone,
      title: "Vérification humaine requise",
      body: "Le pipeline a trouvé un numéro possible, mais le juge IA n'a pas pu le vérifier. Ce candidat est en revue parce qu'il n'est pas assez sûr pour être rendu appelable automatiquement.",
      action: "Action conseillée : garder non résolu ou rejeter. Approuver seulement après vérification manuelle de la source.",
    };
  }

  if (analysis.recommendation === "approve") {
    return {
      tone: "success" as Tone,
      title: "Peut être approuvé",
      body: "Les preuves affichent assez de signaux favorables pour rendre ce lead appelable.",
      action: "Action conseillée : approuver si la source et le numéro semblent cohérents à l'écran.",
    };
  }

  if (analysis.recommendation === "reject") {
    return {
      tone: "danger" as Tone,
      title: "Ne pas approuver tel quel",
      body: "Le système voit des signaux contre ce numéro. L'approbation est bloquée sauf vérification manuelle explicite.",
      action: "Action conseillée : rejeter, ou approuver seulement si vous avez vérifié hors CRM.",
    };
  }

  if (c.initial_confidence <= 50 || c.openclaw_verdict === "uncertain") {
    return {
      tone: "warn" as Tone,
      title: "Vérification humaine requise",
      body: "La confiance est faible ou incertaine. Le numéro est seulement un candidat, pas une validation.",
      action: "Action conseillée : vérifier la source avant d'approuver; sinon garder non résolu ou rejeter.",
    };
  }

  return {
    tone: "warn" as Tone,
    title: "À vérifier avant approbation",
    body: "Le système a trouvé des indices, mais pas assez pour une approbation automatique.",
    action: "Action conseillée : approuver seulement après vérification manuelle.",
  };
}

function sourceHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    address_search: "Recherche web par adresse",
    company_search: "Recherche web par nom",
    req_address_lookup: "Recherche adresse REQ",
    name_postal_directory: "Recherche annuaire nom + postal",
    reverse_address_lookup: "Recherche inverse adresse",
    pages_jaunes_business: "Recherche Pages Jaunes",
    company_website: "Recherche site d'entreprise",
    openclaw: "OpenClaw legacy",
  };
  return labels[stage] ?? stage;
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
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setNote("");
    setConfirmOverride(false);
  }, [candidate?.id]);

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

  // Score interpretation — what does this number actually mean?
  const scoreLabel =
    candidate.initial_confidence >= 80 ? { text: t.review.scoreHigh,    color: "var(--so-success)" }
    : candidate.initial_confidence >= 60 ? { text: t.review.scoreMid,    color: "var(--so-warn)" }
    : candidate.initial_confidence >= 40 ? { text: t.review.scoreLow,    color: "var(--so-danger)" }
    : { text: t.review.scoreVeryLow, color: "var(--so-danger)" };

  // Which tool found this number, and the pros/cons analysis
  const tool = getToolInfo(candidate);
  const analysis = computeAnalysis(candidate);
  const judge = getJudgeStatus(candidate);
  const decision = getDecisionSummary(analysis, candidate, judge);
  const decisionStyle = getToneStyle(decision.tone);
  const judgeStyle = getToneStyle(judge.tone);
  const host = sourceHost(candidate.source_url);
  const matchedSignals = candidate.matched_on
    ? candidate.matched_on.split(/[;,]+/).map((token) => token.trim()).filter(Boolean).map((token) => evidenceLabel(token, ev as EvidenceDict)).join(", ")
    : "aucun signal de concordance explicite";
  const reviewTrail = [
    {
      label: "1. Point de départ",
      detail: `${name} - ${address}${city ? `, ${city}` : ""}${contact?.mailing_address ? `; adresse postale ${contact.mailing_address}` : ""}`,
      tone: "neutral" as Tone,
    },
    {
      label: "2. Recherche lancée",
      detail: `${stageLabel(candidate.stage)}${candidate.search_query ? ` avec la requête "${candidate.search_query}"` : ""}`,
      tone: "neutral" as Tone,
    },
    {
      label: "3. Source trouvée",
      detail: `${tool.name}${host ? ` (${host})` : ""}${candidate.candidate_name ? `; nom source : ${candidate.candidate_name}` : ""}`,
      tone: "neutral" as Tone,
    },
    {
      label: "4. Score local",
      detail: `${candidate.initial_confidence}% - signaux : ${matchedSignals}`,
      tone: analysis.recommendation === "approve" ? "success" as Tone : analysis.recommendation === "reject" ? "danger" as Tone : "warn" as Tone,
    },
    {
      label: "5. Vérification IA",
      detail: judge.detail,
      tone: judge.tone,
    },
  ];
  const recoLabel =
    analysis.recommendation === "approve" ? { text: "Recommandation : approuver",  color: "var(--so-success)" }
    : analysis.recommendation === "reject"  ? { text: "Recommandation : refuser",   color: "var(--so-danger)"  }
    : { text: "Recommandation : vérifier manuellement", color: "var(--so-warn)" };

  // Weak/rejected candidates need a positive human confirmation before approval.
  const blockApprove = analysis.recommendation === "reject";
  const approveRequiresConfirm = analysis.recommendation !== "approve" || judge.failed || candidate.openclaw_verdict === "uncertain";
  const approveDisabled = isPending || (approveRequiresConfirm && !confirmOverride);

  return (
    <div className="pr-evidence">
      {/* Header */}
      <div className="pr-evidence__head">
        <div className="pr-evidence__name">{name}</div>
        <div className="pr-evidence__address">
          {address}{city ? `, ${city}` : ""}
          {property?.num_units ? t.review.logUnits(property.num_units) : ""}
        </div>
        {contact?.mailing_address && (
          <div className="pr-evidence__mailing">
            {t.review.mailingAddressPrefix} {contact.mailing_address}
            {contact.mailing_city ? `, ${contact.mailing_city}` : ""}
            {contact.mailing_postal ? ` ${contact.mailing_postal}` : ""}
          </div>
        )}
      </div>

      {/* Phone — big and readable */}
      <div className="pr-evidence__phone">
        <span className="pr-evidence__phone-num" style={{ fontFeatureSettings: '"tnum" 1' }}>
          {formatPhone(candidate.phone_e164 ?? candidate.phone_raw)}
        </span>
        {candidate.source_label && (
          <span className="pr-evidence__phone-source">{candidate.source_label}</span>
        )}
      </div>

      {/* Score card — the most important section */}
      <div className="pr-evidence__score-card">
        <div className="pr-evidence__score-row">
          <span className={`so-confidence-badge so-confidence-badge--${confidenceVariant(candidate.initial_confidence)}`} style={{ fontSize: 16, padding: "4px 10px" }}>
            {candidate.initial_confidence}%
          </span>
          <StagePill stage={candidate.stage} />
          {candidate.openclaw_verdict && <VerdictBadge verdict={candidate.openclaw_verdict} />}
        </div>
        <div className="pr-evidence__score-label" style={{ color: scoreLabel.color }}>
          {scoreLabel.text}
        </div>
        {candidate.review_reason && (
          <div className="pr-evidence__score-reason">{candidate.review_reason}</div>
        )}
      </div>

      {/* Decision summary — answer "should I approve this?" before raw evidence */}
      <div className="pr-evidence__section" style={{
        background: decisionStyle.background,
        border: `1px solid ${decisionStyle.border}`,
        borderLeft: `4px solid ${decisionStyle.color}`,
        padding: "12px 14px",
        borderRadius: 6,
      }}>
        <div className="pr-evidence__section-title" style={{ marginBottom: 6 }}>
          Décision recommandée
        </div>
        <div style={{ fontWeight: 700, fontSize: 15, color: decisionStyle.color, marginBottom: 4 }}>
          {decision.title}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.45, color: "var(--so-fg-4)" }}>
          {decision.body}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--so-fg-5)", marginTop: 8, fontWeight: 600 }}>
          {decision.action}
        </div>
      </div>

      {/* Process trail — compact reconstruction of how this candidate arrived here */}
      <div className="pr-evidence__section" style={{
        background: "var(--so-bg-2, #fafaf7)",
        padding: "10px 12px",
        borderRadius: 6,
        border: "1px solid var(--so-border, #e8e4d8)",
      }}>
        <div className="pr-evidence__section-title" style={{ marginBottom: 8 }}>
          Comment ce numéro est arrivé ici
        </div>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {reviewTrail.map((step) => {
            const style = getToneStyle(step.tone);
            return (
              <li key={step.label} style={{ borderLeft: `3px solid ${style.border}`, paddingLeft: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: step.tone === "neutral" ? "var(--so-fg-4)" : style.color }}>
                  {step.label}
                </div>
                <div style={{ fontSize: 12, color: "var(--so-fg-5)", lineHeight: 1.4 }}>
                  {step.detail}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Tool used — which data source actually found this number */}
      <div className="pr-evidence__section" style={{
        background: "var(--so-bg-2, #fafaf7)",
        borderLeft: "3px solid var(--so-accent, #b8945a)",
        padding: "10px 12px",
        borderRadius: 6,
      }}>
        <div className="pr-evidence__section-title" style={{ marginBottom: 4 }}>
          Outil utilisé
        </div>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{tool.name}</div>
        <div style={{ fontSize: 12, color: "var(--so-fg-5)", lineHeight: 1.4 }}>{tool.description}</div>
        {candidate.search_query && (
          <div style={{ fontSize: 11, color: "var(--so-fg-6)", marginTop: 6, fontStyle: "italic" }}>
            Requête : « {candidate.search_query} »
          </div>
        )}
      </div>

      {/* Pros/Cons analysis — the WHY */}
      <div className="pr-evidence__section" style={{
        background: "var(--so-bg-2, #fafaf7)",
        padding: "10px 12px",
        borderRadius: 6,
        border: "1px solid var(--so-border, #e8e4d8)",
      }}>
        <div className="pr-evidence__section-title" style={{ marginBottom: 8 }}>
          Pourquoi ce numéro est ici
        </div>

        {analysis.pros.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--so-success, #2d7a3e)", marginBottom: 4 }}>
              ✓ En faveur
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
              {analysis.pros.map((p, i) => (
                <li key={i} style={{ marginBottom: 2 }}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        {analysis.cons.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--so-danger, #b04545)", marginBottom: 4 }}>
              ✗ Contre
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
              {analysis.cons.map((c, i) => (
                <li key={i} style={{ marginBottom: 2 }}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        {analysis.pros.length === 0 && analysis.cons.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--so-fg-5)", fontStyle: "italic" }}>
            {"Aucun signal clair détecté — le score est basé uniquement sur la correspondance d'adresse."}
          </div>
        )}

        <div style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: "1px solid var(--so-border, #e8e4d8)",
          fontSize: 13,
          fontWeight: 600,
          color: recoLabel.color,
        }}>
          {recoLabel.text}
        </div>
      </div>

      {/* What the pipeline searched for */}
      {candidate.search_query && (
        <div className="pr-evidence__section">
          <div className="pr-evidence__section-title">{t.review.sectionSearchQuery}</div>
          <div className="pr-evidence__query-text">{candidate.search_query}</div>
        </div>
      )}

      {/* What was found at the source */}
      {(candidate.candidate_name || candidate.candidate_address || snippet) && (
        <div className="pr-evidence__section">
          <div className="pr-evidence__section-title">{t.review.sectionSourceFinds}</div>
          {candidate.candidate_name && (
            <div className="pr-evidence__section-row"><strong>{ev.nameFound}</strong> {candidate.candidate_name}</div>
          )}
          {candidate.candidate_address && (
            <div className="pr-evidence__section-row"><strong>{t.review.addressFoundPrefix}</strong> {candidate.candidate_address}</div>
          )}
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
        </div>
      )}

      {/* Source link */}
      {candidate.source_url && (
        <div className="pr-evidence__section">
          <div className="pr-evidence__section-title">{t.review.sectionSource}</div>
          <a
            href={candidate.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="crm-link-btn pr-evidence__url"
          >
            {candidate.source_url}
          </a>
        </div>
      )}

      {/* Evidence chips */}
      <EvidenceChips
        matchedOn={candidate.matched_on}
        snippet={candidate.snippet}
        companyName={contact?.company_name}
      />

      {/* Judge analysis — always expanded. Field names remain openclaw_* in DB. */}
      {(candidate.openclaw_reasoning || candidate.openclaw_evidence) ? (
        <div className="pr-evidence__section">
          <div className="pr-evidence__section-title">
            {t.review.sectionOpenClaw}
            {candidate.openclaw_confidence != null && (
              <span className={`so-confidence-badge so-confidence-badge--${confidenceVariant(candidate.openclaw_confidence)}`} style={{ marginLeft: 8 }}>
                {candidate.openclaw_confidence}%
              </span>
            )}
          </div>
          <div style={{
            background: judgeStyle.background,
            border: `1px solid ${judgeStyle.border}`,
            color: judgeStyle.color,
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 8,
          }}>
            {judge.label}: {judge.detail}
          </div>
          <div className="pr-evidence__openclaw-body">
            {candidate.openclaw_evidence && (
              <div className="pr-evidence__openclaw-evidence">{candidate.openclaw_evidence}</div>
            )}
            {candidate.openclaw_reasoning && (
              <div className="pr-evidence__openclaw-reasoning">{candidate.openclaw_reasoning}</div>
            )}
          </div>
        </div>
      ) : (
        <div className="pr-evidence__section pr-evidence__section--muted">
          {t.review.noOpenClawNote}
        </div>
      )}

      {/* v3 Gate Report — surfaces every gate decision */}
      {candidate.gate_results && (
        <div className="pr-evidence__section" style={{
          background: "var(--so-bg-2, #fafaf7)",
          padding: "10px 12px",
          borderRadius: 6,
          border: "1px solid var(--so-border, #e8e4d8)",
        }}>
          <div className="pr-evidence__section-title" style={{ marginBottom: 8 }}>
            Pipeline gate report
            {candidate.source_class && (
              <span style={{ marginLeft: 8, fontSize: 11, padding: "2px 6px", background: "var(--so-bg-3,#eee)", borderRadius: 4 }}>
                source: {candidate.source_class}
              </span>
            )}
          </div>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 12, lineHeight: 1.5 }}>
            {candidate.gate_results.outcomes.map((o, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                <span style={{
                  display: "inline-block", width: 18,
                  color: o.pass ? "var(--so-success,#2d7a3e)" : "var(--so-danger,#b04545)",
                  fontWeight: 700,
                }}>{o.pass ? "✓" : "✗"}</span>
                <strong>{o.gate}</strong>: {o.reason}
              </li>
            ))}
          </ul>
          {candidate.gate_results.scoreFactors && (
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--so-fg-5)" }}>
              Score factors — source: {candidate.gate_results.scoreFactors.source}; address: {candidate.gate_results.scoreFactors.address}; name: {candidate.gate_results.scoreFactors.name}; phone: {candidate.gate_results.scoreFactors.phoneAuthority}
            </div>
          )}
          {candidate.gate_results.haiku && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--so-border,#e8e4d8)", fontSize: 12 }}>
              <strong>Haiku G6:</strong> {candidate.gate_results.haiku.isOwnersPhone ? "approves" : "rejects"} ({candidate.gate_results.haiku.confidence}%) — {candidate.gate_results.haiku.reasoning}
            </div>
          )}
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

      {approveRequiresConfirm && (
        <label style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          marginBottom: 8, fontSize: 12, color: blockApprove ? "var(--so-danger,#b04545)" : "var(--so-warn,#b7791f)",
          lineHeight: 1.35,
        }}>
          <input
            type="checkbox"
            checked={confirmOverride}
            onChange={(e) => setConfirmOverride(e.target.checked)}
            disabled={isPending}
            style={{ marginTop: 2 }}
          />
          {blockApprove
            ? "Je comprends que le système recommande de rejeter, mais j'ai vérifié manuellement et je veux approuver."
            : "J'ai vérifié manuellement que ce numéro appartient au propriétaire ou à son entreprise."}
        </label>
      )}

      <div className="pr-evidence__actions">
        <button
          type="button"
          onClick={() => act("approve")}
          disabled={approveDisabled}
          className="crm-action-btn crm-action-btn--primary"
          title={approveRequiresConfirm && !confirmOverride ? "Cochez la vérification manuelle avant d'approuver ce candidat" : ""}
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
  const { t } = useLocale();
  if (!verdict) return null;
  const variant: "likely" | "uncertain" | "unlikely" | null =
    verdict === "likely_match" ? "likely"
    : verdict === "uncertain" ? "uncertain"
    : verdict === "unlikely_match" ? "unlikely"
    : null;
  const labels: Record<string, string> = {
    likely_match:   t.review.verdictLikely,
    uncertain:      t.review.verdictUncertain,
    unlikely_match: t.review.verdictUnlikely,
  };
  return (
    <span className={`crm-pill ${variant ? `crm-pill-verdict--${variant}` : ""}`}>
      Juge IA: {labels[verdict] ?? verdict}
    </span>
  );
}

function StagePill({ stage }: { stage: string }) {
  const { t } = useLocale();
  const ev = t.review.evidence;
  const labels: Record<string, string> = {
    address_search: ev.stageAddress,
    company_search: ev.stageCompany,
    req_address_lookup: "REQ adresse",
    name_postal_directory: "Nom + postal",
    reverse_address_lookup: "Adresse inverse",
    pages_jaunes_business: "Pages Jaunes",
    company_website: "Site entreprise",
    openclaw:       "OpenClaw legacy",
  };
  const variant: string =
    stage === "address_search" || stage === "req_address_lookup" || stage === "reverse_address_lookup" ? "address"
    : stage === "company_search" || stage === "company_website" || stage === "pages_jaunes_business" ? "company"
    : stage === "openclaw" ? "openclaw"
    : "via";
  return (
    <span className={`crm-pill crm-pill-stage--${variant}`}>{labels[stage] ?? stage}</span>
  );
}
