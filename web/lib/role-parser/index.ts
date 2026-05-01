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

export * from "./types.ts";

function parseSheet(
  sheet: XLSX.WorkSheet,
  cityHint: string | null,
  rowOffset: number,
): { rows: ParsedRow[]; format: RoleFormat; headers: string[] } {
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (rawRows.length === 0) return { rows: [], format: "unknown" as RoleFormat, headers: [] };

  const headers = Object.keys(rawRows[0]);
  const format = detectFormat(headers);

  let rows: ParsedRow[];
  switch (format) {
    case "role_a":
      rows = parseFormatA(rawRows);
      break;
    case "role_b":
    case "role_c":
    case "role_d":
    case "unknown":
    default:
      rows = parseFormatB(rawRows);
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

export function parseRoleFile(buffer: ArrayBuffer | Uint8Array | Buffer): ParseResult {
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

    const { rows, format, headers } = parseSheet(sheet, cityHint, rowOffset);

    if (detectedFormat === "unknown" && format !== "unknown") detectedFormat = format;
    if (firstHeaders.length === 0) firstHeaders = headers;

    allRows.push(...rows);
    totalRawRows += rawRows.length;
    rowOffset += rawRows.length;
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

  return {
    format: detectedFormat,
    rows: allRows,
    errors: allRows.flatMap(r => r.errors.map(e => ({ row: r.row_number, message: e }))),
    total_rows: totalRawRows,
    detected_columns: firstHeaders,
  };
}
