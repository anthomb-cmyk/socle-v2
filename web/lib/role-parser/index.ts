// Public entry point for the rôle XLSX parser.
//
// Multi-sheet support: some files (e.g. "12 portes et +") have one sheet per
// city.  We parse every sheet and concatenate results.  The sheet name is
// injected as a city hint when the row has no city column.

import * as XLSX from "xlsx";
import type { ParseResult, ParsedRow, RoleFormat } from "./types.ts";
import { detectFormat } from "./format-detect.ts";
import { parseFormatA } from "./format-a.ts";
import { parseFormatB } from "./format-b.ts";
import { validateAllRows } from "./import-validator.ts";

export * from "./types.ts";

/** Options accepted by parseRoleFile. */
export interface ParseRoleFileOptions {
  /** Override the auto-detected format. Used when the user explicitly
   *  picks a format after we refused to auto-fall-back on "unknown". */
  formatOverride?: RoleFormat;
  /** When true, hard-block rows with unparseable mailing addresses
   *  (the v3 default — they don't import). */
  hardBlockUnparseableMailing?: boolean;
}

function parseSheet(
  sheet: XLSX.WorkSheet,
  cityHint: string | null,
  rowOffset: number,
  formatOverride?: RoleFormat,
): { rows: ParsedRow[]; format: RoleFormat; headers: string[] } {
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (rawRows.length === 0) return { rows: [], format: "unknown" as RoleFormat, headers: [] };

  const headers = Object.keys(rawRows[0]);
  const detected = detectFormat(headers);
  const format: RoleFormat = formatOverride ?? detected;

  // v3: never silently fall back to parseFormatB when detection is "unknown".
  // The caller must pass formatOverride explicitly. parseRoleFile enforces this.
  let rows: ParsedRow[];
  switch (format) {
    case "role_a":
      rows = parseFormatA(rawRows);
      break;
    case "role_b":
    case "role_c":
    case "role_d":
      rows = parseFormatB(rawRows);
      break;
    case "unknown":
    default:
      rows = [];
      break;
  }

  // Inject city hint when the parser couldn't detect a city
  // (happens for "12 portes" sheets where city = sheet name)
  if (cityHint) {
    for (const r of rows) {
      if (!r.property.city) r.property.city = cityHint;
    }
  }

  // Re-number rows relative to the global row offset
  for (const r of rows) {
    r.row_number += rowOffset;
  }

  return { rows, format, headers };
}

export async function parseRoleFile(buffer: ArrayBuffer | Uint8Array | Buffer, options: ParseRoleFileOptions = {}): Promise<ParseResult> {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

  if (workbook.SheetNames.length === 0) {
    return {
      format: "unknown",
      rows: [],
      errors: [{ row: 0, message: "No sheets in workbook" }],
      total_rows: 0,
      detected_columns: [],
    };
  }

  const allRows: ParsedRow[] = [];
  let totalRawRows = 0;
  let detectedFormat: RoleFormat = "unknown";
  let firstHeaders: string[] = [];
  let rowOffset = 0;

  for (const sheetName of workbook.SheetNames) {
    // Skip hidden / temp sheets (names starting with ~$)
    if (sheetName.startsWith("~")) continue;

    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (rawRows.length === 0) continue;

    // Use sheet name as city hint only when it looks like a city name
    // (not "Sheet1", "Feuil1", etc.)
    const isCityName = !/^(sheet|feuil|feuille)\s*\d*$/i.test(sheetName.trim());
    const cityHint = isCityName ? sheetName.trim() : null;

    const { rows, format, headers } = parseSheet(sheet, cityHint, rowOffset, options.formatOverride);

    if (detectedFormat === "unknown" && format !== "unknown") detectedFormat = format;
    if (firstHeaders.length === 0) firstHeaders = headers;

    allRows.push(...rows);
    totalRawRows += rawRows.length;
    rowOffset += rawRows.length;
  }

  // v3: hard refusal for unrecognized formats. The upload route surfaces
  // this so the UI can prompt for an explicit override.
  if (detectedFormat === "unknown" && !options.formatOverride) {
    return {
      format: "unknown",
      rows: [],
      errors: [{ row: 0, message: "Unrecognized rôle format. Please choose a format manually (role_a, role_b, role_c, role_d) or fix the file." }],
      total_rows: totalRawRows,
      detected_columns: firstHeaders,
    };
  }

  if (allRows.length === 0) {
    return {
      format: detectedFormat,
      rows: [],
      errors: [{ row: 0, message: "All sheets are empty" }],
      total_rows: 0,
      detected_columns: firstHeaders,
    };
  }

  // v3: run the import-time validator to populate structured mailing fields,
  // detect inverted prénom/nom, and produce per-row audit reports.
  const hardBlock = options.hardBlockUnparseableMailing ?? true;
  const { audits } = await validateAllRows(allRows, { hardBlockUnparseableMailing: hardBlock });

  // Roll up audit warnings/blockings into the parser-level errors stream so
  // the preview UI shows them alongside other errors.
  const auditErrors: { row: number; message: string }[] = [];
  for (const a of audits) {
    for (const b of a.blocking) auditErrors.push({ row: a.row_number, message: `BLOCK: ${b}` });
    for (const w of a.warnings) auditErrors.push({ row: a.row_number, message: `WARN: ${w}` });
  }

  return {
    format: detectedFormat,
    rows: allRows,
    errors: [
      ...allRows.flatMap(r => r.errors.map(e => ({ row: r.row_number, message: e }))),
      ...auditErrors,
    ],
    total_rows: totalRawRows,
    detected_columns: firstHeaders,
  };
}
