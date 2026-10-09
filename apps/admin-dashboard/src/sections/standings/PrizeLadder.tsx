import { useMemo, useState } from 'react';
import type { PrizeStructure, TournamentStatus } from '@jpb/shared-types';
import { Button, EmptyState, Icon, Panel, StatusPill, cx, formatCount, formatMoneyMinor, formatOrdinal } from '@jpb/ui';
import { VirtualGrid } from './VirtualGrid';
import type { GridColumn } from './VirtualGrid';
import { bandIndexOf, bandPositions, bandState, bubbleState, bubbleText, ladderBands, prizePoolMinor } from './model';
import type { BandState, LadderBand } from './model';

const BAND_ROW_HEIGHT = 44;

const STATE_META: Readonly<Record<BandState, { label: string; icon: 'check-circle' | 'activity' | 'dot' }>> = {
  decided: { label: 'Decided', icon: 'check-circle' },
  partly: { label: 'Deciding', icon: 'activity' },
  'in-play': { label: 'In play', icon: 'dot' },
};

export interface PrizeLadderProps {
  prizes: PrizeStructure | null;
  /** Players still holding chips (positions 1..remaining are undecided). */
  remaining: number | null;
  status: TournamentStatus | null;
}

/**
 * §2.12 prize ladder alongside the standings: equal consecutive prizes are
 * banded, decided places are ticked, the band the next elimination lands in
 * is marked, and the money bubble is spelled out.
 */
export function PrizeLadder({ prizes, remaining, status }: PrizeLadderProps) {
  const places = prizes?.places ?? [];
  const currency = prizes?.currency ?? 'INR';
  const bands = useMemo(() => ladderBands(places), [places]);
  const completed = status === 'COMPLETED' || status === 'CANCELLED';
  const paid = places.length;
  const pool = prizePoolMinor(places);
  const bubble = bubbleText(bubbleState(remaining, paid, status));
  const nextIndex = remaining !== null && !completed && remaining <= paid ? bandIndexOf(bands, remaining) : null;
  const [jump, setJump] = useState<{ index: number; seq: number } | null>(null);

  const columns: Array<GridColumn<LadderBand>> = [
    {
      key: 'places',
      header: 'Place',
      track: 'minmax(96px, 1.3fr)',
      cell: (b) => (
        <span className="acr-standings-band">
          <span className="jpb-num acr-standings-band__pos">{bandPositions(b)}</span>
          {b.label && <span className="acr-standings-band__label">{b.label}</span>}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Prize',
      track: 'minmax(96px, 1fr)',
      num: true,
      cell: (b) => (
        <span className="acr-standings-band__amount">
          <span className="jpb-num">{formatMoneyMinor(b.amountMinor, currency)}</span>
          {b.to > b.from && <span className="acr-standings-band__each">each · {formatCount(b.to - b.from + 1)} places</span>}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'State',
      track: '96px',
      cell: (b) => {
        const s = bandState(b, remaining, completed);
        const isNext = nextIndex !== null && bands[nextIndex] === b;
        return (
          <span className={cx('acr-standings-bandstate', `is-${s}`, isNext && 'is-next')}>
            <Icon name={isNext ? 'arrow-right' : STATE_META[s].icon} />
            {isNext ? 'Next out' : STATE_META[s].label}
          </span>
        );
      },
    },
  ];

  return (
    <Panel
      title="Prize ladder"
      icon="trophy"
      className="acr-standings-ladder"
      description={paid > 0 ? `${formatCount(paid)} paid ${paid === 1 ? 'place' : 'places'} · pool ${formatMoneyMinor(pool, currency)}` : 'No prizes configured'}
      actions={
        nextIndex !== null ? (
          <Button size="sm" variant="ghost" icon="arrow-down" onClick={() => setJump((j) => ({ index: nextIndex, seq: (j?.seq ?? 0) + 1 }))}>
            Next out
          </Button>
        ) : undefined
      }
      flush
    >
      <div className={cx('acr-standings-bubble', `is-${bubble.tone}`)} role="status">
        <StatusPill tone={bubble.tone} icon={bubble.icon} label={bubble.title} size="sm" />
        <p>{bubble.detail}</p>
      </div>
      {paid === 0 ? (
        <EmptyState compact icon="trophy" title="No prize places" description="Prizes are set in the tournament setup (Prizes step) before the start." />
      ) : (
        <>
          <VirtualGrid
            label="Prize ladder"
            total={bands.length}
            rowAt={(i) => bands[i] ?? null}
            columns={columns}
            rowHeight={BAND_ROW_HEIGHT}
            minWidth={300}
            jumpTo={jump}
            rowClassName={(b) => `is-${bandState(b, remaining, completed)}`}
            className="acr-standings-ladder__grid"
          />
          <p className="acr-standings-ladder__foot">
            <Icon name="info" /> {formatOrdinal(paid + 1)} place and below: no prize. Tied players split the prizes of the places they cover.
          </p>
          {prizes?.notes && (
            <p className="acr-standings-ladder__notes">
              <Icon name="award" /> {prizes.notes}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
