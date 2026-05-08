// Briefing module — generates a per-lead AI context card for the calling team.
//
// Phase 8 redesign adds structured template rendering (Pipeline A / B) with an
// optional Haiku phrasing pass.  The legacy `generateBriefing` function that
// powers the existing API route and queue worker is preserved unchanged so no
// callers need to be updated.
//
// New public API (Phase 8):
//   renderBriefingTemplate(input)  — pure, no LLM
//   renderBriefingPhrased(input)   — with Haiku pass; soft-falls-back to template
//   detectLanguage(canonicalName)  — Francophone heuristic
//
// All Anthropic calls go through lib/llm/anthropic-client.ts so cost is
// automatically tracked in llm_usage_log.

import type { SupabaseClient } from "@supabase/supabase-js";
import { callAnthropic } from "@/lib/llm/anthropic-client";
import { getPortfolioInfo } from "@/lib/portfolio/detector";

// ── Legacy types (unchanged) ─────────────────────────────────────────────────

type LeadRow = {
  id: string;
  status: string;
  contact_id: string;
  property_id: string;
  contacts: {
    full_name: string | null;
    company_name: string | null;
    kind: string | null;
    mailing_address: string | null;
    mailing_city: string | null;
    mailing_postal: string | null;
    primary_email: string | null;
  } | null;
  properties: {
    address: string | null;
    city: string | null;
    num_units: number | null;
    evaluation_total: number | null;
    year_built: number | null;
    matricule: string | null;
  } | null;
};

type PhoneRow = {
  e164: string;
  status: string;
  source: string;
};

type EnrichmentEventRow = {
  event_type: string;
  stage: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type NoteRow = {
  content: string;
  created_at: string;
};

// ── Phase 8 Types ─────────────────────────────────────────────────────────────

export type BriefingInput = {
  pipeline: "A" | "B";
  owner: {
    canonicalName: string;
    ownerType: "individual" | "numbered_co" | "named_co" | "trust" | "government";
    neq?: string | null;
    mailingAddress?: string | null;
    mailingIsProperty?: boolean;
  };
  reqDirector?: { name: string; year?: number } | null;
  directorOfOther?: { name: string }[] | null;
  properties: Array<{
    matricule: string;
    address: string;
    city?: string | null;
    nUnits?: number | null;
    assessmentTotal?: number | null;
    yearBuilt?: number | null;
  }>;
  primaryPhone: { e164: string; tier: string; label: string; isDirect: boolean };
  primarySource: string;
  secondarySource?: string | null;
  whatsInteresting?: string | null;
  language?: "auto" | "fr" | "en";
};

// ── detectLanguage ────────────────────────────────────────────────────────────

/**
 * Heuristic: return "fr" if the canonical name appears Francophone.
 *
 * Checks (in order, any match → "fr"):
 *  1. Any token contains a common French diacritic character:
 *     à â é è ê ë î ï ô û ç (case-insensitive)
 *  2. Any token exactly matches a small list of common French given names
 *     (case-insensitive).  The list is intentionally small; false negatives are
 *     acceptable — a "fr" miss simply means the template text is in English.
 *  3. Any token ends in a common French surname suffix:
 *     -eau, -aux, -ier, -ière, -oux, -elle
 *
 * Everything else → "en".
 */
export function detectLanguage(canonicalName: string): "fr" | "en" {
  // French given-name list (small, documented).
  const FRENCH_GIVEN_NAMES = new Set([
    "pierre", "jean", "marc", "anne", "michel", "andré", "andre",
    "claude", "gilles", "nicole", "sylvie", "louise", "luc", "paul",
    "richard", "martin", "chantal", "yves", "gilles", "francois",
    "françoise", "francoise", "alain", "nathalie", "guy", "régis",
    "regis", "benoit", "benoît", "gaston", "gérard", "gerard",
    "raymond", "normand", "serge", "suzanne", "monique", "réal", "real",
    "roger", "armand", "fernand", "lucien", "laure", "mireille",
    "ghislaine", "colette", "yvon", "yvonne",
  ]);

  // French diacritics (covers most common ones in Québec French names)
  const FRENCH_DIACRITICS = /[àâéèêëîïôûç]/i;

  // French surname suffix pattern
  const FRENCH_SUFFIX = /(eau|aux|ier|ière|iere|oux|elle)$/i;

  // Tokenise: split on whitespace, commas, hyphens, dots
  const tokens = canonicalName.split(/[\s,.\-]+/).filter(Boolean);

  for (const token of tokens) {
    if (FRENCH_DIACRITICS.test(token)) return "fr";
    if (FRENCH_GIVEN_NAMES.has(token.toLowerCase())) return "fr";
    if (FRENCH_SUFFIX.test(token)) return "fr";
  }

  return "en";
}

// ── Currency formatter ────────────────────────────────────────────────────────

function formatCurrency(amount: number, locale: "en" | "fr"): string {
  return new Intl.NumberFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatPhone(e164: string): string {
  // Format +1XXXXXXXXXX → (XXX) XXX-XXXX
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  return e164;
}

// ── renderBriefingTemplate ────────────────────────────────────────────────────

/**
 * Pure (no LLM) template renderer for Pipeline A and Pipeline B briefings.
 * Language is determined by `input.language`:
 *   "fr"   → French text
 *   "en"   → English text
 *   "auto" (default) → French if detectLanguage(canonicalName) === "fr"
 */
export function renderBriefingTemplate(input: BriefingInput): string {
  const {
    pipeline,
    owner,
    reqDirector,
    directorOfOther,
    properties,
    primaryPhone,
    primarySource,
    secondarySource,
    whatsInteresting,
    language = "auto",
  } = input;

  // Resolve language
  const lang: "fr" | "en" =
    language === "fr" ? "fr" :
    language === "en" ? "en" :
    detectLanguage(owner.canonicalName);

  // Aggregate stats
  const totalUnits = properties.reduce((s, p) => s + (p.nUnits ?? 0), 0);
  const totalAssessment = properties.reduce((s, p) => s + (p.assessmentTotal ?? 0), 0);
  const cities = [...new Set(properties.map(p => p.city).filter(Boolean))] as string[];
  const cityList = cities.length > 0 ? cities.join(", ") : (lang === "fr" ? "ville inconnue" : "unknown city");
  const nBuildings = properties.length;

  // Largest property by units (then assessment as tiebreaker)
  const largest = [...properties].sort((a, b) => {
    const ua = a.nUnits ?? 0;
    const ub = b.nUnits ?? 0;
    if (ub !== ua) return ub - ua;
    return (b.assessmentTotal ?? 0) - (a.assessmentTotal ?? 0);
  })[0] ?? properties[0];

  const phone = formatPhone(primaryPhone.e164);
  const label = primaryPhone.label;

  const ownerName = owner.canonicalName;
  const entityName = owner.ownerType === "individual" ? ownerName : ownerName;

  if (pipeline === "A") {
    return renderPipelineA({
      lang, ownerName, entityName, neq: owner.neq,
      reqDirector, mailingAddress: owner.mailingAddress,
      mailingIsProperty: owner.mailingIsProperty ?? false,
      nBuildings, totalUnits, cityList, totalAssessment, largest,
      primaryPhone, phone, primarySource, secondarySource, label,
      whatsInteresting,
    });
  } else {
    return renderPipelineB({
      lang, ownerName, directorOfOther,
      nBuildings, totalUnits, cityList, totalAssessment,
      phone, primarySource, secondarySource, label,
      whatsInteresting,
    });
  }
}

// ── Pipeline A renderer ───────────────────────────────────────────────────────

interface PipelineAVars {
  lang: "fr" | "en";
  ownerName: string;
  entityName: string;
  neq?: string | null;
  reqDirector?: { name: string; year?: number } | null;
  mailingAddress?: string | null;
  mailingIsProperty: boolean;
  nBuildings: number;
  totalUnits: number;
  cityList: string;
  totalAssessment: number;
  largest: BriefingInput["properties"][number];
  primaryPhone: BriefingInput["primaryPhone"];
  phone: string;
  primarySource: string;
  secondarySource?: string | null;
  label: string;
  whatsInteresting?: string | null;
}

function renderPipelineA(v: PipelineAVars): string {
  const { lang } = v;
  const fr = lang === "fr";
  const lines: string[] = [];

  // Line 1: Owner identity
  const neqSuffix = v.neq ? (fr ? ` (NEQ ${v.neq})` : ` (NEQ ${v.neq})`) : "";
  lines.push(
    fr
      ? `Propriétaire : ${v.ownerName}${neqSuffix}.`
      : `Owner: ${v.ownerName}${neqSuffix}.`,
  );

  // Line 2 (optional): REQ director
  if (v.reqDirector) {
    const yearPart = v.reqDirector.year != null
      ? (fr ? `, enregistré en ${v.reqDirector.year}` : `, registered ${v.reqDirector.year}`)
      : "";
    lines.push(
      fr
        ? `Dirigeant au REQ : ${v.reqDirector.name}${yearPart}.`
        : `Director per REQ: ${v.reqDirector.name}${yearPart}.`,
    );
  }

  // Line 3: Portfolio summary
  const totalFmt = v.totalAssessment > 0 ? formatCurrency(v.totalAssessment, lang) : null;
  const buildingsWord = fr
    ? (v.nBuildings > 1 ? "immeubles" : "immeuble")
    : (v.nBuildings > 1 ? "buildings" : "building");
  const unitsWord = fr
    ? (v.totalUnits !== 1 ? "logements" : "logement")
    : (v.totalUnits !== 1 ? "units" : "unit");

  if (fr) {
    lines.push(
      `Détient ${v.nBuildings} ${buildingsWord} totalisant ${v.totalUnits} ${unitsWord} à ${v.cityList}${totalFmt ? `, évalués à ${totalFmt}` : ""}.`,
    );
  } else {
    lines.push(
      `Holds ${v.nBuildings} ${buildingsWord} totaling ${v.totalUnits} ${unitsWord} in ${v.cityList}${totalFmt ? `, assessed at ${totalFmt}` : ""}.`,
    );
  }

  // Line 4: Largest property
  if (v.largest) {
    const lu = v.largest.nUnits;
    const la = v.largest.assessmentTotal;
    const ly = v.largest.yearBuilt;
    const laFmt = la != null ? formatCurrency(la, lang) : null;
    const parts: string[] = [];
    if (lu != null) parts.push(fr ? `${lu} logements` : `${lu}-unit`);
    parts.push(fr ? `au ${v.largest.address}` : `at ${v.largest.address}`);
    if (laFmt) parts.push(fr ? `évalué ${laFmt}` : `assessed ${laFmt}`);
    if (ly) parts.push(fr ? `construit en ${ly}` : `built ${ly}`);
    lines.push(
      fr
        ? `Plus grand : ${parts.join(", ")}.`
        : `Largest: ${parts.join(", ")}.`,
    );
  }

  // Line 5 (optional): Mailing = property
  if (v.mailingIsProperty && v.mailingAddress) {
    // Find units at mailing address (best effort — match by address substring)
    const mailingProp = [
      ...([] as BriefingInput["properties"]),
    ]; // We don't have the full list here; use largest proxy
    void mailingProp; // unused
    lines.push(
      fr
        ? `Adresse postale : ${v.mailingAddress}, aussi une propriété leur appartenant — opère vraisemblablement à domicile.`
        : `Mailing address is ${v.mailingAddress}, also a property owned by them — operates from home.`,
    );
  }

  // Line 6: Phone
  if (!v.primaryPhone.isDirect) {
    lines.push(
      fr
        ? `Téléphone : ${v.phone} (sonne au bureau de ${v.entityName}). Demander ${v.ownerName} ; si inconnu, marquer wrong_number.`
        : `Phone: ${v.phone} (rings at ${v.entityName}'s office). Ask for ${v.ownerName}; if unfamiliar, mark wrong_number.`,
    );
  } else {
    const corrobPart = v.secondarySource
      ? (fr ? ` et corroboré par ${v.secondarySource}` : ` and corroborated by ${v.secondarySource}`)
      : "";
    lines.push(
      fr
        ? `Téléphone : ${v.phone}, source ${v.primarySource}${corrobPart}.`
        : `Phone: ${v.phone}, sourced from ${v.primarySource}${corrobPart}.`,
    );
  }

  // Line 7: Confidence
  lines.push(fr ? `Confiance : ${v.label}.` : `Confidence: ${v.label}.`);

  // Line 8 (optional): What's interesting
  if (v.whatsInteresting) {
    lines.push(v.whatsInteresting);
  }

  return lines.join("\n");
}

// ── Pipeline B renderer ───────────────────────────────────────────────────────

interface PipelineBVars {
  lang: "fr" | "en";
  ownerName: string;
  directorOfOther?: { name: string }[] | null;
  nBuildings: number;
  totalUnits: number;
  cityList: string;
  totalAssessment: number;
  phone: string;
  primarySource: string;
  secondarySource?: string | null;
  label: string;
  whatsInteresting?: string | null;
}

function renderPipelineB(v: PipelineBVars): string {
  const { lang } = v;
  const fr = lang === "fr";
  const lines: string[] = [];

  // Line 1: Owner identity (individual in Pipeline B)
  lines.push(
    fr
      ? `Propriétaire : ${v.ownerName}, individu.`
      : `Owner: ${v.ownerName}, individual.`,
  );

  // Line 2 (optional): Director of another entity
  if (v.directorOfOther && v.directorOfOther.length > 0) {
    const names = v.directorOfOther.map(d => d.name).join(", ");
    lines.push(
      fr
        ? `Inscrit comme dirigeant de ${names} (entité distincte, point de départ de conversation).`
        : `Listed as director of ${names} (separate entity, conversation starter).`,
    );
  }

  // Line 3: Portfolio summary
  const totalFmt = v.totalAssessment > 0 ? formatCurrency(v.totalAssessment, lang) : null;
  const buildingsWord = fr
    ? (v.nBuildings > 1 ? "immeubles" : "immeuble")
    : (v.nBuildings > 1 ? "buildings" : "building");
  const unitsWord = fr
    ? (v.totalUnits !== 1 ? "logements" : "logement")
    : (v.totalUnits !== 1 ? "units" : "unit");

  if (fr) {
    lines.push(
      `Détient ${v.nBuildings} ${buildingsWord} totalisant ${v.totalUnits} ${unitsWord} à ${v.cityList}${totalFmt ? `, évalués à ${totalFmt}` : ""}.`,
    );
  } else {
    lines.push(
      `Holds ${v.nBuildings} ${buildingsWord} totaling ${v.totalUnits} ${unitsWord} in ${v.cityList}${totalFmt ? `, assessed at ${totalFmt}` : ""}.`,
    );
  }

  // Line 4: Phone (direct line)
  const corrobPart = v.secondarySource
    ? (fr ? ` + ${v.secondarySource}` : ` + ${v.secondarySource}`)
    : "";
  lines.push(
    fr
      ? `Téléphone : ${v.phone} (ligne directe via ${v.primarySource}${corrobPart}).`
      : `Phone: ${v.phone} (direct line per ${v.primarySource}${corrobPart}).`,
  );

  // Line 5: Verify before mentioning real estate
  lines.push(
    fr
      ? `Appelant : vérifier l'identité avant de mentionner l'immobilier.`
      : `Caller: verify it's them before mentioning real estate.`,
  );

  // Line 6: Confidence
  lines.push(fr ? `Confiance : ${v.label}.` : `Confidence: ${v.label}.`);

  // Line 7 (optional): What's interesting
  if (v.whatsInteresting) {
    lines.push(v.whatsInteresting);
  }

  return lines.join("\n");
}

// ── renderBriefingPhrased ─────────────────────────────────────────────────────

/**
 * Render the briefing template then optionally pass it through a Haiku phrasing
 * pass for more natural language.
 *
 * If ANTHROPIC_API_KEY is not set, or if the API call fails, falls back to the
 * raw template text silently (logs a warning).
 */
export async function renderBriefingPhrased(input: BriefingInput): Promise<string> {
  const templateText = renderBriefingTemplate(input);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return templateText;
  }

  // Resolve language for the system prompt
  const lang: "fr" | "en" =
    input.language === "fr" ? "fr" :
    input.language === "en" ? "en" :
    detectLanguage(input.owner.canonicalName);

  const langLabel = lang === "fr" ? "French (Quebec)" : "English (Canadian)";

  const systemPrompt =
    `Make this flow naturally in ${langLabel}. DO NOT add any facts not in the input. ` +
    `DO NOT omit any fact. Preserve numbers, names, addresses, NEQ, phones EXACTLY. ` +
    `Output only the briefing text, no preamble.`;

  try {
    const result = await callAnthropic({
      feature: "briefing",
      model: "claude-haiku-4-5-20251001",
      maxTokens: 2000,
      prompt: templateText,
      system: systemPrompt,
    });

    if (!result.ok || !result.text) {
      console.warn("[briefing] Haiku phrasing pass failed:", result.error ?? "empty response");
      return templateText;
    }

    return result.text.trim() || templateText;
  } catch (err) {
    console.warn("[briefing] Haiku phrasing pass threw:", err);
    return templateText;
  }
}

// ── Legacy public export (unchanged — callers: API route, queue worker) ───────

export async function generateBriefing(
  leadId: string,
  sb: SupabaseClient,
): Promise<{ text: string; metadata: Record<string, unknown> } | null> {
  // 1. Load lead with contacts + properties
  const { data: leadRaw, error: leadErr } = await sb
    .from("leads")
    .select(`
      id, status, contact_id, property_id,
      contacts ( full_name, company_name, kind, mailing_address, mailing_city, mailing_postal, primary_email ),
      properties ( address, city, num_units, evaluation_total, year_built, matricule )
    `)
    .eq("id", leadId)
    .single();

  if (leadErr || !leadRaw) {
    console.error("[briefing] lead fetch failed:", leadErr?.message);
    return null;
  }
  const lead = leadRaw as unknown as LeadRow;
  const contact = lead.contacts;
  const property = lead.properties;

  // 2. Load contact phones
  let phones: PhoneRow[] = [];
  if (lead.contact_id) {
    const { data: phonesData } = await sb
      .from("phones")
      .select("e164, status, source")
      .eq("contact_id", lead.contact_id)
      .order("confidence", { ascending: false })
      .limit(5);
    phones = (phonesData ?? []) as PhoneRow[];
  }

  // 3. Load most recent 10 enrichment events
  const { data: eventsData } = await sb
    .from("enrichment_events")
    .select("event_type, stage, payload, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(10);
  const events = (eventsData ?? []) as EnrichmentEventRow[];

  // 4. Load most recent 5 notes — attempt from leads.notes (text column),
  //    or from a notes table if it exists. We query leads.notes and also
  //    try the "notes" table silently (fail gracefully if absent).
  const { data: leadNoteRow } = await sb
    .from("leads")
    .select("notes")
    .eq("id", leadId)
    .single();
  const leadNotes = (leadNoteRow as { notes: string | null } | null)?.notes ?? null;

  // Also try a dedicated notes table (if it exists); ignore on error.
  let structuredNotes: NoteRow[] = [];
  try {
    const { data: notesData } = await sb
      .from("notes")
      .select("content, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(5);
    if (notesData && Array.isArray(notesData)) {
      structuredNotes = notesData as NoteRow[];
    }
  } catch {
    // notes table may not exist — skip silently
  }

  // 5. Load portfolio info (fire-and-forget friendly; gracefully returns zeros on error)
  let portfolioLine = "";
  if (lead.contact_id) {
    try {
      const portfolio = await getPortfolioInfo(lead.contact_id, sb);
      if (portfolio.propertyCount > 1) {
        const cities = [...new Set(portfolio.properties.map(p => p.city).filter(Boolean))];
        const cityList = cities.length > 0 ? cities.join(", ") : "diverses villes";
        portfolioLine = `- Portefeuille : propriétaire de ${portfolio.propertyCount} propriétés à travers ${cityList}`;
      }
    } catch {
      // getPortfolioInfo failure must never break briefing generation
    }
  }

  // 6. Build prompt
  const ownerName = contact?.full_name ?? contact?.company_name ?? "Propriétaire inconnu";
  const ownerKind = contact?.kind ?? "inconnu";
  const mailingAddr = [contact?.mailing_address, contact?.mailing_city, contact?.mailing_postal]
    .filter(Boolean).join(", ") || "inconnue";
  const propAddr = [property?.address, property?.city].filter(Boolean).join(", ") || "inconnue";
  const numUnits = property?.num_units ?? null;
  const evalTotal = property?.evaluation_total ?? null;
  const yearBuilt = property?.year_built ?? null;
  const matricule = property?.matricule ?? null;

  const phoneSummary = phones.length > 0
    ? phones.map(p => `${p.e164} (statut: ${p.status}, source: ${p.source})`).join("; ")
    : "aucun numéro trouvé";

  const recentEvents = events
    .slice(0, 5)
    .map(e => `${e.event_type}${e.stage ? ` [${e.stage}]` : ""}`)
    .join(", ") || "aucun événement récent";

  const notesBlock = [
    leadNotes ? `Notes internes : ${leadNotes.slice(0, 300)}` : "",
    ...structuredNotes.map(n => `Note : ${n.content.slice(0, 200)}`),
  ].filter(Boolean).join("\n");

  const prompt = `Tu es un assistant pour une équipe de prospection immobilière commerciale au Québec.
Rédige un briefing professionnel EN FRANÇAIS QUÉBÉCOIS pour le prospect suivant.

DONNÉES DU PROSPECT :
- Nom du propriétaire : ${ownerName}
- Type : ${ownerKind}
- Adresse postale : ${mailingAddr}
- Adresse de la propriété : ${propAddr}${numUnits ? ` · ${numUnits} logements` : ""}${evalTotal ? ` · évaluation municipale ${Math.round(evalTotal / 1000)}k$` : ""}${yearBuilt ? ` · construit en ${yearBuilt}` : ""}${matricule ? ` · matricule ${matricule}` : ""}
- Téléphones : ${phoneSummary}
- Statut du lead : ${lead.status}
- Événements récents : ${recentEvents}
${portfolioLine ? `${portfolioLine}` : ""}
${notesBlock ? `\n${notesBlock}` : ""}

CONSIGNES :
1. Rédige 2 à 3 phrases de briefing en français québécois, ton professionnel mais direct, comme si tu briefais un agent avant un appel.
2. Mentionne le nom du proprio, la ville, le nombre de logements et l'évaluation si disponibles.
3. Formule une hypothèse sur la motivation potentielle du vendeur (durée de détention, type d'entité, etc.).
4. Termine par UNE question d'amorce suggérée pour débuter la conversation, précédée d'une ligne vide et du label "Question suggérée :".

Exemple de ton attendu : "Marie Tremblay, ~64 ans, propriétaire depuis 2007 d'un complexe de 14 logements à Granby — longue détention suggère une vente liée à la retraite. La propriété est détenue en nom personnel (pas d'Inc), évaluation municipale à 2,1 M$. Aucun antécédent de mise en marché public.\n\nQuestion suggérée : Madame Tremblay, ça fait un bon moment que vous gérez ces immeubles à Granby — est-ce que vous avez déjà pensé à vous décharger d'une partie de votre portefeuille ?"

Réponds UNIQUEMENT avec le briefing (pas de JSON, pas de balises, pas de titre).`;

  const promptInputs = {
    leadId,
    ownerName,
    ownerKind,
    mailingAddr,
    propAddr,
    numUnits,
    evalTotal,
    yearBuilt,
    phonesCount: phones.length,
    eventsCount: events.length,
  };

  // 7. Call Haiku
  const result = await callAnthropic({
    feature: "briefing",
    model: "claude-haiku-4-5",
    maxTokens: 600,
    prompt,
    leadId,
    metadata: { promptInputs },
  });

  if (!result.ok || !result.text) {
    console.error("[briefing] callAnthropic failed:", result.error);
    return null;
  }

  const text = result.text.trim();
  if (!text) return null;

  // 8. Return text + metadata
  return {
    text,
    metadata: {
      promptInputs,
      generatedAt: new Date().toISOString(),
      usageLogId: result.usageLogId ?? null,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    },
  };
}
