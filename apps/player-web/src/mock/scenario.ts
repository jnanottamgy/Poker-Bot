/**
 * Mock scenarios, selected with query parameters (mock mode only):
 *
 *   ?scenario=default | champion | reconnect | another-device | replaced | expired | pending
 *   ?at=lobby | table | move | break | paused | frozen | elim | spectate | final
 *   ?speed=2          bots, streets and hand transitions run 2x faster (hero timer unchanged)
 *   ?down=6           reconnect scenario: seconds the server stays unreachable
 *   ?join=open | closed | access | approval   join page variants
 */
export type ScenarioId = 'default' | 'champion' | 'reconnect' | 'another-device' | 'replaced' | 'expired' | 'pending';
export type StartAt = 'lobby' | 'table' | 'move' | 'break' | 'paused' | 'frozen' | 'elim' | 'spectate' | 'final';
export type JoinVariant = 'open' | 'closed' | 'access' | 'approval';

export interface MockScenario {
  id: ScenarioId;
  at: StartAt;
  speed: number;
  downSeconds: number;
  join: JoinVariant;
}

const SCENARIOS: readonly ScenarioId[] = ['default', 'champion', 'reconnect', 'another-device', 'replaced', 'expired', 'pending'];
const STARTS: readonly StartAt[] = ['lobby', 'table', 'move', 'break', 'paused', 'frozen', 'elim', 'spectate', 'final'];
const JOINS: readonly JoinVariant[] = ['open', 'closed', 'access', 'approval'];

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseScenario(search: string): MockScenario {
  const p = new URLSearchParams(search);
  const id = oneOf(p.get('scenario'), SCENARIOS, 'default');
  const defaultAt: StartAt = id === 'champion' ? 'final' : id === 'default' || id === 'pending' ? 'lobby' : 'table';
  const speed = Number(p.get('speed') ?? '1');
  const down = Number(p.get('down') ?? '6');
  return {
    id,
    at: oneOf(p.get('at'), STARTS, defaultAt),
    speed: Number.isFinite(speed) && speed > 0 ? Math.min(speed, 20) : 1,
    downSeconds: Number.isFinite(down) && down >= 0 ? down : 6,
    join: oneOf(p.get('join'), JOINS, id === 'pending' ? 'approval' : 'open'),
  };
}
