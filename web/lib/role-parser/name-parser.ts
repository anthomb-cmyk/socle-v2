// Name parser (v3 import redesign).
//
// Replaces the primitive whitespace splitter in format-a.ts and format-b.ts.
// Handles:
//   - Inverted prénom/nom columns: "TREMBLAY" in Prénom and "Jean" in Nom
//     → swap, set name_was_inverted = true.
//   - Middle names sitting in the prénom column: "Marius Ioan" + "Boitiu"
//     → first_name = "Marius", last_name = "Ioan Boitiu",
//       middle_names = ["Ioan"], parse_quality = "middle_moved".
//   - Compound French given names (with or without hyphen): "Jean-Pascal",
//     "Marie Claire" → keep as a single first_name.
//   - Comma-form: "Tremblay, Jean" → last="Tremblay", first="Jean".
//   - Single-token: "Lapointe" → last only, parse_quality = "single_token".
//
// The parser is deterministic. It uses the bundled given-names list from
// given-names.ts as the inversion oracle. False positives on inversion are
// the failure mode we work hardest to avoid; when in doubt the parser leaves
// the name as-is and reports parse_quality = "ambiguous".

import type { NameParseQuality } from "./types";
import { isKnownGivenName, isLikelyGivenName, isLikelyCompoundGivenName } from "./given-names";

export interface NameParseInput {
  /** Single full-name field (e.g. "Tremblay, Jean" or "Jean Tremblay") */
  fullName?: string | null;
  /** Optional separate prénom field (when the source has both columns) */
  prenomField?: string | null;
  /** Optional separate nom field (when the source has both columns) */
  nomField?: string | null;
}

export interface NameParseOutput {
  firstName: string | null;
  lastName: string | null;
  middleNames: string[];
  fullName: string | null;
  /** True iff the input had prénom/nom columns and we swapped them. */
  wasInverted: boolean;
  parseQuality: NameParseQuality;
  /** Audit notes (free text) — surfaced in import_row_audits.warnings. */
  notes: string[];
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function titleCase(s: string): string {
  if (!s) return s;
  // Title-case every Unicode letter cluster after start, space, hyphen, or apostrophe.
  return s.toLowerCase().replace(/(^|\s|-|')(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/** Detect whether the value looks like a SURNAME (heuristic). Used to flag
 *  inversions: if both halves are clearly tagged, decide which is which. */
function looksLikeSurname(value: string): boolean {
  if (!value) return false;
  const folded = fold(value);
  if (!folded) return false;
  // All caps in the source (common for surnames in role exports) is a hint.
  // We can't see source casing here (we already lowercased in fold), so this
  // is best-effort; the real signal is "this is NOT in our given-name list".
  if (isKnownGivenName(folded)) return false;
  if (isLikelyCompoundGivenName(value)) return false;
  // Multi-token without compound-prénom shape → likely a multi-word surname.
  return true;
}

/** Parse a SINGLE full-name string. */
function parseFullName(full: string): NameParseOutput {
  const t = full.trim();
  if (!t) return emptyOutput("unparseable");

  // Form 1: "Last, First [Middle]"
  const comma = t.split(/,\s*/);
  if (comma.length === 2) {
    const last = titleCase(comma[0].trim());
    const firstAndMiddle = comma[1].trim();
    const tokens = firstAndMiddle.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return emptyOutput("unparseable");
    if (tokens.length === 1) {
      return ok(tokens[0], last, [], full, false, "complete");
    }
    // Compound prénom (with hyphen or known compound): keep as single first.
    const joined2 = `${tokens[0]} ${tokens[1]}`;
    if (isLikelyCompoundGivenName(joined2)) {
      const middle = tokens.slice(2);
      return ok(joined2, last, middle, full, false, middle.length ? "middle_moved" : "complete");
    }
    // Otherwise first = first token, rest go to middle (which we prepend to nom).
    const middle = tokens.slice(1);
    const newLast = [...middle, last].join(" ");
    return ok(tokens[0], newLast, middle, full, false, middle.length ? "middle_moved" : "complete");
  }

  // Form 2: "First [Middle] Last [Last2 Last3]"
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return emptyOutput("unparseable");
  if (parts.length === 1) {
    return ok(null, titleCase(parts[0]), [], full, false, "single_token");
  }

  // Compound prénom in front: "Marie Claire Tremblay" → first="Marie Claire", last="Tremblay"
  const joined12 = `${parts[0]} ${parts[1]}`;
  if (isLikelyCompoundGivenName(joined12)) {
    const first = joined12;
    const rest = parts.slice(2);
    if (rest.length === 0) return ok(first, null, [], full, false, "complete");
    return ok(first, rest.join(" "), [], full, false, "complete");
  }

  // Hyphenated compound prénom → already a single token.
  // Default: first = parts[0], last = rest joined.
  return ok(parts[0], parts.slice(1).join(" "), [], full, false, "complete");
}

/** Parse separate prénom + nom fields (Format B Longueuil). */
export function parseNameFromFields(input: NameParseInput): NameParseOutput {
  const prenom = (input.prenomField ?? "").trim();
  const nom = (input.nomField ?? "").trim();

  // No separate columns → fall back to full-name parser.
  if (!prenom && !nom) {
    if (!input.fullName) return emptyOutput("unparseable");
    return parseFullName(input.fullName);
  }

  // Only one of the two filled → treat as a full-name string in the populated field.
  if (!prenom && nom) {
    // Maybe nom is actually "First Last" (sometimes the prénom column is empty
    // and the full name landed in nom). Send to full-name parser.
    return parseFullName(nom);
  }
  if (prenom && !nom) {
    return parseFullName(prenom);
  }

  // Both present. This is where inversion detection lives.
  const prenomLooksGiven = isLikelyGivenName(prenom) || isLikelyCompoundGivenName(prenom);
  const nomLooksGiven    = isLikelyGivenName(nom);
  const prenomLooksSur   = looksLikeSurname(prenom);

  // Strong inversion signal: prénom looks like a surname AND nom looks like a given name.
  if (!prenomLooksGiven && nomLooksGiven && prenomLooksSur) {
    // Swap, then re-process middle names.
    const corrected = parseFullName(`${nom} ${prenom}`);
    return {
      ...corrected,
      wasInverted: true,
      parseQuality: corrected.parseQuality === "complete" ? "inverted_corrected" : corrected.parseQuality,
      notes: [...corrected.notes, `Inversion detected: prénom "${prenom}" looked like a surname, nom "${nom}" looked like a given name`],
    };
  }

  // Middle-name in prénom: "Marius Ioan" + "Boitiu" → first="Marius", middle=["Ioan"], last="Ioan Boitiu".
  const prenomTokens = prenom.split(/\s+/).filter(Boolean);
  if (prenomTokens.length >= 2) {
    // Compound prénom — leave intact.
    if (isLikelyCompoundGivenName(prenom)) {
      return ok(titleCase(prenom), titleCase(nom), [], `${prenom} ${nom}`, false, "complete");
    }
    // First token is a known given name; the rest are middle names → move to nom.
    if (isKnownGivenName(fold(prenomTokens[0]))) {
      const first = prenomTokens[0];
      const middle = prenomTokens.slice(1);
      const newLast = [...middle, nom].join(" ");
      return ok(titleCase(first), titleCase(newLast), middle, `${first} ${newLast}`, false, "middle_moved");
    }
    // Ambiguous — leave as-is and flag.
    return {
      firstName: titleCase(prenom),
      lastName: titleCase(nom),
      middleNames: [],
      fullName: `${titleCase(prenom)} ${titleCase(nom)}`,
      wasInverted: false,
      parseQuality: "ambiguous",
      notes: [`Prénom "${prenom}" has multiple tokens but no recognized given-name prefix; left as-is`],
    };
  }

  // Standard case: prénom is a single token, nom is one or more tokens.
  return ok(titleCase(prenom), titleCase(nom), [], `${prenom} ${nom}`, false, "complete");
}

/** Public single-name entry point — used when only a full-name string is available. */
export function parseFullNameOnly(full: string | null | undefined): NameParseOutput {
  if (!full || !full.trim()) return emptyOutput("unparseable");
  return parseFullName(full);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ok(
  first: string | null,
  last: string | null,
  middleNames: string[],
  fullName: string,
  wasInverted: boolean,
  parseQuality: NameParseQuality,
): NameParseOutput {
  return {
    firstName: first ? titleCase(first) : null,
    lastName: last ? titleCase(last) : null,
    middleNames,
    fullName: fullName ? titleCase(fullName) : null,
    wasInverted,
    parseQuality,
    notes: [],
  };
}

function emptyOutput(parseQuality: NameParseQuality): NameParseOutput {
  return { firstName: null, lastName: null, middleNames: [], fullName: null, wasInverted: false, parseQuality, notes: [] };
}
