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

const SYSTEM = `Tu es un assistant pour un CRM immobilier québécois.
Pour chaque candidat téléphone, génère UNE courte phrase française (max 12 mots) expliquant pourquoi ce numéro nécessite une vérification manuelle.
Sois direct, concret, utile. Met en évidence ce qui cloche OU ce qui confirme.

Exemples bons:
- "Numéro de fax d'une résidence pour aînés, pas le propriétaire"
- "Nom et adresse postale correspondent — confiance modérée"
- "Site d'entreprise commerciale, lien avec le proprio non confirmé"
- "Trouvé via adresse de correspondance, nom non vérifié"
- "Doublon probable — même numéro que le candidat précédent"
- "OpenClaw incertain : adresse correspond mais nom différent"

Retourne uniquement du JSON valide: {"<id>": "<phrase>", ...}`;

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
