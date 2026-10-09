import { useEffect, useRef, useState } from 'react';
import type { TournamentFairnessDto } from '@jpb/shared-types';
import { Button, DescriptionList, Icon, Panel, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { recomputeEntropy } from './engine';
import { HashValue, VerdictPill } from './ui';

interface Recompute {
  status: 'idle' | 'running' | 'VERIFIED' | 'FAILED' | 'NOT_AVAILABLE' | 'error';
  derived: string | null;
  seeds: number;
  detail: string;
}

const IDLE: Recompute = { status: 'idle', derived: null, seeds: 0, detail: '' };

/** Public entropy, its inputs and an in-browser recomputation from the published client seeds. */
export function EntropyPanel({ tournamentId, fairness }: { tournamentId: string; fairness: TournamentFairnessDto }) {
  const api = useApi();
  const [r, setR] = useState<Recompute>(IDLE);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => setR(IDLE), [tournamentId, fairness.publicEntropy]);
  const { clientSeedCount, adminEntropy } = fairness.entropyInputs;
  const noEntropy = clientSeedCount === 0 && !adminEntropy;

  const run = async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setR({ ...IDLE, status: 'running' });
    try {
      // The export carries the full input list; one hand keeps it small.
      const bundle = await api.fairness.bundle(tournamentId, { fromHand: 0, toHand: 0 }, c.signal);
      if (c.signal.aborted) return;
      const inputs = bundle.entropyInputs;
      if (!inputs) {
        setR({ status: 'NOT_AVAILABLE', derived: null, seeds: 0, detail: 'The export does not include the entropy inputs, so the value cannot be recomputed.' });
        return;
      }
      const derived = recomputeEntropy(inputs.clientSeeds, inputs.adminEntropy);
      const ok = derived !== null && derived === fairness.publicEntropy;
      setR({
        status: ok ? 'VERIFIED' : 'FAILED',
        derived,
        seeds: inputs.clientSeeds.length,
        detail: ok
          ? `SHA-256 of the ${formatCount(inputs.clientSeeds.length)} published client seed(s)${inputs.adminEntropy ? ' and the admin entropy' : ''} equals the public entropy.`
          : derived === null
            ? 'The published inputs are not valid client seeds.'
            : 'The published inputs do NOT hash to the public entropy.',
      });
    } catch (err) {
      if (c.signal.aborted) return;
      setR({ ...IDLE, status: 'error', detail: friendlyError(err).description });
    }
  };

  return (
    <Panel title="Public entropy" icon="users" description="Frozen once at START from every player's client seed (sorted) plus optional admin entropy. It can never change afterwards." className="acr-fair-entropy">
      <DescriptionList
        columns={1}
        items={[
          { label: 'Public entropy', value: <HashValue value={fairness.publicEntropy} what="Public entropy" emptyText="Not fixed yet — it is computed once when the tournament starts." /> },
          { label: 'Client seeds (inputs)', value: <span className="jpb-num">{formatCount(clientSeedCount)}</span> },
          { label: 'Admin entropy', value: adminEntropy ? <HashValue value={adminEntropy} what="Admin entropy" /> : <span className="acr-fair-dim">None</span> },
          { label: 'Formula', value: <code className="acr-fair-code">SHA-256("JPB/v1/entropy|" + sort(clientSeeds).join(",") + "|" + adminEntropy)</code> },
        ]}
      />
      {fairness.publicEntropy && noEntropy && (
        <p className="acr-fair-note" role="note">
          <Icon name="warning" /> No client seeds and no admin entropy: the entropy is a constant, so it adds no protection against precomputed decks (docs/FAIRNESS.md N10). Integrity checks still apply.
        </p>
      )}
      {fairness.publicEntropy && (
        <div className="acr-fair-recompute" aria-live="polite">
          <Button size="sm" variant="secondary" icon="refresh" onClick={() => void run()} loading={r.status === 'running'} loadingLabel="Recomputing…">
            Recompute in this browser
          </Button>
          {r.status !== 'idle' && r.status !== 'running' && (
            <div className="acr-fair-recompute__result">
              {r.status === 'error' ? <VerdictPill status="NOT_AVAILABLE" size="sm" /> : <VerdictPill status={r.status} size="sm" />}
              <span>{r.status === 'error' ? `Could not load the inputs. ${r.detail}` : r.detail}</span>
              {r.status === 'FAILED' && r.derived && (
                <span className="acr-fair-dim">
                  Recomputed: <code>{r.derived}</code>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
