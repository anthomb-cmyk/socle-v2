// Public entry point for the rôle XLSX parser.

import * as XLSX from "xlsx";
import type { ParseResult } from "./types.ts";
import { detectFormat } from "./format-detect.ts";
import { parseFormatA } from "./format-a.ts";
import { parseFormatB } from "./format-b.ts";

export * from "./types.ts";

export function parseRoleFile(buffer: ArrayBuffer | Uint8Array | Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { format: "unknown", rows: [], errors: [{ row: 0, message: "No sheets in workbook" }], total_rows: 0, detected_columns: [] };
  }
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (rawRows.length === 0) {
    return { format: "unknown", rows: [], errors: [{ row: 0, message: "Sheet is empty" }], total_rows: 0, detected_columns: [] };
  }

  const headers = Object.keys(rawRows[0]);
  const format = detectFormat(headers);

  let rows;
  switch (format) {
    case "role_a":
      rows = parseFormatA(rawRows);
      break;
    case "role_b":
      rows = parseFormatB(rawRows);
      break;
    case "role_c":
    case "role_d":
    case "unknown":
    default:
      // Fallback: try Format B parser. Its column matching is permissive
      // enough that many ad-hoc files parse correctly.
      rows = parseFormatB(rawRows);
      break;
  }

  return {
    format,
    rows,
    errors: rows.flatMap(r => r.errors.map(e => ({ row: r.row_number, message: e }))),
    total_rows: rawRows.length,
    detected_columns: headers,
  };
}
