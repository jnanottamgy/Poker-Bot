import { describe, expect, it } from 'vitest';
import { CANONICAL_DECK, DECK_SIZE, TOURNAMENT_TRANSITIONS, canTransitionTournament } from '../src';

describe('canonical deck', () => {
  it('has 52 unique cards in the documented order', () => {
    expect(CANONICAL_DECK).toHaveLength(DECK_SIZE);
    expect(new Set(CANONICAL_DECK).size).toBe(DECK_SIZE);
    expect(CANONICAL_DECK[0]).toBe('2c');
    expect(CANONICAL_DECK[12]).toBe('Ac');
    expect(CANONICAL_DECK[13]).toBe('2d');
    expect(CANONICAL_DECK[51]).toBe('As');
  });
});

describe('tournament transitions', () => {
  it('terminal states have no exits', () => {
    expect(TOURNAMENT_TRANSITIONS.COMPLETED).toEqual([]);
    expect(TOURNAMENT_TRANSITIONS.CANCELLED).toEqual([]);
  });
  it('rejects skipping registration', () => {
    expect(canTransitionTournament('DRAFT', 'RUNNING')).toBe(false);
    expect(canTransitionTournament('RUNNING', 'BREAK')).toBe(true);
  });
});
