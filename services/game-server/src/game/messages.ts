import type { TableCommand } from '@jpb/shared-types';
import type { CreateTableInput } from '@jpb/table-engine';
import type { DirectorInput } from '@jpb/tournament-engine';

/** Bus channel on which committed actors announce undelivered outbox rows (dispatch trigger). */
export const OUTBOX_KICK_CHANNEL = 'outbox:kick';

/** Payload of an actor_outbox row targeting a table actor. */
export interface ToTable {
  /** Director effect sequence (monotonic per tournament): the table drops anything <= its last applied seq. */
  dseq: number;
  command: TableCommand | { type: 'INIT'; input: CreateTableInput; publicEntropy: string; serverSeedHash: string };
}

/** Payload of an actor_outbox row targeting the director. */
export interface ToDirector {
  /** Sender table and its report sequence (monotonic per table): the director drops anything <= the last seen. */
  tableId: string;
  rseq: number;
  input: DirectorInput;
}
