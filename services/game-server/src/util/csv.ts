/**
 * RFC 4180 CSV with spreadsheet formula-injection protection: cells that
 * start with = + - @ (or tab/CR) are prefixed with an apostrophe so Excel /
 * Google Sheets treat them as text. Exports are opened by accountants.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (FORMULA_START.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  // BOM so Excel opens UTF-8 (names with ₹, accents, Devanagari) correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
