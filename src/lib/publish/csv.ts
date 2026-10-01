/** RFC 4180 CSV writer (CRLF, quoted when needed) with spreadsheet formula-injection guarding. */

export type CsvValue = string | number | null | undefined;

/**
 * Cells opened in Excel/Sheets that start with "=", "@", tab or CR — or "+"/"-" followed by something other
 * than a digit or space (so "+44 20…" and "- 10%" stay intact) — are evaluated as formulas. Prefix those with
 * an apostrophe, which spreadsheets hide and treat as "this is text".
 */
function guardFormula(value: string): string {
  return /^[=@\t\r]/.test(value) || /^[+-][^\d\s]/.test(value) ? `'${value}` : value;
}

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = guardFormula(String(value));
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serialise rows (first row = header). A UTF-8 BOM is prepended so Excel shows £ and curly quotes correctly. */
export function toCsv(rows: CsvValue[][], { bom = true }: { bom?: boolean } = {}): string {
  const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return bom ? `﻿${body}` : body;
}
