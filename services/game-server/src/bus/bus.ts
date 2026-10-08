/**
 * Message bus abstraction. A single node uses the in-process LocalBus; a
 * horizontally scaled deployment uses RedisBus. Delivery is at-most-once
 * fire-and-forget (pub/sub); durability comes from PostgreSQL, and every
 * client can always recover by requesting an authoritative snapshot.
 *
 * Channel naming (see `channels`):
 *   table:{tableId}:cmd        commands routed to the node that owns the table actor
 *   table:{tableId}:events     table events (public + private; gateways filter per audience)
 *   director:{tid}:in          inputs routed to the node that owns the tournament director
 *   tournament:{tid}:events    tournament-wide events
 *   player:{playerId}          per-player notices / session control
 *   admin:{tid}                alerts and admin-only signals
 */
export type BusHandler = (message: unknown) => void;
export type Unsubscribe = () => Promise<void>;

export interface MessageBus {
  publish(channel: string, message: unknown): Promise<void>;
  subscribe(channel: string, handler: BusHandler): Promise<Unsubscribe>;
  close(): Promise<void>;
}

export const channels = {
  tableCommands: (tableId: string) => `table:${tableId}:cmd`,
  tableEvents: (tableId: string) => `table:${tableId}:events`,
  directorInputs: (tournamentId: string) => `director:${tournamentId}:in`,
  tournamentEvents: (tournamentId: string) => `tournament:${tournamentId}:events`,
  player: (playerId: string) => `player:${playerId}`,
  admin: (tournamentId: string) => `admin:${tournamentId}`,
} as const;
