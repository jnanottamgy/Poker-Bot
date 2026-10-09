import type { TournamentConfig } from '@jpb/shared-types';
import { isStepId } from './steps';
import type { WizardDraft } from './draft';

/**
 * The in-progress draft is kept in sessionStorage (this browser tab only) so
 * a refresh never loses work. Nothing here is authoritative: the server
 * re-validates on save. Storage can be unavailable or full (private mode,
 * a huge prize table): every access is guarded and reports failure.
 */

const VERSION = 1;
const PREFIX = 'jpb.admin.setup.v1';

export interface StoredDraft {
  v: typeof VERSION;
  /** Client time of the last write (display only). */
  savedAt: number;
  draft: WizardDraft;
  /** Edit mode: the server configuration the edits started from (to detect changes made meanwhile). */
  base: TournamentConfig | null;
}

export function storageKey(tournamentId: string | null): string {
  return `${PREFIX}:${tournamentId ?? 'new'}`;
}

function isDraft(value: unknown): value is WizardDraft {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Partial<WizardDraft>;
  return typeof d.config === 'object' && d.config !== null && typeof d.meta === 'object' && d.meta !== null && isStepId(d.step) && Array.isArray(d.config.blindSchedule);
}

export function loadDraft(key: string): StoredDraft | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (parsed.v !== VERSION || !isDraft(parsed.draft)) return null;
    return { v: VERSION, savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0, draft: parsed.draft, base: parsed.base ?? null };
  } catch {
    return null;
  }
}

/** True when written (false: storage unavailable or over quota). */
export function saveDraft(key: string, draft: WizardDraft, base: TournamentConfig | null, now: number): boolean {
  try {
    const value: StoredDraft = { v: VERSION, savedAt: now, draft, base };
    globalThis.sessionStorage?.setItem(key, JSON.stringify(value));
    return globalThis.sessionStorage !== undefined;
  } catch {
    return false;
  }
}

export function clearDraft(key: string): void {
  try {
    globalThis.sessionStorage?.removeItem(key);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}
