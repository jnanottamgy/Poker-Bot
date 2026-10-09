import type { TournamentConfig } from '@jpb/shared-types';
import { randomUint32 } from '@jpb/client-sdk';
import { CONFIG_LIMITS, defaultTournamentConfig } from '@jpb/validation';
import { firstAnteLevel } from './blinds';
import type { StepId } from './steps';

/**
 * The wizard's working state: the TournamentConfig being edited (sent to the
 * server as-is) plus a little UI metadata that is never sent.
 */
export interface DraftMeta {
  /** Join code follows the name until the operator types one. */
  joinCodeAuto: boolean;
  /** Short random tail of the automatic join code (fixed for this draft). */
  joinCodeSuffix: string;
  /** Starting stack the blind schedule was generated / scaled for ("scale to starting stack"). */
  scheduleBaseStack: number;
  /** Antes start at this level when antes are (re)computed. */
  anteFromLevel: number;
  /** Players in the "N players → T tables" preview (null = the maximum). */
  previewPlayers: number | null;
}

export interface WizardDraft {
  config: TournamentConfig;
  meta: DraftMeta;
  step: StepId;
}

const JOIN_CODE_MIN = 4;
const JOIN_CODE_MAX = 12;
/** Characters of the name part of an automatic join code (the suffix fills the rest). */
const JOIN_CODE_CORE = 10;
/** Letters kept from the first word when the name is abbreviated. */
const MIN_FIRST_WORD = 3;
const SUFFIX_DIGITS = 2;
/** Unambiguous characters for generated codes (no 0/O, 1/I/L). */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const ACCESS_CODE_GROUP = 4;

/** Two random digits (Web Crypto via @jpb/client-sdk — never Math.random). */
export function newJoinCodeSuffix(): string {
  return String(randomUint32() % 10 ** SUFFIX_DIGITS).padStart(SUFFIX_DIGITS, '0');
}

/** "XXXX-XXXX" venue access code (matches ACCESS_CODE_PATTERN). */
export function newAccessCode(): string {
  const pick = () => CODE_ALPHABET[randomUint32() % CODE_ALPHABET.length]!;
  const group = () => Array.from({ length: ACCESS_CODE_GROUP }, pick).join('');
  return `${group()}-${group()}`;
}

function words(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/['’]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * Automatic join code from the name: the words joined, or (when that is too
 * long) the first word + initials (numbers keep their last two digits), then
 * the draft's random two-digit suffix. "Spring Showdown 2026" + "42" →
 * "SPRINGS2642". Always 4–12 characters of A–Z / 0–9.
 */
export function deriveJoinCode(name: string, suffix: string): string {
  const w = words(name);
  let core = w.join('');
  if (core.length > JOIN_CODE_CORE) {
    const [first = '', ...rest] = w;
    const initials = rest.map((x) => (/^\d+$/.test(x) ? x.slice(-2) : x[0])).join('');
    core = first.slice(0, Math.max(MIN_FIRST_WORD, JOIN_CODE_CORE - initials.length)) + initials;
  }
  core = core.slice(0, JOIN_CODE_CORE) || 'JPB';
  const code = `${core}${suffix.replace(/[^0-9A-Z]/g, '')}`.slice(0, JOIN_CODE_MAX);
  return code.length >= JOIN_CODE_MIN ? code : code.padEnd(JOIN_CODE_MIN, '0');
}

export function metaFor(config: TournamentConfig, joinCodeAuto: boolean, suffix = newJoinCodeSuffix()): DraftMeta {
  return {
    joinCodeAuto,
    joinCodeSuffix: suffix,
    scheduleBaseStack: config.startingStack,
    anteFromLevel: firstAnteLevel(config.blindSchedule),
    previewPlayers: null,
  };
}

/** A fresh "create" draft: the spec defaults with an automatic join code. */
export function newDraft(): WizardDraft {
  const suffix = newJoinCodeSuffix();
  const base = defaultTournamentConfig();
  const config = { ...base, joinCode: deriveJoinCode(base.name, suffix) };
  return { config, meta: metaFor(config, true, suffix), step: 'basics' };
}

/** Draft for editing an existing tournament's configuration. */
export function draftFromConfig(config: TournamentConfig, step: StepId = 'basics'): WizardDraft {
  return { config: structuredClone(config), meta: metaFor(config, false), step };
}

/**
 * A configuration copied from another tournament into a new draft: new
 * name, automatic join code, no schedule-specific dates.
 */
export function copiedDraft(source: TournamentConfig): WizardDraft {
  const suffix = newJoinCodeSuffix();
  const name = `${source.name} (copy)`.slice(0, CONFIG_LIMITS.NAME_MAX_LENGTH);
  const config: TournamentConfig = { ...structuredClone(source), name, joinCode: deriveJoinCode(name, suffix), startTime: null, registrationDeadline: null, autoStart: false };
  return { config, meta: metaFor(config, true, suffix), step: 'basics' };
}
