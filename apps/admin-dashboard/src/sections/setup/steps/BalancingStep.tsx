import type { BalancingConfig } from '@jpb/shared-types';
import { Button, formatCount } from '@jpb/ui';
import { CONFIG_LIMITS, defaultTournamentConfig, jsonEqual } from '@jpb/validation';
import { useWizard } from '../components/context';
import { NumberField } from '../components/fields';
import { Fact, Group, Note } from '../components/Group';
import { isNum } from '../model/format';

type Weights = BalancingConfig['weights'];

const WEIGHTS: ReadonlyArray<{ key: keyof Weights; label: string; hint: string }> = [
  { key: 'blindFairness', label: 'Blind fairness (W.blindFairness)', hint: 'A moved player should reach the big blind about when they would have' },
  { key: 'position', label: 'Position (W.position)', hint: 'Avoid seats between the next button and small blind (skipped blinds)' },
  { key: 'recentMove', label: 'Recent move (W.recentMove)', hint: 'Avoid moving the same player again soon' },
  { key: 'seatCompatibility', label: 'Seat compatibility (W.seatCompatibility)', hint: 'Prefer seats with free neighbours' },
];

/** Step 9 — imbalance tolerance, recent-move window and the documented seat / mover score weights. */
export function BalancingStep() {
  const { config, update } = useWizard();
  const b = config.balancing;
  const target = config.tables.targetSize;
  const defaults = defaultTournamentConfig().balancing;
  const isDefault = jsonEqual({ ...b, consolidateBy: defaults.consolidateBy }, defaults);
  const set = (patch: Partial<BalancingConfig>) => update((c) => ({ ...c, balancing: { ...c.balancing, ...patch } }));
  const setWeight = (key: keyof Weights, v: number) => update((c) => ({ ...c, balancing: { ...c.balancing, weights: { ...c.balancing.weights, [key]: v } } }));

  return (
    <>
      <Note>Advanced. Johnny’s defaults suit almost every event — change these only if you know why.</Note>
      <Group
        title="Table balance"
        icon="split"
        description="Johnny moves players whenever the largest table has more than the tolerance over the smallest, between hands only."
        actions={
          <Button size="sm" variant="ghost" icon="refresh" disabled={isDefault} onClick={() => set({ ...defaults, consolidateBy: b.consolidateBy })}>
            Restore defaults
          </Button>
        }
      >
        <div className="acr-setup-grid acr-setup-grid--3">
          <NumberField path="balancing.maxImbalance" label="Maximum imbalance" required suffix="players" value={b.maxImbalance} onChange={(v) => set({ maxImbalance: v })} hint={`Rebalance when largest − smallest > this (1–${CONFIG_LIMITS.MAX_IMBALANCE})`} />
          <NumberField
            path="balancing.recentMoveWindowHands"
            label="Recent-move window"
            required
            suffix="hands"
            value={b.recentMoveWindowHands}
            onChange={(v) => set({ recentMoveWindowHands: v })}
            hint={`A player moved within this many hands is moved again only as a last resort (0–${formatCount(CONFIG_LIMITS.MAX_RECENT_MOVE_WINDOW_HANDS)})`}
          />
        </div>
        <div className="acr-setup-facts">
          <Fact
            label="Example"
            value={isNum(b.maxImbalance) && isNum(target) ? `${target} vs ${Math.max(0, target - b.maxImbalance - 1)} players` : '—'}
            sub="The smallest gap between two tables that triggers a move"
          />
        </div>
      </Group>

      <Group title="Score weights" icon="sliders" description={`Finite numbers from 0 to ${CONFIG_LIMITS.MAX_WEIGHT.toExponential(0).replace('e+', 'e')}; 0 switches a term off. Lower scores win; ties go to the lowest seat.`}>
        <div className="acr-setup-grid acr-setup-grid--2">
          {WEIGHTS.map((w) => (
            <NumberField key={w.key} path={`balancing.weights.${w.key}`} label={w.label} required decimals value={b.weights[w.key]} onChange={(v) => setWeight(w.key, v)} hint={w.hint} />
          ))}
        </div>
        <div className="acr-setup-formula" aria-label="Documented formulas">
          <p className="acr-setup-formula__title">Seat for an incoming player (@jpb/seating-engine)</p>
          <pre className="jpb-mono">
            {`score(s) = W.blindFairness     × |handsUntilBigBlind(table + s) − expected|
         + W.position          × skipPenalty(s)
         + W.seatCompatibility × adjacencyPenalty(s)`}
          </pre>
          <p className="acr-setup-formula__title">Who moves out (@jpb/balancing-engine)</p>
          <pre className="jpb-mono">
            {`movementScore = W.position   × handsUntilBigBlind(source, seat)
              + W.recentMove × #{moves within the window}
              + W.recentMove × (h < window ? (window − h) ÷ window : 0)`}
          </pre>
        </div>
      </Group>
    </>
  );
}
