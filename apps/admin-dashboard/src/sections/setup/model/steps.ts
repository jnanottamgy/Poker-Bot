import type { IconName } from '@jpb/ui';
import type { PathSegment } from '@jpb/validation';

/** The ten wizard steps of docs/ADMIN_CONTROL_ROOM.md §2.2, in order. */
export type StepId = 'basics' | 'players' | 'blinds' | 'breaks' | 'timing' | 'registration' | 'prizes' | 'display' | 'balancing' | 'review';

export interface StepDef {
  id: StepId;
  title: string;
  icon: IconName;
  /** One line under the title (stepper + step header). */
  description: string;
}

export const STEPS: readonly StepDef[] = [
  { id: 'basics', title: 'Basics', icon: 'file', description: 'Name, join code, scheduled start and auto-start.' },
  { id: 'players', title: 'Players & tables', icon: 'users', description: 'Field size, table sizes, final table and consolidation.' },
  { id: 'blinds', title: 'Chips & blinds', icon: 'layers', description: 'Starting stack, antes and the blind schedule.' },
  { id: 'breaks', title: 'Breaks', icon: 'coffee', description: 'When breaks happen, how long they last and what players see.' },
  { id: 'timing', title: 'Timing', icon: 'clock', description: 'Action timers, away handling, delays and the start countdown.' },
  { id: 'registration', title: 'Registration', icon: 'user', description: 'Form fields, approval, access code, deadline, late registration and re-entry.' },
  { id: 'prizes', title: 'Prizes', icon: 'trophy', description: 'Currency, paid places and prize notes.' },
  { id: 'display', title: 'Spectators & features', icon: 'monitor', description: 'Who can watch, spectator delay and feature flags.' },
  { id: 'balancing', title: 'Balancing', icon: 'split', description: 'Advanced: imbalance tolerance, recent-move window and seat-score weights.' },
  { id: 'review', title: 'Review', icon: 'check-circle', description: 'Everything at a glance, the validation result and the fairness commitment.' },
];

export const STEP_IDS: readonly StepId[] = STEPS.map((s) => s.id);

export function stepIndex(id: StepId): number {
  return STEP_IDS.indexOf(id);
}

export function stepDef(id: StepId): StepDef {
  return STEPS[stepIndex(id)]!;
}

export function isStepId(value: unknown): value is StepId {
  return typeof value === 'string' && (STEP_IDS as readonly string[]).includes(value);
}

/** Which step owns each top-level TournamentConfig field (balancing.consolidateBy is shown with the tables). */
const ROOT_STEP: Readonly<Record<string, StepId>> = {
  name: 'basics',
  joinCode: 'basics',
  game: 'basics',
  startTime: 'basics',
  autoStart: 'basics',
  minPlayers: 'players',
  maxPlayers: 'players',
  tables: 'players',
  startingStack: 'blinds',
  anteType: 'blinds',
  blindSchedule: 'blinds',
  speedMode: 'blinds',
  breaks: 'breaks',
  timing: 'timing',
  handForHand: 'timing',
  registration: 'registration',
  registrationDeadline: 'registration',
  lateRegistration: 'registration',
  reentry: 'registration',
  prizeStructure: 'prizes',
  spectators: 'display',
  features: 'display',
  balancing: 'balancing',
};

/** The step that shows the field at `segments` (unknown or root paths → Review). */
export function stepOfPath(segments: readonly PathSegment[]): StepId {
  const head = segments[0];
  if (typeof head !== 'string') return 'review';
  if (head === 'balancing' && segments[1] === 'consolidateBy') return 'players';
  return ROOT_STEP[head] ?? 'review';
}
