import { describe, expect, it } from 'vitest';
import type { TournamentConfig } from '@jpb/shared-types';
import {
  BLIND_PRESET_NAMES,
  DEFAULT_STARTING_STACK,
  applyPreset,
  defaultTournamentConfig,
  tournamentConfigSchema,
  validateTournamentConfig,
} from '../src';
import { expectOk } from './fixtures';

describe('defaultTournamentConfig', () => {
  it('is valid', () => {
    expect(validateTournamentConfig(defaultTournamentConfig()).ok).toBe(true);
  });

  it('parses to itself (already normalized)', () => {
    const cfg = defaultTournamentConfig();
    expect(expectOk(validateTournamentConfig(cfg))).toEqual(cfg);
  });

  it('matches the spec defaults', () => {
    const cfg = defaultTournamentConfig();
    expect(cfg.game).toBe('NLH');
    expect(cfg.tables).toEqual({ targetSize: 8, maxSize: 9, minSize: 2, finalTableSize: 9 });
    expect(cfg.startingStack).toBe(DEFAULT_STARTING_STACK);
    expect(cfg.startingStack).toBe(10_000);
    expect(cfg.timing.actionTimerSeconds).toBe(15);
    expect(cfg.lateRegistration.enabled).toBe(false);
    expect(cfg.reentry.enabled).toBe(false);
    expect(cfg.prizeStructure.currency).toBe('INR');
    expect(cfg.spectators.enabled).toBe(true);
    expect(cfg.handForHand.autoAtBubble).toBe(true);
    expect(cfg.speedMode).toBe(false);
    expect(cfg.anteType).toBe('NONE');
    expect(cfg.registration.fields).toContainEqual({ key: 'name', required: true });
  });

  it('uses the spec example blind schedule with 8-minute levels up to level 20', () => {
    const cfg = defaultTournamentConfig();
    const first9 = cfg.blindSchedule.slice(0, 9).map((l) => [l.smallBlind, l.bigBlind]);
    expect(first9).toEqual([
      [50, 100],
      [75, 150],
      [100, 200],
      [150, 300],
      [200, 400],
      [300, 600],
      [500, 1000],
      [750, 1500],
      [1000, 2000],
    ]);
    expect(cfg.blindSchedule).toHaveLength(20);
    expect(cfg.blindSchedule.every((l) => l.durationSeconds === 480 && l.ante === 0)).toBe(true);
    expect(cfg.blindSchedule.map((l) => l.level)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('takes a 10-minute break every 6 levels', () => {
    expect(defaultTournamentConfig().breaks).toEqual([{ everyLevels: 6, durationSeconds: 600, message: 'Scheduled break' }]);
  });

  it('returns a fresh object every call (no shared references)', () => {
    const a = defaultTournamentConfig();
    const b = defaultTournamentConfig();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.blindSchedule).not.toBe(b.blindSchedule);
    expect(a.blindSchedule[0]).not.toBe(b.blindSchedule[0]);
    a.blindSchedule[0]!.bigBlind = 1;
    a.tables.maxSize = 3;
    a.breaks.push({ afterLevel: 1, durationSeconds: 60 });
    expect(defaultTournamentConfig()).toEqual(b);
  });

  it('applies deep overrides: objects merge, arrays and scalars replace', () => {
    const cfg = defaultTournamentConfig({
      name: 'Campus Cup',
      timing: { actionTimerSeconds: 20 },
      tables: { targetSize: 6, maxSize: 6, finalTableSize: 6 },
      breaks: [],
      startTime: 1_700_000_000_000,
    });
    expect(cfg.name).toBe('Campus Cup');
    expect(cfg.timing.actionTimerSeconds).toBe(20);
    expect(cfg.timing.awayActionTimerSeconds).toBe(5);
    expect(cfg.tables).toEqual({ targetSize: 6, maxSize: 6, minSize: 2, finalTableSize: 6 });
    expect(cfg.breaks).toEqual([]);
    expect(cfg.startTime).toBe(1_700_000_000_000);
    expect(validateTournamentConfig(cfg).ok).toBe(true);
  });

  it('ignores undefined overrides and allows null', () => {
    const cfg = defaultTournamentConfig({ name: undefined, registration: { accessCode: 'VENUE-42' } });
    expect(cfg.name).toBe("Johnny's Poker Tournament");
    expect(cfg.registration.accessCode).toBe('VENUE-42');
    expect(defaultTournamentConfig({ registration: { accessCode: null } }).registration.accessCode).toBeNull();
  });

  it('does not alias override arrays', () => {
    const places = [{ position: 1, amountMinor: 100 }];
    const cfg = defaultTournamentConfig({ prizeStructure: { places } });
    places[0]!.amountMinor = 999;
    expect(cfg.prizeStructure.places[0]!.amountMinor).toBe(100);
  });

  it('ignores prototype-polluting keys', () => {
    const overrides = JSON.parse('{"__proto__": {"polluted": true}, "timing": {"__proto__": {"x": 1}}}') as object;
    const cfg = defaultTournamentConfig(overrides);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.getPrototypeOf(cfg)).toBe(Object.prototype);
    expect(validateTournamentConfig(cfg).ok).toBe(true);
  });
});

describe('applyPreset', () => {
  it.each(BLIND_PRESET_NAMES)('%s produces a valid config', (name) => {
    const cfg = applyPreset(defaultTournamentConfig(), name);
    expect(validateTournamentConfig(cfg).ok).toBe(true);
  });

  it('SPEED_TEST switches on speed mode and a 1-2 second action timer', () => {
    const cfg = applyPreset(defaultTournamentConfig(), 'SPEED_TEST');
    expect(cfg.speedMode).toBe(true);
    expect(cfg.timing.actionTimerSeconds).toBeGreaterThanOrEqual(1);
    expect(cfg.timing.actionTimerSeconds).toBeLessThanOrEqual(2);
    expect(cfg.blindSchedule.every((l) => l.durationSeconds === 10)).toBe(true);
    expect(validateTournamentConfig(cfg, { allowSpeedMode: false }).ok).toBe(false);
  });

  it('keeps the ante type and other settings', () => {
    const base = defaultTournamentConfig({ anteType: 'BB_ANTE', name: 'Antes' });
    const cfg = applyPreset(base, 'TURBO');
    expect(cfg.name).toBe('Antes');
    expect(cfg.blindSchedule.every((l) => l.ante === l.bigBlind)).toBe(true);
    expect(validateTournamentConfig(cfg).ok).toBe(true);
  });

  it('does not mutate its input', () => {
    const base = defaultTournamentConfig();
    const snapshot = structuredClone(base);
    applyPreset(base, 'HYPER');
    expect(base).toEqual(snapshot);
  });
});

describe('tournamentConfigSchema', () => {
  it('accepts every TournamentConfig value shape (type-level and runtime)', () => {
    const cfg: TournamentConfig = defaultTournamentConfig();
    const parsed = tournamentConfigSchema.parse(cfg);
    const typed: TournamentConfig = parsed;
    expect(typed).toEqual(cfg);
  });

  it('normalizes text and codes', () => {
    const cfg = expectOk(
      validateTournamentConfig({
        ...defaultTournamentConfig(),
        name: '  Spring\u200B   Classic\t',
        joinCode: ' abc123 ',
        prizeStructure: { currency: 'inr', places: [], notes: ' Trophy\r\n\r\n\r\n\r\nfor the winner ' },
        registration: { fields: [{ key: 'name', required: true }], requireApproval: false, accessCode: 'venue-1' },
      }),
    );
    expect(cfg.name).toBe('Spring Classic');
    expect(cfg.joinCode).toBe('ABC123');
    expect(cfg.prizeStructure.currency).toBe('INR');
    expect(cfg.prizeStructure.notes).toBe('Trophy\n\nfor the winner');
    expect(cfg.registration.accessCode).toBe('VENUE-1');
  });

  it('accepts optional fields when omitted', () => {
    const cfg = defaultTournamentConfig();
    const { notes: _notes, ...prizes } = { ...cfg.prizeStructure, notes: 'x' };
    expect(validateTournamentConfig({ ...cfg, prizeStructure: prizes }).ok).toBe(true);
    expect(validateTournamentConfig({ ...cfg, breaks: [{ afterLevel: 3, durationSeconds: 300 }] }).ok).toBe(true);
  });
});
