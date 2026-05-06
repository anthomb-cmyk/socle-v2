// Briefing module — generates a per-lead AI context card for the calling team.
//
// The generated text is a 2–3 sentence French briefing in Quebec real-estate
// prospecting tone, summarising the owner profile, property, and suggested
// opening question for the caller.
//
// All Anthropic calls go through lib/llm/anthropic-client.ts so cost is
// automatically tracked in llm_usage_log.

import type { SupabaseClient } from "@supabase/supabase-js";
import { callAnthropic } from "@/lib/llm/anthropic-client";
import { getPortfolioInfo } from "@/lib/portfolio/detector";

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Public export ────────────────────────────────────────────────────────────

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
