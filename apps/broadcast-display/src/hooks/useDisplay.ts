import { useEffect, useReducer, useState } from 'react';
import type { Dispatch } from 'react';
import { INITIAL_DISPLAY_STATE, displayReducer } from '../model/reducer';
import type { DisplayAction, DisplayState } from '../model/types';
import type { DisplayData, DisplaySource } from '../net/source';

/** Stack ranking refresh while play is on (public endpoint, rate-limited per IP). */
export const LEADERBOARD_POLL_MS = 15_000;
export const LEADERBOARD_LIMIT = 10;
/** Join/prize info changes rarely (prize edits while running). */
export const INFO_POLL_MS = 120_000;

/** Wires a frame source and the REST data into the display reducer. */
export function useDisplay(source: DisplaySource, data: DisplayData | null): [DisplayState, Dispatch<DisplayAction>] {
  const [state, dispatch] = useReducer(displayReducer, INITIAL_DISPLAY_STATE);

  useEffect(() => {
    source.start(dispatch);
    const nudge = () => source.nudge();
    const onVisible = () => {
      if (document.visibilityState === 'visible') source.nudge();
    };
    window.addEventListener('online', nudge);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', nudge);
      document.removeEventListener('visibilitychange', onVisible);
      source.stop();
    };
  }, [source]);

  useEffect(() => {
    if (!data) return undefined;
    let cancelled = false;
    const load = () =>
      data.info().then(
        (info) => !cancelled && dispatch({ type: 'info', info }),
        () => undefined,
      );
    void load();
    const id = setInterval(load, INFO_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [data]);

  const status = state.tournament?.status ?? null;
  const eliminated = state.tournament?.counters.eliminated ?? 0;
  useEffect(() => {
    if (!data || !status || status === 'DRAFT' || status === 'REGISTRATION' || status === 'CANCELLED') return undefined;
    let cancelled = false;
    const load = () => {
      const mode = status === 'COMPLETED' ? 'finish' : 'stack';
      data.leaderboard(mode, LEADERBOARD_LIMIT).then(
        (lb) => !cancelled && dispatch({ type: 'leaderboard', data: lb, at: Date.now() }),
        () => undefined,
      );
    };
    load();
    const id = status === 'COMPLETED' ? null : setInterval(load, LEADERBOARD_POLL_MS);
    return () => {
      cancelled = true;
      if (id !== null) clearInterval(id);
    };
    // An elimination re-ranks the field: refresh then too (eliminated count changes).
  }, [data, status, eliminated]);

  return [state, dispatch];
}

/** Wall-clock time, re-rendered every `intervalMs` (countdowns are visual only). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Index into the idle rotation, advanced when the current scene's dwell time is over. */
export function useRotation(dwellFor: (index: number) => number, now: number): { index: number } {
  const [rot, setRot] = useState(() => ({ index: 0, since: now }));
  const dwell = dwellFor(rot.index);
  useEffect(() => {
    if (now - rot.since >= dwell) setRot({ index: rot.index + 1, since: now });
  }, [now, rot, dwell]);
  return { index: rot.index };
}
