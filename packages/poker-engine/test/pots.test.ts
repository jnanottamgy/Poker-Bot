import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildPots, findUncalled } from '../src';

const c = (seat: number, amount: number, folded = false) => ({ seat, amount, folded });

describe('buildPots', () => {
  it('single pot when everyone matched', () => {
    const r = buildPots([c(0, 100), c(1, 100), c(2, 100)]);
    expect(r.uncalled).toBeNull();
    expect(r.pots).toEqual([
      { index: 0, type: 'MAIN', amount: 300, eligibleSeats: [0, 1, 2], contributorSeats: [0, 1, 2] },
    ]);
  });

  it('two-player all-in: uncalled excess returned, one pot', () => {
    const r = buildPots([c(0, 1000), c(1, 300)]);
    expect(r.uncalled).toEqual({ seat: 0, amount: 700 });
    expect(r.pots).toEqual([{ index: 0, type: 'MAIN', amount: 600, eligibleSeats: [0, 1], contributorSeats: [0, 1] }]);
  });

  it('three-player all-in with different stacks creates main + side pots', () => {
    const r = buildPots([c(0, 100), c(1, 300), c(2, 500)]);
    expect(r.uncalled).toEqual({ seat: 2, amount: 200 });
    expect(r.pots.map((p) => [p.type, p.amount, p.eligibleSeats])).toEqual([
      ['MAIN', 300, [0, 1, 2]],
      ['SIDE', 400, [1, 2]],
    ]);
  });

  it('four players, three all-in levels', () => {
    const r = buildPots([c(0, 50), c(1, 200), c(2, 400), c(3, 400)]);
    expect(r.uncalled).toBeNull();
    expect(r.pots.map((p) => [p.amount, p.eligibleSeats])).toEqual([
      [200, [0, 1, 2, 3]],
      [450, [1, 2, 3]],
      [400, [2, 3]],
    ]);
  });

  it('folded contributors stay in the pots but are never eligible', () => {
    const r = buildPots([c(0, 100), c(1, 300, true), c(2, 300), c(3, 300)]);
    expect(r.pots.map((p) => [p.amount, p.eligibleSeats, p.contributorSeats])).toEqual([
      [400, [0, 2, 3], [0, 1, 2, 3]],
      [600, [2, 3], [1, 2, 3]],
    ]);
  });

  it('a layer whose contributors all folded merges into the next lower layer', () => {
    // Seats 0 and 3 are live at 50; seats 1 and 2 put in 100 each and folded.
    const r = buildPots([c(0, 50), c(1, 100, true), c(2, 100, true), c(3, 50)]);
    expect(r.uncalled).toBeNull();
    expect(r.pots).toHaveLength(1);
    expect(r.pots[0]).toMatchObject({ amount: 300, eligibleSeats: [0, 3] });
  });

  it('dead chips of a folded player above every live player go to the highest live pot', () => {
    const r = buildPots([c(0, 50), c(1, 150), c(2, 200, true), c(3, 180, true)]);
    // Uncalled: 200 vs 180 -> 20 back to folded seat 2.
    expect(r.uncalled).toEqual({ seat: 2, amount: 20 });
    // Layers: 0-50 (all four) = 200 for [0,1]; 50-150 = 300 for [1]; 150-180 (folded only) = 60 merges down.
    expect(r.pots.map((p) => [p.amount, p.eligibleSeats])).toEqual([
      [200, [0, 1]],
      [360, [1]],
    ]);
    expect(r.pots.reduce((s, p) => s + p.amount, 0)).toBe(50 + 150 + 180 + 180);
  });

  it('adjacent layers with identical eligible sets are merged', () => {
    const r = buildPots([c(0, 50), c(1, 100, true), c(2, 200), c(3, 200)]);
    expect(r.pots.map((p) => [p.amount, p.eligibleSeats])).toEqual([
      [200, [0, 2, 3]],
      [350, [2, 3]],
    ]);
  });

  it('uncalled bet is returned even to a player who folded', () => {
    expect(findUncalled([c(0, 30), c(1, 50, true)])).toEqual({ seat: 1, amount: 20 });
  });

  it('no uncalled when the top contribution is shared', () => {
    expect(findUncalled([c(0, 100), c(1, 100), c(2, 20)])).toBeNull();
  });

  it('dead money goes to the main pot', () => {
    const r = buildPots([c(0, 100), c(1, 100), c(2, 40)], { deadMoney: 25 });
    expect(r.pots.map((p) => p.amount)).toEqual([145, 120]);
  });

  it('dead money with no contested layers forms a main pot for the live players', () => {
    const r = buildPots([c(0, 100), c(1, 0, true)], { deadMoney: 100 });
    expect(r.uncalled).toEqual({ seat: 0, amount: 100 });
    expect(r.pots).toEqual([{ index: 0, type: 'MAIN', amount: 100, eligibleSeats: [0], contributorSeats: [] }]);
  });

  it('throws on malformed input', () => {
    expect(() => buildPots([c(0, -1)])).toThrow(RangeError);
    expect(() => buildPots([c(0, 1.5)])).toThrow(RangeError);
    expect(() => buildPots([c(0, 5), c(0, 5)])).toThrow(RangeError);
    expect(() => buildPots([c(0, 5, true), c(1, 5, true)])).toThrow(RangeError);
  });

  it('property: pots + uncalled conserve chips; eligibility is non-folded and nested', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ amount: fc.integer({ min: 0, max: 10_000 }), folded: fc.boolean() }), {
          minLength: 2,
          maxLength: 10,
        }),
        (raw) => {
          const contribs = raw.map((r, seat) => ({ seat, ...r }));
          // A valid hand always has a live contributor.
          if (!contribs.some((x) => !x.folded && x.amount > 0)) return;
          const r = buildPots(contribs);
          const total = contribs.reduce((s, x) => s + x.amount, 0);
          expect(r.pots.reduce((s, p) => s + p.amount, 0) + (r.uncalled?.amount ?? 0)).toBe(total);
          for (const p of r.pots) {
            expect(p.eligibleSeats.length).toBeGreaterThan(0);
            for (const s of p.eligibleSeats) expect(contribs[s]?.folded).toBe(false);
            expect(p.amount).toBeGreaterThan(0);
          }
          for (let i = 1; i < r.pots.length; i++) {
            const lower = new Set(r.pots[i - 1]?.eligibleSeats);
            expect(r.pots[i]?.eligibleSeats.every((s) => lower.has(s))).toBe(true);
            expect(r.pots[i]?.eligibleSeats.length).toBeLessThan(r.pots[i - 1]?.eligibleSeats.length ?? 0);
          }
        },
      ),
      { numRuns: 2_000, seed: 1 },
    );
  });
});
