const INJECTION_START = /^[=+\-@\t\r]/;

/** RFC 4180 quoting, plus neutralising cells a spreadsheet would run as a formula. */
export function csvCell(value: string | number | null | undefined, numeric = false): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (!numeric && INJECTION_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The BOM makes Excel read the file as UTF-8, which Arabic text depends on. */
export function toCsv(header: string[], rows: string[][]): string {
  const lines = [header.map((h) => csvCell(h)).join(','), ...rows.map((r) => r.join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}
