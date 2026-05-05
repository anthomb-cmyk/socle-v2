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

const SYSTEM = `Tu es un assistant pour un CRM immobilier québécois (acquisitions multi-logements).
Pour chaque candidat téléphone, donne UN VERDICT opinioné au réviseur. Pas de description neutre — dis-lui quoi faire.

Format de sortie EXACT: "<verdict> <raison>"
- verdict = "✓" si à approuver, "✗" si à refuser, "?" si à vérifier manuellement
- raison = UNE phrase française de max 12 mots, qui dit POURQUOI approuver/refuser/vérifier

Règles de verdict:
- ✓ Approuver si: openclaw_verdict=likely_match ET confiance ≥ 70, OU nom proprio + adresse postale concordent fortement, OU annuaire public confirme le proprio.
- ✗ Refuser si: openclaw_verdict=unlikely_match, OU confiance < 25, OU signaux d'erreur clairs (fax, locataire probable, résidence pour aînés, nom complètement différent).
- ? Vérifier sinon: adresse seule sans nom, code postal/ville seulement, source ambiguë, données incohérentes.

Exemples bons:
- "✓ Nom et adresse postale concordent — approuver"
- "✓ Annuaire public confirme le proprio — approuver"
- "✗ Fax de résidence pour aînés, pas le proprio — refuser"
- "✗ OpenClaw rejette, nom différent — refuser"
- "✗ Confiance trop faible (15%) — refuser"
- "? Adresse correspond mais nom non confirmé — vérifier"
- "? Code postal seulement, lien faible — vérifier"

Mauvais (à éviter):
- "residencessoleil.ca — adresse postale correspond" (juste descriptif, pas de verdict)
- "Confiance modérée" (vague, n'aide pas le réviseur)

Retourne uniquement du JSON valide: {"<id>": "<verdict> <raison>", ...}`;

type CandidateInput = {
  id: string;
  ownerName: string;
  address: string;
  phone: string;
  candidateName: string | null;
  candidateAddress: string | null;
  sourceUrl: string | null;
  snippet: string | null;
  reviewReason: string | null;
  openclawEvidence: string | null;
  openclawVerdict: string | null;
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

  // Build a compact per-candidate description (one line each)
  const lines = candidates.map((c) => {
    const parts: string[] = [`[${c.id}]`];
    parts.push(`Proprio: ${c.ownerName}`);
    parts.push(`Prop: ${c.address}`);
    parts.push(`Tél: ${c.phone} (${c.confidence}%)`);
    if (c.candidateName)    parts.push(`Nom source: ${c.candidateName}`);
    if (c.candidateAddress) parts.push(`Adr source: ${c.candidateAddress}`);
    if (c.sourceUrl)        parts.push(`URL: ${new URL(c.sourceUrl).hostname}`);
    if (c.openclawEvidence) parts.push(`Preuve: ${c.openclawEvidence.slice(0, 120)}`);
    else if (c.snippet)     parts.push(`Extrait: ${c.snippet.slice(0, 100)}`);
    if (c.openclawVerdict)  parts.push(`Verdict: ${c.openclawVerdict}`);
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
      temperature: 0.25,
      max_tokens: Math.min(candidates.length * 35 + 150, 4096),
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const summaries = JSON.parse(raw) as Record<string, string>;
    return NextResponse.json({ summaries });
  } catch (err) {
    console.error("[phone-review/summaries] OpenAI error:", err);
    return NextResponse.json({ summaries: {} });
  }
}
