// POST /api/phone-review/summaries
// Body: { candidates: CandidateInput[] }
// Returns: { summaries: Record<string, string> }
//
// Calls GPT-4o-mini once with all candidates in a batch.
// Returns a one-line French summary for each candidate explaining
// why it came up for manual review — shown directly on the list row.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 30;

const SYSTEM = `Tu es un assistant pour un CRM immobilier québécois (acquisitions multi-logements). Le réviseur doit décider en 5 secondes par ligne.

TA TÂCHE: pour chaque candidat, identifie LE SIGNAL SPÉCIFIQUE et LE TYPE DE SOURCE qui expliquent pourquoi le juge IA/pipeline n'a pas auto-attaché ce numéro, puis donne UN VERDICT opinioné. Le réviseur veut savoir EXACTEMENT d'où vient le numéro et ce qui manque, pas une description neutre.

Format EXACT: "<verdict> <raison>"
- verdict = "✓" (approuver), "✗" (refuser), ou "?" (vérifier manuellement)
- raison = UNE phrase française ≤ 14 mots, qui pointe LE SIGNAL spécifique (pas un résumé vague)

CHERCHE CES SIGNAUX EN PRIORITÉ (lis le snippet/preuve mot par mot):
0. source_label=cross_property → source interne CRM: numéro déjà vu sur un autre contact/propriété du même nom. Ne dis jamais "Brave" ou "web" pour ce cas → ?
1. Le snippet contient "Fax:", "Télécopieur", ou ce numéro est listé comme fax → FAX détecté → ✗
2. Le snippet/candidate_address mentionne "résidence", "CHSLD", "RPA", "manoir", "centre" → établissement → ✗
3. candidate_name a un nom de famille COMPLÈTEMENT différent du proprio → nom étranger → ✗
4. matched_on=postal_prefix → seulement le code postal correspond, pas l'adresse → ?
5. matched_on=city → seulement la ville correspond → ?
6. matched_on=mailing_address ET nom proprio visible dans snippet → forte concordance → ✓
7. URL est un annuaire public (canada411, 411.ca, pagesjaunes, b2bhint, registre.ccq) → annuaire → ✓ si nom concorde, ? sinon
8. URL semble commerciale/non-liée et nom proprio absent → tiers → ✗ ou ?
9. Plusieurs numéros différents pour la même propriété → ambiguïté → ?
10. source_label=req_address_lookup + administrateur REQ correspond à un co-propriétaire → lien REQ + admin; téléphone via URL/source affichée → ?
11. source_label=req_address_lookup sans admin co-proprio visible → lien REQ entité/adresse; téléphone via URL/source affichée → ?
12. source_label=company_website ou pages_jaunes_business → source entreprise: approuver seulement si l'entreprise appartient au proprio → ?

INTERDICTIONS STRICTES:
- ❌ JAMAIS dire que REQ est la source du téléphone sauf si l'URL/snippet prouve clairement que le numéro est listé là. REQ = lien propriétaire/entité.
- ❌ JAMAIS dire "OpenClaw" pour openclaw_verdict/openclaw_reasoning; dans le pipeline actuel, appelle ça "juge IA".
- ❌ JAMAIS "vérification nécessaire/requise" sans préciser le signal AVANT
- ❌ JAMAIS "concordants" / "non concordants" sans préciser QUOI (nom? adresse? code postal?)
- ❌ JAMAIS "numéro suspect" / "confiance faible/modérée" sans dire POURQUOI
- ❌ JAMAIS "à vérifier manuellement" comme raison — la raison doit être le signal, pas l'action

Exemples bons (signal spécifique extrait des données):
- "✗ Marqué 'Fax:' dans la source hcq-chq.org — refuser"
- "✗ Résidence pour aînés, ce n'est pas le proprio — refuser"
- "✗ Nom source 'Trottier' ≠ proprio 'Amselem' — refuser"
- "✓ Canada411 confirme Tremblay au 142 Denison — approuver"
- "✓ Adresse postale exacte + nom proprio dans snippet — approuver"
- "? Code postal H3G1J1 seul, nom absent du snippet — vérifier"
- "? Site corporate, aucun lien direct au proprio — vérifier"
- "? Deux numéros différents pour cette propriété — comparer"
- "? Source CRM déjà vue pour André Barnabe — comparer"
- "? Lien REQ admin; tél. via canada411.ca — vérifier"
- "? Lien REQ entité; source tél. absente — vérifier"

Exemples mauvais (à NE PAS reproduire):
- "Numéros de téléphone différents, vérification nécessaire" (quel signal? lequel rejeter?)
- "Nom et adresse postale non concordants" (lequel est faux? le nom ou l'adresse?)
- "Numéro de téléphone suspect" (suspect comment?)
- "Confiance modérée — vérifier" (le réviseur ne sait toujours pas quoi faire)

Retourne UNIQUEMENT du JSON valide: {"<id>": "<verdict> <raison>", ...}`;

type CandidateInput = {
  id: string;
  ownerName: string;
  address: string;
  phone: string;
  candidateName: string | null;
  candidateAddress: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  snippet: string | null;
  reviewReason: string | null;
  openclawEvidence: string | null;
  openclawVerdict: string | null;
  openclawReasoning: string | null;
  matchedOn: string | null;
  coOwnerNames?: string[];
  reqDirectorNames?: string[];
  confidence: number;
};

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({})) as { candidates?: CandidateInput[] };
  const candidates = body.candidates ?? [];
  if (candidates.length === 0) return NextResponse.json({ summaries: {} });

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ summaries: {} });

  const openai = new OpenAI({ apiKey });

  // Build a per-candidate dossier the model can mine for SPECIFIC signals.
  // Snippets/evidence are kept long (300 chars) so labels like "Fax:" survive.
  const lines = candidates.map((c) => {
    const parts: string[] = [`[${c.id}]`];
    parts.push(`Proprio: ${c.ownerName}`);
    parts.push(`Prop: ${c.address}`);
    parts.push(`Tél candidat: ${c.phone} (confiance ${c.confidence}%)`);
    if (c.sourceLabel)       parts.push(`Source technique: ${c.sourceLabel}`);
    if (c.matchedOn)        parts.push(`Type de match: ${c.matchedOn}`);
    if (c.coOwnerNames?.length) parts.push(`Tous propriétaires liés: ${c.coOwnerNames.join("; ")}`);
    if (c.reqDirectorNames?.length) parts.push(`Administrateurs REQ: ${c.reqDirectorNames.join("; ")}`);
    if (c.candidateName)    parts.push(`Nom dans source: "${c.candidateName}"`);
    if (c.candidateAddress) parts.push(`Adresse dans source: "${c.candidateAddress}"`);
    if (c.sourceUrl) {
      try { parts.push(`URL: ${new URL(c.sourceUrl).hostname}`); } catch { /* ignore */ }
    }
    if (c.openclawEvidence) parts.push(`Preuve juge IA: "${c.openclawEvidence.slice(0, 300)}"`);
    if (c.snippet)          parts.push(`Snippet: "${c.snippet.slice(0, 300)}"`);
    if (c.openclawVerdict)  parts.push(`Verdict juge IA: ${c.openclawVerdict}`);
    if (c.openclawReasoning) parts.push(`Raisonnement juge IA: "${c.openclawReasoning.slice(0, 200)}"`);
    if (c.reviewReason)     parts.push(`Raison de revue: ${c.reviewReason}`);
    return parts.join(" | ");
  });

  const userMsg = `Génère une phrase par candidat (JSON):\n\n${lines.join("\n")}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user",   content: userMsg },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: Math.min(candidates.length * 50 + 200, 8192),
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const summaries = JSON.parse(raw) as Record<string, string>;
    return NextResponse.json({ summaries });
  } catch (err) {
    console.error("[phone-review/summaries] OpenAI error:", err);
    return NextResponse.json({ summaries: {} });
  }
}
