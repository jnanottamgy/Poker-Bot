import { useState } from 'react';
import { Link } from 'react-router';
import type { HandListItemDto, Paginated } from '@jpb/shared-types';
import { Button, EmptyState, ErrorState, Icon, Panel, Skeleton, Spinner, cx, formatChips, formatCount } from '@jpb/ui';
import { useApi } from '../../api/ApiProvider';
import { friendlyError } from '../../api/errors';
import { qk } from '../../api/query/keys';
import { useQuery } from '../../api/query/useQuery';
import type { HandsQuery } from '../../api/types';
import { sectionHref } from '../../app/sections';
import { formatTimeOfDay } from '../../lib/time';
import { parseHandNumber } from '../hands/model';
import { DeckView } from './DeckView';
import { downloadJson } from './engine';
import { CheckList, HashValue, VerdictPill } from './ui';
import { useHandVerification } from './useFairness';

const MATCHES = 8;
const RECENT = 6;

function HandChoice({ h, active, onPick }: { h: HandListItemDto; active: boolean; onPick: (id: string) => void }) {
  return (
    <button
      type="button"
      className={cx('acr-fair-pick', active && 'is-on')}
      aria-pressed={active}
      aria-label={`Hand #${h.handNumber}, table ${h.tableNumber}, pot ${formatChips(h.totalPot)}`}
      onClick={() => onPick(h.handId)}
    >
      <span className="acr-fair-pick__no jpb-num">#{formatCount(h.handNumber)}</span>
      <span className="acr-fair-pick__meta">
        Table {h.tableNumber} · pot {formatChips(h.totalPot)}
        {h.completedAt ? ` · ${formatTimeOfDay(h.completedAt)}` : ''}
      </span>
    </button>
  );
}

/** Find a hand by number (several tables share hand numbers) or paste its id. */
function HandPicker({ tournamentId, handId, onPick }: { tournamentId: string; handId: string | null; onPick: (id: string | null) => void }) {
  const api = useApi();
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState<number | null>(null);
  const q: HandsQuery = { handNumber: submitted ?? undefined, offset: 0, limit: MATCHES };
  const matches = useQuery<Paginated<HandListItemDto>>(qk.hands(tournamentId, q), (s) => api.hands.list(tournamentId, q, s), { enabled: submitted !== null });
  const rq: HandsQuery = { offset: 0, limit: RECENT };
  const recent = useQuery<Paginated<HandListItemDto>>(qk.hands(tournamentId, rq), (s) => api.hands.list(tournamentId, rq, s), { staleMs: 15_000 });

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    const n = parseHandNumber(t);
    if (n !== null) setSubmitted(n);
    else {
      setSubmitted(null);
      onPick(t);
    }
  };

  return (
    <div className="acr-fair-picker">
      <form
        className="acr-fair-picker__form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="acr-fair-picker__label" htmlFor="acr-fair-hand-input">
          Hand number or hand id
        </label>
        <div className="acr-fair-picker__row">
          <input id="acr-fair-hand-input" className="jpb-input" placeholder="e.g. 1234 or hand_…" value={text} onChange={(e) => setText(e.target.value.slice(0, 120))} autoComplete="off" />
          <Button type="submit" variant="secondary" icon="search">
            Find
          </Button>
        </div>
      </form>
      {submitted !== null && (
        <div className="acr-fair-picker__results" aria-live="polite">
          {matches.isLoading ? (
            <p className="acr-fair-dim">
              <Spinner size="sm" /> Looking for hand #{formatCount(submitted)}…
            </p>
          ) : (matches.data?.rows.length ?? 0) === 0 ? (
            <p className="acr-fair-dim">No hand #{formatCount(submitted)} yet.</p>
          ) : (
            <>
              <p className="acr-fair-picker__hint">
                {formatCount(matches.data!.total)} table{matches.data!.total === 1 ? '' : 's'} played a hand #{formatCount(submitted)}
                {matches.data!.total > MATCHES ? ` — showing ${MATCHES}; filter by table on the Hands screen for the rest` : ''}:
              </p>
              <div className="acr-fair-picks">
                {matches.data!.rows.map((h) => (
                  <HandChoice key={h.handId} h={h} active={h.handId === handId} onPick={onPick} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {(recent.data?.rows.length ?? 0) > 0 && (
        <div className="acr-fair-picker__recent">
          <span className="acr-fair-picker__hint">Latest hands:</span>
          <div className="acr-fair-picks">
            {recent.data!.rows.map((h) => (
              <HandChoice key={h.handId} h={h} active={h.handId === handId} onPick={onPick} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VerificationResult({ tournamentId, handId, seedOverride }: { tournamentId: string; handId: string; seedOverride: string | null | undefined }) {
  const v = useHandVerification(tournamentId, handId, seedOverride);
  const api = useApi();
  const detail = useQuery(qk.hand(handId), (s) => api.hands.detail(handId, s), { staleMs: 5 * 60_000 });
  const [showDeck, setShowDeck] = useState(true);

  if (v.record.isLoading || v.fairness.isLoading) {
    return (
      <div className="acr-fair-result" aria-busy="true" aria-label="Loading the hand record">
        <Skeleton shape="block" height={64} />
        <Skeleton shape="block" height={260} />
      </div>
    );
  }
  if (!v.record.data || !v.fairness.data || !v.verification) {
    const f = friendlyError(v.record.error ?? v.fairness.error);
    return <ErrorState title={f.status === 404 ? 'No such hand in this tournament' : 'Could not load the hand record'} description={f.status === 404 ? 'Check the hand number or id.' : f.description} onRetry={f.status === 404 ? undefined : () => void v.record.refetch()} />;
  }
  const record = v.record.data;
  const t = v.fairness.data;
  const { result, ms } = v.verification;
  const sameCommitment = record.serverSeedHash.toLowerCase() === t.serverSeedHash.toLowerCase();
  const sameEntropy = t.publicEntropy !== null && record.publicEntropy === t.publicEntropy;
  const h = detail.data;

  return (
    <div className="acr-fair-result">
      <div className={cx('acr-fair-verdictbar', `is-${result.status.toLowerCase()}`)}>
        <div className="acr-fair-verdictbar__main">
          <VerdictPill status={result.status} />
          <div>
            <p className="acr-fair-verdictbar__title">
              Hand #{formatCount(record.handNumber)}
              {h ? ` · Table ${h.tableNumber}` : ''}
            </p>
            <p className="acr-fair-dim">
              {v.seedSource === 'none'
                ? 'The server seed is still secret, so the cards cannot be checked yet. The record and its commitment are shown below.'
                : v.seedSource === 'missing'
                  ? 'Enter a valid seed above (or switch back to the revealed seed) to check the cards.'
                : `Verified in this browser in ${ms < 1 ? '<1' : Math.round(ms)} ms with the portable fairness engine, using the ${v.seedSource === 'provided' ? 'seed you entered' : 'revealed seed'}. The server was not asked for a verdict.`}
            </p>
          </div>
        </div>
        <div className="acr-fair-verdictbar__actions">
          <Link className="jpb-btn jpb-btn--secondary jpb-btn--sm acr-buttonlink" to={sectionHref('hand-detail', tournamentId, { handId })}>
            <Icon name="play" className="jpb-btn__icon" />
            <span className="jpb-btn__label">Replay</span>
          </Link>
          <Button size="sm" variant="ghost" icon="download" onClick={() => downloadJson(`hand-${record.handNumber}-${record.tableId}-fairness.json`, { serverSeed: v.seed, record })}>
            Record JSON
          </Button>
        </div>
      </div>
      <CheckList checks={result.checks} />
      <div className="acr-fair-binding">
        <p className="acr-fair-binding__title">This record is bound to the tournament</p>
        <ul>
          <li className={sameCommitment ? 'is-ok' : 'is-bad'}>
            <Icon name={sameCommitment ? 'check-circle' : 'x-circle'} /> {sameCommitment ? 'Same seed commitment as the tournament' : 'DIFFERENT seed commitment from the tournament'}
          </li>
          <li className={sameEntropy ? 'is-ok' : 'is-bad'}>
            <Icon name={sameEntropy ? 'check-circle' : 'x-circle'} /> {sameEntropy ? 'Same public entropy as the tournament' : 'DIFFERENT public entropy from the tournament'}
          </li>
          {result.withheldSeats.length > 0 && (
            <li className="is-warn">
              <Icon name="warning" /> Hole cards withheld for seat {result.withheldSeats.map((s) => s + 1).join(', ')} (not checked)
            </li>
          )}
        </ul>
      </div>
      <details className="acr-fair-inputs">
        <summary>Inputs used</summary>
        <dl>
          <div>
            <dt>Deck label</dt>
            <dd>
              <HashValue value={result.derived?.label ?? null} what="Deck label" emptyText="Not derived" />
            </dd>
          </div>
          <div>
            <dt>Seed</dt>
            <dd>
              <HashValue value={v.seed} what="Seed" emptyText="Not revealed" />
            </dd>
          </div>
          <div>
            <dt>Published deck hash</dt>
            <dd>
              <HashValue value={record.deckHash} what="Published deck hash" />
            </dd>
          </div>
          <div>
            <dt>Derived deck hash</dt>
            <dd>
              <HashValue value={result.derived?.deckHash ?? null} what="Derived deck hash" emptyText="Not derived" />
            </dd>
          </div>
          <div>
            <dt>Button / table size</dt>
            <dd className="jpb-num">
              Seat {record.buttonSeat + 1} · {record.maxSeats} seats · {record.holeCards.length} dealt in
            </dd>
          </div>
        </dl>
      </details>
      {result.derived && (
        <div className="acr-fair-deckwrap">
          <Button size="sm" variant="ghost" icon={showDeck ? 'chevron-up' : 'chevron-down'} onClick={() => setShowDeck((x) => !x)} aria-expanded={showDeck}>
            {showDeck ? 'Hide' : 'Show'} the derived deck
          </Button>
          {showDeck && <DeckView record={record} result={result} />}
        </div>
      )}
    </div>
  );
}

export interface HandVerifierProps {
  tournamentId: string;
  handId: string | null;
  onHandChange: (handId: string | null) => void;
  /** undefined = revealed seed; string = typed seed; null = typed seed missing / invalid. */
  seedOverride: string | null | undefined;
}

/** §2.11 per-hand verification: SEED COMMITMENT · DECK HASH · HOLE CARDS · BOARD, computed in the browser. */
export function HandVerifier({ tournamentId, handId, onHandChange, seedOverride }: HandVerifierProps) {
  return (
    <Panel title="Verify a hand" icon="shield" description="Recomputes the deck from the seed in this browser and compares every published card with its position." className="acr-fair-verify">
      <HandPicker tournamentId={tournamentId} handId={handId} onPick={onHandChange} />
      {handId ? (
        <VerificationResult key={handId} tournamentId={tournamentId} handId={handId} seedOverride={seedOverride} />
      ) : (
        <EmptyState compact icon="shield" title="Pick a hand to verify" description='Enter a hand number, choose one of the latest hands, or use "Verify this hand" on any hand detail page.' />
      )}
    </Panel>
  );
}
