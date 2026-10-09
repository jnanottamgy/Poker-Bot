import { useEffect, useMemo, useRef } from 'react';
import { useHref } from 'react-router';
import type { KeyboardEvent } from 'react';
import type { CardCode, HandDetailDto } from '@jpb/shared-types';
import { Icon, IconButton, Panel, PokerTable, cx, formatChips, useReducedMotion } from '@jpb/ui';
import type { TableSeat } from '@jpb/ui';
import { useCopy } from '../fairness/ui';
import { STAGE_LABEL } from './replay';
import type { Replay, ReplayFrame, ReplayStage } from './replay';
import { REPLAY_SPEEDS, useAnimatedValues } from './useReplayPlayer';
import type { ReplayPlayer } from './useReplayPlayer';

export type CardMode = 'all' | 'showdown';

const JUMP_STAGES: readonly ReplayStage[] = ['PREFLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN'];
const STACK_ANIMATION_MS = 420;
/** Smallest distance (fraction of the scrubber) between two street labels. */
const MIN_LABEL_GAP = 0.18;

const KIND_ICON = { start: 'play', action: 'arrow-right', street: 'layers', uncalled: 'arrow-up', showdown: 'eye', award: 'trophy' } as const;

function tableSeats(hand: HandDetailDto, frame: ReplayFrame, stacks: number[], maxSeats: number, cardMode: CardMode): Array<TableSeat | null> {
  const out: Array<TableSeat | null> = Array.from({ length: maxSeats }, () => null);
  const rec = new Map(hand.seats.map((s) => [s.seat, s]));
  frame.seats.forEach((s, i) => {
    if (s.seat < 0 || s.seat >= maxSeats) return;
    const r = rec.get(s.seat);
    const cards = r?.holeCards ?? null;
    const faceUp = cardMode === 'all' || s.shown;
    out[s.seat] = {
      name: s.name,
      stack: stacks[i] ?? s.stack,
      seat: s.seat,
      isButton: hand.buttonSeat === s.seat,
      isSmallBlind: hand.smallBlindSeat === s.seat,
      isBigBlind: hand.bigBlindSeat === s.seat,
      inHand: true,
      folded: s.folded,
      allIn: s.allIn,
      connected: true,
      lastAction: s.lastAction,
      shownCards: faceUp ? cards : null,
      winAmount: s.won > 0 ? s.won : null,
      handDescription: s.shown && r?.finalHand ? r.finalHand.description : null,
      bet: s.bet,
    };
  });
  return out;
}

function SpeedPicker({ player }: { player: ReplayPlayer }) {
  return (
    <div className="acr-hd-seg" role="group" aria-label="Playback speed">
      {REPLAY_SPEEDS.map((s) => (
        <button key={s} type="button" className={cx('acr-hd-seg__btn', player.speed === s && 'is-on')} aria-pressed={player.speed === s} onClick={() => player.setSpeed(s)}>
          {s}×
        </button>
      ))}
    </div>
  );
}

function Timeline({ replay, player }: { replay: Replay; player: ReplayPlayer }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-frame="${player.index}"]`);
    if (!list || !el) return;
    const top = el.offsetTop - list.offsetTop;
    if (top < list.scrollTop + 8 || top + el.offsetHeight > list.scrollTop + list.clientHeight - 8) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2 + el.offsetHeight / 2);
    }
  }, [player.index]);
  return (
    <ol ref={listRef} className="acr-hd-timeline" aria-label="Every step of the hand">
      {replay.frames.map((f, i) => {
        const header = i === 0 || replay.frames[i - 1]!.stage !== f.stage;
        return (
          <li key={i} className="acr-hd-timeline__item">
            {header && f.stage !== 'START' && <span className="acr-hd-timeline__stage">{STAGE_LABEL[f.stage]}</span>}
            <button
              type="button"
              data-frame={i}
              className={cx('acr-hd-timeline__btn', `is-${f.kind}`, i === player.index && 'is-current', i < player.index && 'is-past')}
              aria-current={i === player.index ? 'step' : undefined}
              onClick={() => player.seek(i)}
            >
              <Icon name={KIND_ICON[f.kind]} />
              <span className="acr-hd-timeline__text">{f.caption}</span>
              {f.kind === 'action' && <span className="acr-hd-timeline__pot jpb-num">{formatChips(f.pot)}</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export interface ReplayPanelProps {
  hand: HandDetailDto;
  replay: Replay;
  player: ReplayPlayer;
  maxSeats: number;
  cardMode: CardMode;
  onCardMode: (m: CardMode) => void;
  finalTable?: boolean;
}

/**
 * Action-by-action replay rendered with the @jpb/ui poker table: play /
 * pause / step / seek / speed, stacks and pot animating between steps.
 * Keys (focus inside the panel): Space play/pause, ← → step, Home / End.
 */
export function ReplayPanel({ hand, replay, player, maxSeats, cardMode, onCardMode, finalTable = false }: ReplayPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion(rootRef);
  const frame = replay.frames[player.index] ?? replay.frames[0]!;
  const last = replay.frames.length - 1;
  const stacks = useAnimatedValues(
    frame.seats.map((s) => s.stack),
    STACK_ANIMATION_MS,
    reduced,
  );
  const seats = tableSeats(hand, frame, stacks, maxSeats, cardMode);
  const winning: CardCode[] | undefined = frame.winningCards ?? undefined;
  const copy = useCopy();
  const stepHref = useHref({ search: `?step=${player.index}` });
  const markers = useMemo(() => {
    const total = Math.max(1, replay.frames.length - 1);
    let lastLabelled = -Infinity;
    return JUMP_STAGES.filter((s) => replay.stageStarts[s] !== undefined).map((s) => {
      const index = replay.stageStarts[s]!;
      // Streets dealt back to back (all-in run-outs) would overlap: keep the tick, drop the label.
      const labelled = (index - lastLabelled) / total >= MIN_LABEL_GAP;
      if (labelled) lastLabelled = index;
      return { stage: s, index, labelled };
    });
  }, [replay]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea')) return;
    const onButton = t.closest('button') !== null;
    if ((e.key === ' ' || e.key === 'k') && !onButton) {
      e.preventDefault();
      player.toggle();
    } else if (e.key === 'ArrowRight' || e.key === 'l') {
      e.preventDefault();
      player.step(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'j') {
      e.preventDefault();
      player.step(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      player.seek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      player.seek(last);
    }
  };

  return (
    <Panel
      title="Replay"
      icon="play"
      description="Step through the hand exactly as recorded. Keys: Space play/pause · ← → step · Home / End."
      className="acr-hd-replay"
      actions={
        <div className="acr-hd-seg" role="group" aria-label="Hole cards in the replay">
          <button type="button" className={cx('acr-hd-seg__btn', cardMode === 'all' && 'is-on')} aria-pressed={cardMode === 'all'} onClick={() => onCardMode('all')}>
            <Icon name="eye" /> All hole cards
          </button>
          <button type="button" className={cx('acr-hd-seg__btn', cardMode === 'showdown' && 'is-on')} aria-pressed={cardMode === 'showdown'} onClick={() => onCardMode('showdown')}>
            <Icon name="lock" /> As players saw it
          </button>
        </div>
      }
    >
      <div ref={rootRef} className="acr-hd-replay__grid" role="region" aria-label={`Replay of hand ${hand.handNumber}`} onKeyDown={onKeyDown}>
        <div className="acr-hd-replay__stage">
          <div className="acr-hd-table" data-kind={frame.kind}>
            <PokerTable
              maxSeats={maxSeats}
              seats={seats}
              heroSeat={null}
              board={frame.board}
              totalPot={frame.pot}
              pots={frame.pots ?? undefined}
              winningCards={winning}
              tableNumber={hand.tableNumber}
              handNumber={hand.handNumber}
              bigBlind={hand.bigBlind}
              finalTable={finalTable}
              renderSeatExtra={(seat) =>
                seat === frame.actor ? (
                  <span className={cx('acr-hd-actor', `is-${frame.kind}`)} aria-hidden="true">
                    {frame.kind !== 'award' && <span className="acr-hd-actor__tag">{frame.kind === 'uncalled' ? 'RETURNED' : 'ACTING'}</span>}
                  </span>
                ) : null
              }
            />
          </div>
          <div className="acr-hd-caption">
            <span className="acr-hd-caption__stage">{STAGE_LABEL[frame.stage]}</span>
            <p className="acr-hd-caption__text" aria-live={player.playing ? 'off' : 'polite'}>
              {frame.caption}
            </p>
          </div>
          <div className="acr-hd-controls">
            <div className="acr-hd-controls__buttons" role="group" aria-label="Playback">
              <IconButton icon="skip-forward" label="First step" className="acr-hd-flip" onClick={() => player.seek(0)} disabled={player.atStart} variant="secondary" />
              <IconButton icon="chevron-left" label="Previous step" onClick={() => player.step(-1)} disabled={player.atStart} variant="secondary" />
              <button type="button" className={cx('acr-hd-play', player.playing && 'is-playing')} onClick={player.toggle} aria-label={player.playing ? 'Pause' : player.atEnd ? 'Replay from the start' : 'Play'}>
                <Icon name={player.playing ? 'pause' : player.atEnd ? 'refresh' : 'play'} />
                <span>{player.playing ? 'Pause' : player.atEnd ? 'Replay' : 'Play'}</span>
              </button>
              <IconButton icon="chevron-right" label="Next step" onClick={() => player.step(1)} disabled={player.atEnd} variant="secondary" />
              <IconButton icon="skip-forward" label="Last step (result)" onClick={() => player.seek(last)} disabled={player.atEnd} variant="secondary" />
            </div>
            <div className="acr-hd-scrub">
              <div className="acr-hd-scrub__marks" aria-hidden="true">
                {markers.map((m) => (
                  <span key={m.stage} className={cx('acr-hd-scrub__mark', player.index >= m.index && 'is-past')} style={{ left: `${last > 0 ? (m.index / last) * 100 : 0}%` }} title={STAGE_LABEL[m.stage]}>
                    {m.labelled ? STAGE_LABEL[m.stage] : ''}
                  </span>
                ))}
              </div>
              <input
                type="range"
                className="acr-hd-scrub__range"
                min={0}
                max={last}
                step={1}
                value={player.index}
                onChange={(e) => player.seek(Number(e.target.value))}
                aria-label="Replay position"
                aria-valuetext={`Step ${player.index + 1} of ${last + 1}: ${frame.caption}`}
              />
            </div>
            <span className="acr-hd-controls__count jpb-num" aria-hidden="true">
              {player.index + 1} / {last + 1}
            </span>
            <IconButton icon="layers" label="Copy a link to this step" size="sm" onClick={() => void copy(`${window.location.origin}${stepHref}`, 'Link to this step')} />
            <SpeedPicker player={player} />
          </div>
          <nav className="acr-hd-jumps" aria-label="Jump to street">
            {JUMP_STAGES.map((s) => {
              const at = replay.stageStarts[s];
              const current = frame.stage === s;
              return (
                <button key={s} type="button" className={cx('acr-hd-jump', current && 'is-on')} disabled={at === undefined} aria-current={current ? 'step' : undefined} onClick={() => at !== undefined && player.seek(at)}>
                  {STAGE_LABEL[s]}
                  {at === undefined && <span className="jpb-sr-only"> (not reached in this hand)</span>}
                </button>
              );
            })}
          </nav>
        </div>
        <aside className="acr-hd-replay__log" aria-label="Hand timeline">
          <Timeline replay={replay} player={player} />
        </aside>
      </div>
    </Panel>
  );
}
