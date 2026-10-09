/**
 * Browser file downloads for exports (CSV / JSON). Files are fetched through
 * the typed API client (same session cookie, friendly errors, works against
 * the mock backend) and then saved from a Blob — the operator never lands on
 * a raw error page.
 */

/** File-name safe slug: "Spring Showdown 2026" → "spring-showdown-2026". */
export function fileSlug(s: string): string {
  const slug = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'tournament';
}

/** UTC date stamp for file names (YYYYMMDD-HHMM): the same on every operator's machine. */
export function fileStamp(epochMs: number): string {
  const d = new Date(epochMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

/** Saves `content` as a file. False when the browser cannot download (e.g. no Blob URLs). */
export function saveFile(filename: string, content: string, mime: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const blob = new Blob([content], { type: mime });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(href), 1_000);
  return true;
}

export const CSV_MIME = 'text/csv;charset=utf-8';
export const JSON_MIME = 'application/json;charset=utf-8';

/** Pretty-printed JSON export. */
export function saveJson(filename: string, data: unknown): boolean {
  return saveFile(filename, `${JSON.stringify(data, null, 2)}\n`, JSON_MIME);
}

/** Rows in a CSV text, without the header line (BOM and trailing newline tolerated). */
export function csvRowCount(text: string): number {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length > 0);
  return Math.max(0, lines.length - 1);
}
