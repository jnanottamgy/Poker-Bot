/**
 * @jpb/tournament-engine — Johnny, the algorithmic Tournament Director.
 * Deterministic rules engine; no AI. See README.md and docs/CONTRACTS.md §7.
 */
export type * from './types';
export { createDirectorState } from './create';
export type { CreateDirectorInput } from './create';
export { directorReduce } from './reducer';
export { buildTableIndex, DirectorError } from './draft';
export { breakAfterLevel, currentLevel, levelRemainingMs, nextLevel, nextTickAt } from './clock';
export { lateRegistrationOpen, positionsDeferred, reentryOpen } from './registration';
export { paidPlaces, prizeAt, splitTiedPrizes } from './prizes';
export { ordinal, TEMPLATES } from './commentary';
export { tableIdFor } from './start';
export { bmGet, bmValues, bucketOf, BUCKET_COUNT } from './bucketMap';
export type { BucketMap } from './bucketMap';
export {
  directorStats,
  getDirectorPlayer,
  getDirectorTable,
  leaderboard,
  openTableList,
  playerSelf,
  tournamentSummary,
} from './selectors';
export type { DirectorStats, RankedPlayer } from './selectors';
