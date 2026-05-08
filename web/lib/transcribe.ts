// Whisper transcription helpers for Twilio call recordings.
//
// Ported from V1 server.js: transcribeTwilioRecording() +
// stripWhisperHallucinations().
//
// Required env vars:
//   OPENAI_API_KEY             — standard OpenAI key
//   OPENAI_TRANSCRIPTION_MODEL — defaults to "whisper-1"

import OpenAI, { toFile } from "openai";
import { twilioBasicAuth, getTwilioConfig } from "./twilio";

function getOpenAIClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY non configuré.");
  return new OpenAI({ apiKey: key });
}

const TRANSCRIPTION_MODEL =
  process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "whisper-1";

// ── Whisper hallucination patterns ───────────────────────────────────────────
//
// When Whisper receives silent/near-silent/unintelligible audio it returns
// memorised subtitle boilerplate instead of an empty string. Strip it before
// persisting to the CRM.
const HALLUCINATION_PATTERNS: RegExp[] = [
  // Amara.org subtitle credits
  /sous[-\s]?titres?\s+(?:réalis[eé]e?s?|cr[eé]{1,2}e?s?|effectu[eé]s?)\s+(?:par|para)\s+(?:la\s+)?(?:communaut[eé]\s+)?d[''`´]?amara\.?\s*\.?\s*org\.?/gi,
  /\bamara\.?\s*\.?\s*org\b/gi,
  // French broadcaster captioning stamps
  /sous[-\s]?titrage\s+(?:soci[eé]t[eé]\s+)?radio[-\s]?canada/gi,
  /sous[-\s]?titrage\s+st['']?\s*\d+/gi,
  /sous[-\s]?titr(?:age|es?)\s*[:\-]\s*[^\n]{0,40}$/gi,
  // YouTube end-screen boilerplate (EN + FR)
  /thanks?\s+for\s+watching/gi,
  /(?:please\s+)?(?:like\s+(?:and|&)\s+)?subscribe(?:\s+to\s+(?:my|our|the)\s+channel)?/gi,
  /don'?t\s+forget\s+to\s+(?:like\s+(?:and|&)\s+)?subscribe/gi,
  /merci\s+d'avoir\s+(?:regard[eé]|visionn[eé]|[eé]cout[eé])(?:\s+(?:cette|ma|notre|la|ce|mon|mes|nos|leur)\s+(?:vid[eé]o|cha[iî]ne|contenu|[eé]pisode|podcast))?(?:\s+jusqu[''`´]au\s+bout)?/gi,
  /abonnez[-\s]vous\s+(?:[aà]\s+(?:ma|notre)\s+cha[iî]ne)?/gi,
  // Music / silence markers
  /\[?\s*(?:music|musique|applause|applaudissements|silence|background\s+noise)\s*\]?/gi,
  // Whisper prompt-regurgitation: when audio is unclear, Whisper sometimes
  // echoes the context prompt back as the transcription instead of empty.
  // Strip the prompt phrases we feed Whisper so they never leak through.
  /transcrire\s+chaque\s+mot\s+dans\s+sa\s+langue\s+d['']origine\.?/gi,
  /conversation\s+t[eé]l[eé]phonique\s+bilingue.*?propri[eé]taire\.?/gi,
  /termes?\s+fr[eé]quents?\s*:.*$/gim,
];

export function stripWhisperHallucinations(rawText: string): string {
  if (!rawText) return "";
  const original = rawText.trim();
  if (!original) return "";

  let out = original;
  for (const pat of HALLUCINATION_PATTERNS) {
    out = out.replace(pat, " ");
  }
  // Collapse whitespace left by removals
  out = out.replace(/\s+/g, " ").trim();
  // Remove orphan punctuation
  out = out.replace(/\s+([.!?…])/g, "$1");
  out = out.replace(/([.!?…])\s*([.!?…])+/g, "$1");
  out = out.replace(/^[\s,;:.\-!?…]+/, "").replace(/[\s,;:\-]+$/, "").trim();

  if (!out || out.length < 3) return "";
  // If we stripped >80% of the original text it was almost pure boilerplate
  if (out.length < original.length * 0.2) return "";

  return out;
}

/**
 * Downloads a Twilio recording MP3 (auth-required) and sends it to Whisper.
 * Returns the cleaned transcript string (may be "" if no speech detected).
 *
 * The `recordingUrl` is the bare URL from Twilio's webhook — this function
 * appends .mp3 if not already present, because Twilio requires the extension
 * to serve the correct codec.
 */
export async function transcribeTwilioRecording(
  recordingUrl: string,
  recordingSid: string,
): Promise<string> {
  const openai = getOpenAIClient();
  const { accountSid, authToken } = getTwilioConfig();

  const mediaUrl = /\.(mp3|wav)$/i.test(recordingUrl)
    ? recordingUrl
    : `${recordingUrl}.mp3`;

  const audioRes = await fetch(mediaUrl, {
    headers: { Authorization: twilioBasicAuth(accountSid, authToken) },
  });
  if (!audioRes.ok) {
    throw new Error(`Impossible de télécharger l'enregistrement Twilio (${audioRes.status}).`);
  }

  const buffer = Buffer.from(await audioRes.arrayBuffer());
  const file = await toFile(buffer, `${recordingSid || "call-recording"}.mp3`, {
    type: "audio/mpeg",
  });

  // No hard language hint — Quebec calls code-switch FR↔EN within sentences.
  // Forcing "fr" garbles English words. We bias Whisper via a vocabulary-only
  // prompt (no instructions like "transcribe each word..." — Whisper tends to
  // echo such instructions back as the transcription when audio is unclear).
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: TRANSCRIPTION_MODEL,
    prompt:
      "SOCLE Acquisitions Longueuil Montréal Laval Saint-Hyacinthe Victoriaville Waterloo " +
      "triplex quadruplex plex condo immeuble logement loyer locataire propriétaire " +
      "cap rate deal closing walk-through offre d'achat promesse d'achat hypothèque bail " +
      "chauffage rénovation toit fenêtres balcon évaluation municipale matricule",
  });

  return stripWhisperHallucinations(transcription.text ?? "");
}
