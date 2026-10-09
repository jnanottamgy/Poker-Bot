import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuditEntryDto } from '@jpb/shared-types';
import { useApi, useQueryClient } from '../../api/ApiProvider';
import type { AuditQuery } from '../../api/types';
import { hashKey } from '../../api/query/QueryClient';
import { inRange, pastRange } from './model';
import type { DateRange } from './model';

/** Entries per request (server max 1,000). */
export const PAGE_SIZE = 200;
/** With a date range, keep scanning automatically up to this many pages per request for more rows. */
const AUTO_SCAN_PAGES = 10;
/** Stop auto-scanning once this many new matching rows arrived. */
const AUTO_SCAN_FILL = 60;
/** How often to look for entries newer than the top of the list. */
const NEW_POLL_MS = 15_000;
const NEW_PROBE = 50;

export interface AuditPages {
  /** Loaded entries matching the date range, newest first. */
  rows: AuditEntryDto[];
  /** Every entry loaded from the server for these filters (before the date range). */
  scanned: number;
  hasMore: boolean;
  loading: boolean;
  error: unknown;
  /** Newer entries exist above the top of the list (only when starting at the latest). */
  newer: number;
  loadMore: () => void;
  reload: () => void;
}

interface PageState {
  entries: AuditEntryDto[];
  cursor: number | null;
  done: boolean;
  loading: boolean;
  error: unknown;
}

const INITIAL: PageState = { entries: [], cursor: null, done: false, loading: false, error: null };

/**
 * Cursor pagination over GET /api/admin/audit (beforeSeq). The server filters
 * by tournament, admin, action and target; the date range is applied here
 * while paging (the API has no date filter): entries come newest first, so
 * scanning stops at the first entry older than the range start.
 *
 * @param startBeforeSeq start below this seq (jump to an entry), null = latest.
 */
export function useAuditPages(query: AuditQuery, range: DateRange, startBeforeSeq: number | null, enabled = true): AuditPages {
  const api = useApi();
  const client = useQueryClient();
  const [state, setState] = useState<PageState>(INITIAL);
  const [newer, setNewer] = useState(0);
  const [reloadSeq, setReloadSeq] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const gen = useRef(0);
  const ctrl = useRef<AbortController | null>(null);
  const key = `${hashKey([query])}|${startBeforeSeq ?? ''}|${reloadSeq}`;
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const queryRef = useRef(query);
  queryRef.current = query;

  const run = useCallback(
    async (first: boolean) => {
      const s = stateRef.current;
      if (!first && (s.loading || s.done)) return;
      const myGen = gen.current;
      const c = new AbortController();
      ctrl.current = c;
      setState((p) => ({ ...p, loading: true, error: null }));
      let cursor = first ? (startBeforeSeq ?? null) : s.cursor;
      let added = 0;
      try {
        for (let page = 0; page < AUTO_SCAN_PAGES; page++) {
          const res = await api.audit.list({ ...queryRef.current, ...(cursor !== null ? { beforeSeq: cursor } : {}), limit: PAGE_SIZE }, c.signal);
          if (gen.current !== myGen) return;
          const r = rangeRef.current;
          const last = res.entries[res.entries.length - 1];
          const done = res.nextBeforeSeq === null || (last !== undefined && pastRange(last, r));
          added += res.entries.filter((e) => inRange(e, r)).length;
          cursor = res.nextBeforeSeq;
          setState((p) => ({ entries: [...p.entries, ...res.entries], cursor, done, loading: !done, error: null }));
          const filtering = r.from !== null || r.to !== null;
          if (done || !filtering || added >= AUTO_SCAN_FILL) break;
        }
        if (gen.current === myGen) setState((p) => ({ ...p, loading: false }));
      } catch (err) {
        if (gen.current !== myGen || c.signal.aborted) return;
        client.reportError(err);
        setState((p) => ({ ...p, loading: false, error: err }));
      }
    },
    [api, client, startBeforeSeq],
  );

  // New filters / jump / reload: start over from the top.
  useEffect(() => {
    gen.current += 1;
    ctrl.current?.abort();
    setState(INITIAL);
    setNewer(0);
    stateRef.current = INITIAL;
    if (enabled) void run(true);
    return () => ctrl.current?.abort();
  }, [key, enabled, run]);

  // Changing only the date range keeps what was loaded; scan further if nothing shows yet.
  const rangeKey = `${range.from ?? ''}|${range.to ?? ''}`;
  useEffect(() => {
    const s = stateRef.current;
    if (!enabled || s.loading || s.done || s.entries.length === 0) return;
    const last = s.entries[s.entries.length - 1];
    if (last && pastRange(last, range)) {
      setState((p) => ({ ...p, done: true }));
      return;
    }
    if (s.entries.filter((e) => inRange(e, range)).length < AUTO_SCAN_FILL) void run(false);
    // Only a range change should trigger this.
  }, [rangeKey]);

  // Poll for newer entries (only when the list starts at the latest entry).
  const top = state.entries[0]?.seq ?? null;
  useEffect(() => {
    if (!enabled || startBeforeSeq !== null || top === null) return undefined;
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      api.audit
        .list({ ...queryRef.current, limit: NEW_PROBE })
        .then((res) => setNewer(res.entries.filter((e) => e.seq > top).length))
        .catch(() => undefined);
    }, NEW_POLL_MS);
    return () => clearInterval(t);
  }, [api, enabled, startBeforeSeq, top]);

  const rows = useMemo(() => state.entries.filter((e) => inRange(e, range)), [state.entries, range]);
  const loadMore = useCallback(() => void run(false), [run]);
  const reload = useCallback(() => setReloadSeq((n) => n + 1), []);
  return { rows, scanned: state.entries.length, hasMore: !state.done, loading: state.loading, error: state.error, newer, loadMore, reload };
}

/**
 * Pages through every entry matching the filters (and date range) for an
 * export, bounded like the server's CSV (100 pages of 1,000).
 */
export async function collectAll(list: (q: AuditQuery, signal?: AbortSignal) => Promise<{ entries: AuditEntryDto[]; nextBeforeSeq: number | null }>, query: AuditQuery, range: DateRange, onProgress?: (scanned: number) => void, signal?: AbortSignal): Promise<{ entries: AuditEntryDto[]; complete: boolean }> {
  const out: AuditEntryDto[] = [];
  let cursor: number | null = null;
  let scanned = 0;
  for (let page = 0; page < 100; page++) {
    const res = await list({ ...query, ...(cursor !== null ? { beforeSeq: cursor } : {}), limit: 1_000 }, signal);
    scanned += res.entries.length;
    onProgress?.(scanned);
    out.push(...res.entries.filter((e) => inRange(e, range)));
    const last = res.entries[res.entries.length - 1];
    if (res.nextBeforeSeq === null || (last && pastRange(last, range))) return { entries: out, complete: true };
    cursor = res.nextBeforeSeq;
  }
  return { entries: out, complete: false };
}
