import { useState } from 'react';
import { useSearchParams } from 'react-router';
import type { HandListItemDto, Paginated, TournamentFairnessDto } from '@jpb/shared-types';
import { Alert, Button, EmptyState, ErrorState, Icon, Panel, Skeleton, cx, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import { sectionHref } from '../../app/sections';
import { usePermission } from '../../auth/permissions';
import { useTournamentId } from '../../auth/scope';
import { ButtonLink } from '../../components/ButtonLink';
import { PageHeader } from '../../components/PageHeader';
import { useTournamentState } from '../../live/useTournamentState';
import { BulkPanel } from './BulkPanel';
import { CommitmentPanel, useCommitmentCheck } from './CommitmentPanel';
import { EntropyPanel } from './EntropyPanel';
import { ExportPanel } from './ExportPanel';
import { HandVerifier } from './HandVerifier';
import { Instructions, MethodPanel } from './Instructions';
import { seedInputProblem } from './engine';
import { VerdictPill } from './ui';
import { useTournamentFairness } from './useFairness';

const short = (hex: string | null) => (hex ? `${hex.slice(0, 10)}…${hex.slice(-6)}` : '—');

function StatusStrip({ fairness, handsTotal }: { fairness: TournamentFairnessDto; handsTotal: number | null }) {
  const check = useCommitmentCheck(fairness);
  const tiles = [
    { label: 'Commitment', value: short(fairness.serverSeedHash), icon: 'key' as const, foot: 'Published before registration', ok: true },
    { label: 'Public entropy', value: fairness.publicEntropy ? short(fairness.publicEntropy) : 'Not fixed yet', icon: 'users' as const, foot: `${formatCount(fairness.entropyInputs.clientSeedCount)} client seed(s)`, ok: fairness.publicEntropy !== null },
    { label: 'Server seed', value: fairness.seedRevealed ? 'Revealed' : 'Secret', icon: fairness.seedRevealed ? ('eye' as const) : ('lock' as const), foot: fairness.seedRevealed ? 'Anyone can verify every hand' : 'Revealed after the tournament ends', ok: fairness.seedRevealed },
    { label: 'Hands recorded', value: handsTotal === null ? '…' : formatCount(handsTotal), icon: 'list' as const, foot: 'Each with a deck hash', ok: true },
  ];
  return (
    <section className="acr-fair-strip-top" aria-label="Fairness status">
      {tiles.map((t) => (
        <div key={t.label} className={cx('acr-fair-tile', t.ok && 'is-ok')}>
          <span className="acr-fair-tile__icon" aria-hidden="true">
            <Icon name={t.icon} />
          </span>
          <div className="acr-fair-tile__body">
            <span className="acr-fair-tile__label">{t.label}</span>
            <span className="acr-fair-tile__value jpb-mono">{t.value}</span>
            <span className="acr-fair-tile__foot">{t.foot}</span>
          </div>
        </div>
      ))}
      <div className={cx('acr-fair-tile acr-fair-tile--verdict', `is-${check.status.toLowerCase()}`)}>
        <div className="acr-fair-tile__body">
          <span className="acr-fair-tile__label">Seed vs commitment (this browser)</span>
          <VerdictPill status={check.status} />
          <span className="acr-fair-tile__foot">{check.status === 'NOT_AVAILABLE' ? 'Checked once the seed is revealed' : 'SHA-256 recomputed here'}</span>
        </div>
      </div>
    </section>
  );
}

/** Which seed the in-browser verifier uses: the revealed one, or one the operator enters (e.g. from an announcement). */
function SeedSource({ revealed, value, onChange }: { revealed: string | null; value: string | null | undefined; onChange: (seed: string | null | undefined) => void }) {
  const [mode, setMode] = useState<'revealed' | 'custom'>(value === undefined ? 'revealed' : 'custom');
  const [text, setText] = useState(value ?? '');
  const problem = seedInputProblem(text);
  const apply = (t: string) => {
    setText(t);
    const p = seedInputProblem(t);
    onChange(p === null && t.trim() !== '' ? t.trim().toLowerCase() : null);
  };
  return (
    <Panel title="Seed used for verification" icon="key" className="acr-fair-seedsrc">
      <div className="acr-fair-seg" role="group" aria-label="Seed source">
        <button
          type="button"
          className={cx('acr-fair-seg__btn', mode === 'revealed' && 'is-on')}
          aria-pressed={mode === 'revealed'}
          onClick={() => {
            setMode('revealed');
            onChange(undefined);
          }}
        >
          <Icon name="eye" /> Revealed seed{revealed ? '' : ' (not yet revealed)'}
        </button>
        <button
          type="button"
          className={cx('acr-fair-seg__btn', mode === 'custom' && 'is-on')}
          aria-pressed={mode === 'custom'}
          onClick={() => {
            setMode('custom');
            apply(text);
          }}
        >
          <Icon name="key" /> Enter a seed
        </button>
      </div>
      {mode === 'custom' && (
        <label className="acr-fair-field acr-fair-seedsrc__field">
          <span className="acr-fair-field__label">Server seed (64 hex characters)</span>
          <input className="jpb-input jpb-mono" value={text} onChange={(e) => apply(e.target.value.slice(0, 80))} spellCheck={false} autoComplete="off" placeholder="e.g. the seed published in the results announcement" aria-invalid={problem !== null || undefined} />
          {problem && <span className="acr-fair-error">{problem}</span>}
        </label>
      )}
      <p className="acr-fair-dim">
        {mode === 'custom'
          ? 'Every check below uses the seed you entered — useful to confirm a seed published elsewhere matches this tournament.'
          : revealed
            ? 'Checks use the seed revealed by the server; it is itself checked against the commitment.'
            : 'The seed is secret until the tournament is completed or cancelled; card checks report NOT AVAILABLE until then.'}
      </p>
    </Panel>
  );
}

function FairnessSkeleton() {
  return (
    <div className="acr-page acr-fair" aria-busy="true" aria-label="Loading fairness data">
      <Skeleton shape="block" height={96} />
      <div className="acr-fair-grid">
        <Skeleton shape="block" height={520} />
        <Skeleton shape="block" height={520} />
      </div>
    </div>
  );
}

/** §2.11 Fairness & audit of randomness. */
export default function FairnessSection() {
  const tournamentId = useTournamentId();
  const api = useApi();
  const canView = usePermission('FAIRNESS_VIEW');
  const canHands = usePermission('HAND_HISTORY_VIEW');
  const state = useTournamentState(tournamentId);
  const fairness = useTournamentFairness(tournamentId);
  const [params, setParams] = useSearchParams();
  const handId = params.get('hand');
  const [seedOverride, setSeedOverride] = useState<string | null | undefined>(undefined);
  const totalQ = { offset: 0, limit: 1 };
  const handsTotal = useQuery<Paginated<HandListItemDto>>(qk.hands(tournamentId, totalQ), (s) => api.hands.list(tournamentId, totalQ, s), { enabled: canView, staleMs: 15_000, pollMs: 30_000 }).data?.total ?? null;

  const setHand = (id: string | null) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (id) p.set('hand', id);
        else p.delete('hand');
        return p;
      },
      { replace: false },
    );

  const name = state.overview.data?.name;
  if (!canView) {
    return (
      <div className="acr-page acr-fair">
        <PageHeader title="Fairness" icon="shield" eyebrow={name} />
        <EmptyState icon="lock" title="Fairness data is restricted" description="Your role does not include FAIRNESS_VIEW. Ask a tournament director for access." />
      </div>
    );
  }
  if (fairness.isLoading) return <FairnessSkeleton />;
  if (!fairness.data) {
    return (
      <div className="acr-page acr-fair">
        <PageHeader title="Fairness" icon="shield" eyebrow={name} />
        <ErrorState title="Could not load the fairness data" description={friendlyError(fairness.error).description} onRetry={() => void fairness.refetch()} />
      </div>
    );
  }
  const f = fairness.data;
  return (
    <div className="acr-page acr-fair">
      <PageHeader
        title="Fairness & randomness audit"
        icon="shield"
        eyebrow={name}
        description="Commit–reveal: the deck of every hand is fixed by a seed committed before registration. Verification below runs entirely in this browser with the portable fairness engine."
        actions={
          canHands ? (
            <ButtonLink to={sectionHref('hands', tournamentId)} icon="list">
              Hands
            </ButtonLink>
          ) : undefined
        }
      />
      {fairness.isStale && (
        <Alert severity="WARNING" title="Showing the last loaded fairness data" actions={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void fairness.refetch()}>Retry</Button>}>
          A refresh failed. The commitment never changes; the seed status may be out of date.
        </Alert>
      )}
      <div className={cx('acr-fair-content', fairness.isStale && 'jpb-stale')} data-stale={fairness.isStale ? 'true' : undefined}>
        <StatusStrip fairness={f} handsTotal={handsTotal} />
        <div className="acr-fair-grid">
          <div className="acr-fair-main">
            <SeedSource revealed={f.serverSeed} value={seedOverride} onChange={setSeedOverride} />
            <HandVerifier tournamentId={tournamentId} handId={handId} onHandChange={setHand} seedOverride={seedOverride} />
            <BulkPanel tournamentId={tournamentId} seedOverride={seedOverride} seedRevealed={f.seedRevealed} onVerifyHand={(id) => setHand(id)} />
          </div>
          <div className="acr-fair-side">
            <CommitmentPanel tournamentId={tournamentId} fairness={f} status={state.status} />
            <EntropyPanel tournamentId={tournamentId} fairness={f} />
            <ExportPanel tournamentId={tournamentId} total={handsTotal} seedRevealed={f.seedRevealed} />
          </div>
        </div>
        <Instructions serverSeedHash={f.serverSeedHash} joinCode={state.overview.data?.joinCode ?? null} />
        <MethodPanel method={f.method} />
      </div>
    </div>
  );
}
