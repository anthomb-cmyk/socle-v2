import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 20;

const Body = z.object({
  message: z.string().min(1).max(1000),
  recipientName: z.string().nullable().optional(),
  context: z.string().nullable().optional(),
});

const SYSTEM = `Tu es le correcteur SMS intégré au CRM Socle.

Ta tâche: corriger seulement les fautes évidentes dans un texto en français québécois, sans réécrire inutilement.

Règles strictes:
- Garde le sens, le ton, le niveau de familiarité et les mots d'origine autant que possible.
- Corrige l'orthographe, les accords, les accents utiles, la ponctuation et les apostrophes.
- Ne rends pas le message plus corporatif, plus long ou plus vendeur.
- Ne remplace pas les mots familiers naturels ("jaser", "texto", "t'es", "ça") si ce n'est pas nécessaire.
- Ne rajoute pas de salutation, signature, emoji, explication ou guillemets.
- Si le message est déjà correct, retourne exactement le même texte.
- Retourne uniquement le texto corrigé.`;

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Message invalide." }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "OPENAI_API_KEY non configuré sur le serveur." }, { status: 503 });
  }

  const { message, recipientName, context } = parsed.data;
  const openai = new OpenAI({ apiKey });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 350,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            recipientName ? `Destinataire: ${recipientName}` : null,
            context ? `Contexte: ${context}` : null,
            `Texto original:\n${message}`,
          ].filter(Boolean).join("\n\n"),
        },
      ],
    });

    const corrected = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!corrected) {
      return NextResponse.json({ ok: false, error: "Le correcteur n'a pas retourné de texte." }, { status: 502 });
    }

    return NextResponse.json({ ok: true, corrected });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur OpenAI inconnue.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
