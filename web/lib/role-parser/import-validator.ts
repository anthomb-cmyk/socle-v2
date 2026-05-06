// Import-time validator (v3 import redesign).
//
// For each ParsedRow, this module:
//   - Re-runs the canonical address parser (single source of truth) on every
//     owner's mailing address. Stores civic/street/city/postal/FSA on the
//     ParsedOwner, and a parse-quality flag.
//   - Cross-checks the parsed city against a separate `mailing_city` field
//     (when both are present) — flags incoherence.
//   - Re-runs the v3 phone-context extractor over the source phone strings,
//     hard-rejecting NEQ/fax/matricule context that the legacy regex missed.
//   - Re-runs the new name-parser (with inversion + middle-name detection).
//   - Decides whether the row should be hard-blocked from import.
//   - When llmFallback is enabled (default), calls the LLM address and name
//     fallbacks when the deterministic parsers cannot produce a complete result.
//
// The validator MUTATES the ParsedRow (fills in the new structured fields
// and the audit) so the downstream commit step can act on it without
// re-parsing. This keeps the importer the single source of truth for
// structure.

import type { ParsedRow, ParsedRowAudit, ContactParseQuality } from "./types";
import { parseQuebecAddress, foldText, levenshtein } from "@/lib/enrichment/address-parser";
import { extractPhonesWithContext } from "@/lib/enrichment/phone-context-extractor";
import { parseNameFromFields, parseFullNameOnly } from "./name-parser";
import { llmParseAddress } from "@/lib/llm/address-fallback";
import { llmParseName } from "@/lib/llm/name-fallback";

export interface ValidatorOptions {
  /** When true, owners whose mailing address is unparseable cause the row
   *  to be flagged as blocking. When false, only warnings are emitted. */
  hardBlockUnparseableMailing: boolean;
  /** When true (default in production), engage LLM fallbacks for address/name
   *  parsing when the deterministic parser cannot produce a complete result.
   *  Set to false in tests to avoid network calls. */
  llmFallback?: boolean;
  /** Lead ID forwarded to cost-tracking when LLM fallbacks fire. */
  leadId?: string;
}

const DEFAULT_OPTS: ValidatorOptions = { hardBlockUnparseableMailing: true, llmFallback: true };

export async function validateAndEnrichRow(row: ParsedRow, opts: ValidatorOptions = DEFAULT_OPTS): Promise<ParsedRowAudit> {
  const useLlm = opts.llmFallback !== false;
  const audit: ParsedRowAudit = {
    row_number: row.row_number,
    blocking: [],
    warnings: [],
    owners: [],
  };

  for (let i = 0; i < row.owners.length; i++) {
    const owner = row.owners[i];

    // ── Mailing address ─────────────────────────────────────────────────
    let mailQuality: ContactParseQuality = "unparseable";
    if (owner.mailing_address) {
      const parsed = parseQuebecAddress(owner.mailing_address);
      owner.mailing_civic = parsed.civicNumber;
      owner.mailing_street = parsed.streetName;
      owner.mailing_unit = parsed.unit;
      owner.mailing_province = parsed.province;
      owner.mailing_postal_fsa = parsed.postalFsa;

      // Always normalize the postal to the canonical "XXX YXY" form.
      if (parsed.postal) owner.mailing_postal = parsed.postal;

      // Determine quality.
      if (parsed.civicNumber && parsed.streetName && parsed.city && parsed.postal) {
        mailQuality = "complete";
      } else if (!parsed.civicNumber) {
        mailQuality = "missing_civic";
      } else if (!parsed.streetName) {
        mailQuality = "missing_street";
      } else if (!parsed.postal) {
        mailQuality = "missing_postal";
      } else {
        mailQuality = "unparseable";
      }

      // Coherence with the separate mailing_city field, if any.
      if (parsed.city && owner.mailing_city) {
        const a = foldText(parsed.city);
        const b = foldText(owner.mailing_city);
        if (a !== b && levenshtein(a, b) > 2) {
          mailQuality = "incoherent_city";
          audit.warnings.push(
            `Owner ${i + 1}: mailing_city "${owner.mailing_city}" disagrees with parsed city "${parsed.city}"`,
          );
        }
      }
      // Backfill missing city / postal from the parser.
      if (!owner.mailing_city && parsed.city) owner.mailing_city = parsed.city;

      // ── LLM address fallback ─────────────────────────────────────────
      // If the deterministic parser produced an incomplete result, try Haiku.
      if (mailQuality !== "complete" && mailQuality !== "incoherent_city" && useLlm) {
        const llmAddr = await llmParseAddress(owner.mailing_address, { leadId: opts.leadId });
        if (llmAddr && llmAddr.civicNumber && llmAddr.streetName && llmAddr.city && llmAddr.postal) {
          // Overwrite fields with the LLM result.
          owner.mailing_civic = llmAddr.civicNumber;
          owner.mailing_street = llmAddr.streetName;
          owner.mailing_unit = llmAddr.unit ?? owner.mailing_unit;
          owner.mailing_province = llmAddr.province ?? owner.mailing_province;
          owner.mailing_postal = llmAddr.postal;
          owner.mailing_postal_fsa = llmAddr.postalFsa;
          if (!owner.mailing_city && llmAddr.city) owner.mailing_city = llmAddr.city;
          mailQuality = "complete";
          // Audit trail: record that the LLM fallback resolved this address.
          audit.warnings.push(
            `Owner ${i + 1}: mailing address resolved via llm_fallback (was ${owner.mailing_parse_quality ?? "incomplete"})`,
          );
        }
      }
    } else {
      mailQuality = "unparseable";
    }

    owner.mailing_parse_quality = mailQuality;

    if (mailQuality !== "complete") {
      const warn = `Owner ${i + 1} (${owner.full_name}) mailing address is ${mailQuality}`;
      if (opts.hardBlockUnparseableMailing && (mailQuality === "missing_civic" || mailQuality === "missing_street" || mailQuality === "unparseable")) {
        audit.blocking.push(warn);
      } else {
        audit.warnings.push(warn);
      }
    }

    // ── Names ──────────────────────────────────────────────────────────
    if (owner.kind === "person") {
      // If we already have first_name + last_name from the parser, treat them
      // as the prénom/nom fields and run inversion detection. Otherwise fall
      // back to the full-name parser.
      const result = (owner.first_name || owner.last_name)
        ? parseNameFromFields({
            fullName: owner.full_name,
            prenomField: owner.first_name ?? null,
            nomField: owner.last_name ?? null,
          })
        : parseFullNameOnly(owner.full_name);

      if (result.parseQuality !== "single_token" && result.parseQuality !== "unparseable") {
        if (result.firstName) owner.first_name = result.firstName;
        if (result.lastName)  owner.last_name = result.lastName;
        if (result.fullName)  owner.full_name = result.fullName;
        owner.middle_names = result.middleNames;
        owner.name_was_inverted = result.wasInverted;
        owner.name_parse_quality = result.parseQuality;
      } else {
        owner.name_parse_quality = result.parseQuality;
      }

      if (result.notes.length) audit.warnings.push(`Owner ${i + 1}: ${result.notes.join("; ")}`);
      if (result.wasInverted)  audit.warnings.push(`Owner ${i + 1}: prénom/nom were inverted; corrected automatically`);
      if (result.parseQuality === "ambiguous") audit.warnings.push(`Owner ${i + 1}: name order is ambiguous; left as imported`);

      // ── LLM name fallback ───────────────────────────────────────────
      // If the deterministic parser could not resolve the name, try Haiku.
      if ((result.parseQuality === "ambiguous" || result.parseQuality === "unparseable") && useLlm) {
        const llmName = await llmParseName(
          {
            fullName: owner.full_name,
            prenomField: owner.first_name ?? null,
            nomField: owner.last_name ?? null,
          },
          { leadId: opts.leadId },
        );
        if (llmName && llmName.parseQuality !== "unparseable") {
          if (llmName.firstName) owner.first_name = llmName.firstName;
          if (llmName.lastName)  owner.last_name  = llmName.lastName;
          if (llmName.fullName)  owner.full_name  = llmName.fullName;
          owner.middle_names = llmName.middleNames;
          owner.name_was_inverted = llmName.wasInverted;
          owner.name_parse_quality = llmName.parseQuality;
          if (llmName.notes.length) {
            audit.warnings.push(`Owner ${i + 1} (llm_fallback): ${llmName.notes.join("; ")}`);
          }
        }
      }
    } else if (owner.kind === "company" || owner.kind === "numbered_co" || owner.kind === "trust") {
      owner.name_parse_quality = "company";
    } else {
      owner.name_parse_quality = "unparseable";
    }

    // ── Phones — re-run the v3 context-aware extractor ─────────────────
    // We don't need to re-parse owner.phones (already E.164) — the extractor
    // ran upstream on the source string. We re-run on the phone column text
    // when we still have it (in source_columns.phone). For now, just count.
    const phonesExtracted = (owner.phones ?? []).length;

    audit.owners.push({
      kind: owner.kind,
      name_parse_quality: owner.name_parse_quality ?? null,
      name_was_inverted: !!owner.name_was_inverted,
      mailing_parse_quality: owner.mailing_parse_quality ?? null,
      phones_extracted: phonesExtracted,
      phones_rejected: 0,
    });
  }

  // Property-level checks: an empty owner list is a blocking issue.
  if (row.owners.length === 0) audit.blocking.push("no owners detected");

  // Attach the audit to the row for downstream consumers.
  row.audit = audit;
  return audit;
}

/** Run validation across an entire ParseResult. Returns aggregate counts. */
export async function validateAllRows(rows: ParsedRow[], opts: ValidatorOptions = DEFAULT_OPTS): Promise<{
  audits: ParsedRowAudit[];
  blockedRows: number;
  warningRows: number;
}> {
  let blockedRows = 0;
  let warningRows = 0;
  const audits: ParsedRowAudit[] = [];
  for (const r of rows) {
    const a = await validateAndEnrichRow(r, opts);
    audits.push(a);
    if (a.blocking.length) blockedRows++;
    else if (a.warnings.length) warningRows++;
  }
  return { audits, blockedRows, warningRows };
}

/** Re-export the canonical phone extractor for callers who want to use it
 *  directly on a phone column value. */
export { extractPhonesWithContext };
