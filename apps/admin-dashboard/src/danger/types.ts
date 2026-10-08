import type { ReactNode } from 'react';
import type { PreviewRow } from '@jpb/ui';
import type { ConfirmWord, DangerLevel, EndpointKey } from '../api/endpoints';
import type { QueryKey } from '../api/query/QueryClient';

/** What the operator typed/confirmed; spread it into the API body (`{ reason, confirm }`). */
export interface DangerInput<W extends ConfirmWord = ConfirmWord> {
  /** Trimmed reason ('' when the level-1 action did not ask for one). */
  reason: string;
  /** The exact confirmation word (level 2 only; the server re-checks it). */
  confirm: W;
}

/**
 * One dangerous (or merely state-changing) admin action. The danger level
 * decides the UX (docs/ADMIN_CONTROL_ROOM.md §4):
 *   0 → runs immediately;
 *   1 → one confirmation dialog (optional / required reason);
 *   2 → double confirmation: typed WORD + mandatory reason, consequences and
 *       a before → after preview.
 */
export interface DangerSpec<R = unknown, W extends ConfirmWord = ConfirmWord> {
  level: DangerLevel;
  /** Registry key of the endpoint this runs; used to verify the level/word match docs/API.md. */
  endpoint?: EndpointKey;
  /** e.g. "Emergency freeze". Also the confirm button label unless `confirmLabel`. */
  title: string;
  summary?: ReactNode;
  consequences?: ReactNode[];
  preview?: PreviewRow[];
  /** Level 2: the API.md confirmation word (FREEZE, CANCEL, LEVEL, …). */
  word?: W;
  /** Level 1: ask for a reason ('none' default; 'required' for e.g. force timeout). */
  reason?: 'none' | 'optional' | 'required';
  confirmLabel?: string;
  /** Level 1 visual tone of the confirm button. */
  tone?: 'primary' | 'danger';
  run: (input: DangerInput<W>) => Promise<R>;
  /** Success toast title. */
  success?: string | ((result: R) => string);
  /** Query keys to refresh afterwards (the UI never patches state optimistically). */
  invalidate?: QueryKey[];
  onSuccess?: (result: R) => void;
}

/** Minimum reason length for level 2 (the server requires ≥ 3; we ask for a meaningful sentence). */
export const MIN_REASON_LENGTH = 8;
