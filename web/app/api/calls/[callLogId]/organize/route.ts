// POST /api/calls/[callLogId]/organize
//
// Uses GPT-4o-mini to parse a call transcript and return structured notes:
//   seller_name, intent_level, objections[], asking_price, next_steps[], summary
//
// Returns: { ok: true, data: { ... } }

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import OpenAI from "openai";

const SYSTEM_PROMPT = `Tu es un assistant CRM pour une firme d'acquisition immobilière au Québec.
On t'envoie la transcription brute d'un appel téléphonique entre un appelant (caller) et un propriétaire immobilier.

Retourne UNIQUEMENT un objet JSON valide avec ces champs :
{
  "seller_name": "Prénom Nom ou null",
  "intent_level": "cold" | "warm" | "hot" | "very_hot" | "not_interested",
  "asking_price": 1500000 ou null (nombre, pas de symbole $),
  "objections": ["liste des objections mentionnées"],
  "next_steps": ["liste d'actions concrètes suggérées"],
  "summary": "Résumé en 2-3 phrases pour Anthony"
}

Règles :
- intent_level "hot" ou "very_hot" si le propriétaire parle de vendre sérieusement ou demande une offre.
- asking_price = null si non mentionné.
- objections vides si aucune.
- next_steps concrets (ex: "Envoyer une offre d'ici vendredi", "Rappeler en septembre").
- Réponds UNIQUEMENT avec le JSON, sans markdown, sans backticks.`;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ callLogId: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { callLogId } = await ctx.params;
  const sb = createSupabaseAdminClient();

  // Fetch the call log
  const { data: log } = await sb
    .from("call_logs")
    .select("id, transcript, transcript_status, lead_id")
    .eq("id", callLogId)
    .single();

  if (!log) return NextResponse.json({ ok: false, error: "Call log not found" }, { status: 404 });
  if (!log.transcript?.trim()) {
    return NextResponse.json({ ok: false, error: "No transcript available. Request a transcription first." }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "OPENAI_API_KEY not configured" }, { status: 503 });
  }

  const openai = new OpenAI({ apiKey });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 800,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Transcription de l'appel :\n\n${log.transcript.slice(0, 8000)}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";

    // Parse JSON — strip any accidental markdown fences
    const cleaned = raw.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
    let organized: Record<string, unknown>;
    try {
      organized = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({
        ok: false,
        error: "GPT returned invalid JSON",
        raw,
      }, { status: 502 });
    }

    // Persist organized notes back to call_log as a JSON column (stored in payload field of automation_events)
    await sb.from("automation_events").insert({
      source: "web_app",
      event_type: "transcript_organized",
      status: "success",
      related_lead_id: log.lead_id,
      triggered_by: auth.user.id,
      payload: { callLogId, organized },
    });

    // Also persist in call_logs notes if notes is currently empty
    // We'll store the summary as a note addendum
    const { data: existing } = await sb.from("call_logs").select("notes").eq("id", callLogId).single();
    const currentNotes = (existing?.notes ?? "").trim();
    const summaryNote = `[AI] ${(organized.summary as string) ?? ""}`;
    if (!currentNotes.includes("[AI]")) {
      const newNotes = currentNotes ? `${currentNotes}\n\n${summaryNote}` : summaryNote;
      await sb.from("call_logs").update({ notes: newNotes }).eq("id", callLogId);
    }

    return NextResponse.json({ ok: true, data: organized });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}
