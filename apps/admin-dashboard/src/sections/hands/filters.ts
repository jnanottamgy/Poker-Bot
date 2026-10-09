import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { HandsQuery } from '../../api/types';
import { MAX_CHIP_INPUT } from './model';

/** Tri-state flag filter: any / only / none. */
export type FlagFilter = 'any' | 'yes' | 'no';

/**
 * Hand-list filters (§2.10), kept in the URL so a filtered view can be
 * shared and survives Back. `tableId` / `playerId` keep the parameter names
 * other screens already link with (`?tableId=…`, `?playerId=…`).
 */
export interface HandFilters {
  tableId: string | null;
  /** Shown on the chip without another lookup. */
  tableNumber: number | null;
  playerId: string | null;
  /** Shown on the chip; looked up when a link only carries the id. */
  playerName: string | null;
  handNumber: number | null;
  minPot: number | null;
  showdown: FlagFilter;
  allIn: FlagFilter;
}

export const EMPTY_FILTERS: HandFilters = {
  tableId: null,
  tableNumber: null,
  playerId: null,
  playerName: null,
  handNumber: null,
  minPot: null,
  showdown: 'any',
  allIn: 'any',
};

const MAX_ID_LENGTH = 120;
const MAX_NAME_LENGTH = 80;

function flag(v: string | null): FlagFilter {
  return v === 'yes' || v === 'true' ? 'yes' : v === 'no' || v === 'false' ? 'no' : 'any';
}

function positiveInt(v: string | null, max: number): number | null {
  if (v === null || !/^\d{1,13}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= max ? n : null;
}

function id(v: string | null): string | null {
  return v && v.length <= MAX_ID_LENGTH ? v : null;
}

export function parseHandFilters(p: URLSearchParams): HandFilters {
  const tableId = id(p.get('tableId'));
  const playerId = id(p.get('playerId'));
  return {
    tableId,
    tableNumber: tableId ? positiveInt(p.get('tn'), Number.MAX_SAFE_INTEGER) : null,
    playerId,
    playerName: playerId ? (p.get('pn')?.slice(0, MAX_NAME_LENGTH) ?? null) : null,
    handNumber: positiveInt(p.get('hand'), Number.MAX_SAFE_INTEGER),
    minPot: positiveInt(p.get('minPot'), MAX_CHIP_INPUT),
    showdown: flag(p.get('showdown')),
    allIn: flag(p.get('allIn')),
  };
}

export function handFiltersToParams(f: HandFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.tableId) {
    p.set('tableId', f.tableId);
    if (f.tableNumber !== null) p.set('tn', String(f.tableNumber));
  }
  if (f.playerId) {
    p.set('playerId', f.playerId);
    if (f.playerName) p.set('pn', f.playerName);
  }
  if (f.handNumber !== null) p.set('hand', String(f.handNumber));
  if (f.minPot !== null) p.set('minPot', String(f.minPot));
  if (f.showdown !== 'any') p.set('showdown', f.showdown);
  if (f.allIn !== 'any') p.set('allIn', f.allIn);
  return p;
}

/** The server query for these filters (paging is added by the list). */
export function handsQueryOf(f: HandFilters): HandsQuery {
  const q: HandsQuery = {};
  if (f.tableId) q.tableId = f.tableId;
  if (f.playerId) q.playerId = f.playerId;
  if (f.handNumber !== null) q.handNumber = f.handNumber;
  if (f.minPot !== null) q.minPot = f.minPot;
  if (f.showdown !== 'any') q.showdown = f.showdown === 'yes';
  if (f.allIn !== 'any') q.allIn = f.allIn === 'yes';
  return q;
}

export function activeHandFilters(f: HandFilters): number {
  return [f.tableId !== null, f.playerId !== null, f.handNumber !== null, f.minPot !== null, f.showdown !== 'any', f.allIn !== 'any'].filter(Boolean).length;
}

export function useHandFilters(): [HandFilters, (patch: Partial<HandFilters>) => void, () => void] {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseHandFilters(params), [params]);
  const update = useCallback((patch: Partial<HandFilters>) => setParams((prev) => handFiltersToParams({ ...parseHandFilters(prev), ...patch }), { replace: true }), [setParams]);
  const reset = useCallback(() => setParams(handFiltersToParams(EMPTY_FILTERS), { replace: true }), [setParams]);
  return [filters, update, reset];
}
