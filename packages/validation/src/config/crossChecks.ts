import type { TournamentConfig } from '@jpb/shared-types';
import { CONFIG_LIMITS } from '../constants';
import type { PathSegment } from '../errors';
import { breakMatchesLevel } from './breaks';

/**
 * Cross-field rules of a TournamentConfig. Each rule declares the top-level
 * fields it reads (`deps`); it runs whenever those fields are structurally
 * valid, even if unrelated fields have errors, so the admin wizard can show
 * every problem at once.
 */
export interface CrossCheck {
  id: string;
  deps: ReadonlyArray<keyof TournamentConfig>;
  run(cfg: TournamentConfig, report: (path: PathSegment[], message: string) => void): void;
}

/** Entries a field can produce: maxPlayers, times maxEntriesPerPlayer when re-entry is enabled. */
export function maxPossibleEntries(cfg: Pick<TournamentConfig, 'maxPlayers' | 'reentry'>): bigint {
  const perPlayer = cfg.reentry.enabled ? cfg.reentry.maxEntriesPerPlayer : 1;
  return BigInt(cfg.maxPlayers) * BigInt(perPlayer);
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

const playerLimits: CrossCheck = {
  id: 'playerLimits',
  deps: ['minPlayers', 'maxPlayers'],
  run(cfg, report) {
    if (cfg.maxPlayers < cfg.minPlayers) {
      report(['maxPlayers'], `The maximum number of players (${cfg.maxPlayers}) must be at least the minimum (${cfg.minPlayers}).`);
    }
  },
};

const stackCoversFirstBigBlind: CrossCheck = {
  id: 'stackCoversFirstBigBlind',
  deps: ['startingStack', 'blindSchedule'],
  run(cfg, report) {
    const first = cfg.blindSchedule[0];
    if (first !== undefined && cfg.startingStack < first.bigBlind) {
      report(['startingStack'], `The starting stack (${cfg.startingStack}) must be at least the level-1 big blind (${first.bigBlind}).`);
    }
  },
};

/** Chip conservation sums (Σ stacks over every entry) must stay exact. */
const totalChipsSafe: CrossCheck = {
  id: 'totalChipsSafe',
  deps: ['startingStack', 'maxPlayers', 'reentry'],
  run(cfg, report) {
    if (BigInt(cfg.startingStack) * maxPossibleEntries(cfg) > MAX_SAFE) {
      report(
        ['startingStack'],
        'Starting stack × maximum entries could exceed the largest exactly countable chip total; lower the starting stack or the player limit.',
      );
    }
  },
};

const antesMatchType: CrossCheck = {
  id: 'antesMatchType',
  deps: ['anteType', 'blindSchedule'],
  run(cfg, report) {
    if (cfg.anteType !== 'NONE') return;
    cfg.blindSchedule.forEach((l, i) => {
      if (l.ante !== 0) report(['blindSchedule', i, 'ante'], 'Antes must be 0 when the ante type is NONE.');
    });
  },
};

const levelDurations: CrossCheck = {
  id: 'levelDurations',
  deps: ['speedMode', 'blindSchedule'],
  run(cfg, report) {
    if (cfg.speedMode) return;
    cfg.blindSchedule.forEach((l, i) => {
      if (l.durationSeconds < CONFIG_LIMITS.MIN_LEVEL_SECONDS_NORMAL) {
        report(
          ['blindSchedule', i, 'durationSeconds'],
          `Levels must last at least ${CONFIG_LIMITS.MIN_LEVEL_SECONDS_NORMAL} seconds (shorter levels require speed mode).`,
        );
      }
    });
  },
};

const breaksWithinSchedule: CrossCheck = {
  id: 'breaksWithinSchedule',
  deps: ['breaks', 'blindSchedule', 'speedMode'],
  run(cfg, report) {
    const levels = cfg.blindSchedule.length;
    const plural = levels === 1 ? '' : 's';
    cfg.breaks.forEach((b, i) => {
      if (levels > 0 && b.afterLevel !== undefined && b.afterLevel > levels) {
        report(['breaks', i, 'afterLevel'], `There is no level ${b.afterLevel}: the schedule has ${levels} level${plural}.`);
      }
      if (levels > 0 && b.everyLevels !== undefined && b.everyLevels > levels) {
        report(['breaks', i, 'everyLevels'], `A break every ${b.everyLevels} levels never happens: the schedule has ${levels} level${plural}.`);
      }
      if (!cfg.speedMode && b.durationSeconds < CONFIG_LIMITS.MIN_BREAK_SECONDS_NORMAL) {
        report(
          ['breaks', i, 'durationSeconds'],
          `Breaks must last at least ${CONFIG_LIMITS.MIN_BREAK_SECONDS_NORMAL} seconds (shorter breaks require speed mode).`,
        );
      }
    });
    reportOverlappingBreaks(cfg, report);
  },
};

/** No level may be followed by two breaks: the break length would be ambiguous. */
function reportOverlappingBreaks(cfg: TournamentConfig, report: (path: PathSegment[], message: string) => void): void {
  const reported = new Set<number>();
  for (let level = 1; level <= cfg.blindSchedule.length; level++) {
    const matching: number[] = [];
    cfg.breaks.forEach((b, i) => {
      if (breakMatchesLevel(b, level)) matching.push(i);
    });
    for (const i of matching.slice(1)) {
      if (reported.has(i)) continue;
      reported.add(i);
      report(['breaks', i], `This break overlaps break #${matching[0]! + 1} after level ${level}; each level may have at most one break.`);
    }
  }
}

function levelWithinSchedule(
  enabled: boolean,
  untilLevel: number,
  levels: number,
  path: PathSegment[],
  what: string,
  report: (path: PathSegment[], message: string) => void,
): void {
  if (!enabled || levels === 0) return;
  if (untilLevel < 1 || untilLevel > levels) {
    report(path, `${what} must end at a level between 1 and ${levels}.`);
  }
}

const lateRegistrationWithinSchedule: CrossCheck = {
  id: 'lateRegistrationWithinSchedule',
  deps: ['lateRegistration', 'blindSchedule'],
  run(cfg, report) {
    const lr = cfg.lateRegistration;
    levelWithinSchedule(lr.enabled, lr.untilLevel, cfg.blindSchedule.length, ['lateRegistration', 'untilLevel'], 'Late registration', report);
  },
};

const reentryWithinSchedule: CrossCheck = {
  id: 'reentryWithinSchedule',
  deps: ['reentry', 'blindSchedule'],
  run(cfg, report) {
    const r = cfg.reentry;
    levelWithinSchedule(r.enabled, r.untilLevel, cfg.blindSchedule.length, ['reentry', 'untilLevel'], 'Re-entry', report);
  },
};

const actionTimer: CrossCheck = {
  id: 'actionTimer',
  deps: ['timing', 'speedMode'],
  run(cfg, report) {
    if (!cfg.speedMode && cfg.timing.actionTimerSeconds < CONFIG_LIMITS.MIN_ACTION_TIMER_SECONDS_NORMAL) {
      report(
        ['timing', 'actionTimerSeconds'],
        `The action timer must be at least ${CONFIG_LIMITS.MIN_ACTION_TIMER_SECONDS_NORMAL} seconds (shorter timers require speed mode).`,
      );
    }
  },
};

const scheduledTimes: CrossCheck = {
  id: 'scheduledTimes',
  deps: ['autoStart', 'startTime', 'registrationDeadline'],
  run(cfg, report) {
    if (cfg.autoStart && cfg.startTime === null) {
      report(['startTime'], 'Auto-start needs a scheduled start time.');
    }
    if (cfg.registrationDeadline !== null && cfg.startTime !== null && cfg.registrationDeadline > cfg.startTime) {
      report(['registrationDeadline'], 'The registration deadline must not be after the scheduled start.');
    }
  },
};

const prizePlacesFitField: CrossCheck = {
  id: 'prizePlacesFitField',
  deps: ['prizeStructure', 'maxPlayers', 'reentry'],
  run(cfg, report) {
    const entries = maxPossibleEntries(cfg);
    if (BigInt(cfg.prizeStructure.places.length) > entries) {
      report(
        ['prizeStructure', 'places'],
        `There are more paid places (${cfg.prizeStructure.places.length}) than possible entries (${entries.toString()}).`,
      );
    }
  },
};

/** Every cross-field rule, in reporting order. */
export const CROSS_CHECKS: readonly CrossCheck[] = [
  playerLimits,
  stackCoversFirstBigBlind,
  totalChipsSafe,
  antesMatchType,
  levelDurations,
  breaksWithinSchedule,
  lateRegistrationWithinSchedule,
  reentryWithinSchedule,
  actionTimer,
  scheduledTimes,
  prizePlacesFitField,
];
