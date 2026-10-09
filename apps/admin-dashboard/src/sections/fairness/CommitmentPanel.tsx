import { useMemo } from 'react';
import type { TournamentFairnessDto, TournamentStatus } from '@jpb/shared-types';
import { Button, DescriptionList, Icon, Panel, StatusPill, TOURNAMENT_STATUS_META } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { qk } from '../../api/query/keys';
import { useGate } from '../../auth/permissions';
import { useDangerousAction } from '../../danger/DangerProvider';
import { commitmentOf } from './engine';
import { HashValue, VerdictPill } from './ui';

const REVEALABLE: ReadonlySet<TournamentStatus> = new Set(['COMPLETED', 'CANCELLED']);

/** Commitment check computed in this browser: SHA-256(revealed seed bytes) vs the published hash. */
export function useCommitmentCheck(f: TournamentFairnessDto | undefined) {
  return useMemo(() => {
    if (!f?.serverSeed) return { status: 'NOT_AVAILABLE' as const, derived: null };
    const derived = commitmentOf(f.serverSeed);
    return { status: derived !== null && derived === f.serverSeedHash.toLowerCase() ? ('VERIFIED' as const) : ('FAILED' as const), derived };
  }, [f?.serverSeed, f?.serverSeedHash]);
}

export function CommitmentPanel({ tournamentId, fairness, status }: { tournamentId: string; fairness: TournamentFairnessDto; status: TournamentStatus | null }) {
  const api = useApi();
  const danger = useDangerousAction();
  const gate = useGate('FAIRNESS_REVEAL_SEED');
  const check = useCommitmentCheck(fairness);
  const revealable = status !== null && REVEALABLE.has(status);
  const statusText = status ? TOURNAMENT_STATUS_META[status].label : 'unknown';

  const reveal = () =>
    danger({
      level: 2,
      endpoint: 'tournamentRevealSeed',
      word: 'REVEAL',
      title: 'Reveal the server seed',
      summary: 'Publishes the secret server seed of this tournament so that anyone can recompute every deck and verify every hand independently.',
      consequences: [
        'Everyone with access to the fairness page or an export can recompute every deck of every table',
        'The seed is checked against the commitment published before registration opened',
        'This cannot be undone: a revealed seed stays public',
        'A REVEAL_SEED audit entry is written with your name and reason',
      ],
      preview: [
        { label: 'Server seed', before: 'Secret (committed)', after: 'Public' },
        { label: 'Per-hand verification', before: 'NOT AVAILABLE', after: 'Available to every verifier' },
      ],
      confirmLabel: 'Reveal seed',
      run: (d) => api.fairness.revealSeed(tournamentId, d),
      success: 'Server seed revealed — every hand can now be verified',
      invalidate: [qk.fairness(tournamentId), qk.overview(tournamentId), ['hand']],
    });

  return (
    <Panel title="Commitment & server seed" icon="key" description="The seed is fixed before registration opens; only its SHA-256 hash is public until the reveal." className="acr-fair-commit">
      <DescriptionList
        columns={1}
        items={[
          { label: 'Server seed hash (published commitment)', value: <HashValue value={fairness.serverSeedHash} what="Server seed hash" /> },
          {
            label: 'Seed status',
            value: fairness.seedRevealed ? (
              <StatusPill tone="info" icon="eye" label="REVEALED" />
            ) : (
              <StatusPill tone="neutral" icon="lock" label="SECRET (COMMITTED)" />
            ),
          },
          {
            label: 'Revealed server seed',
            value: <HashValue value={fairness.serverSeed} what="Server seed" emptyText="Secret until the tournament is completed or cancelled and a director reveals it." />,
          },
          {
            label: 'Commitment check (computed in this browser)',
            value: (
              <span className="acr-fair-inline">
                <VerdictPill status={check.status} size="sm" />
                <span className="acr-fair-dim">
                  {check.status === 'NOT_AVAILABLE' ? 'Needs the revealed seed.' : check.status === 'VERIFIED' ? 'SHA-256 of the revealed seed equals the commitment.' : 'The revealed seed does NOT hash to the commitment.'}
                </span>
              </span>
            ),
          },
        ]}
      />
      {check.status === 'FAILED' && check.derived && (
        <p className="acr-fair-alert" role="alert">
          <Icon name="critical" />
          <span>
            SHA-256 of the revealed seed is <code>{check.derived}</code>, not the published commitment. Treat every hand of this tournament as unverified and escalate.
          </span>
        </p>
      )}
      {!fairness.seedRevealed && (
        <div className="acr-fair-reveal">
          <div>
            <p className="acr-fair-reveal__title">Reveal seed</p>
            <p className="acr-fair-dim">
              {revealable ? 'The tournament has ended. Revealing lets players and auditors verify every deal.' : `Available after the tournament is completed or cancelled (now: ${statusText}).`}
            </p>
          </div>
          {gate.allowed ? (
            <Button variant="danger-outline" icon="eye" onClick={() => void reveal()} disabled={!revealable} title={revealable ? undefined : 'Only after COMPLETED or CANCELLED'}>
              Reveal seed…
            </Button>
          ) : (
            <span className="acr-fair-lock">
              <Icon name="lock" /> Requires FAIRNESS_REVEAL_SEED
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}
