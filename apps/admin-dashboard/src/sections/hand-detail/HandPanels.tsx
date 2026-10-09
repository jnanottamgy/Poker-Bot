import { Fragment } from 'react';
import { Link } from 'react-router';
import type { HandDetailDto } from '@jpb/shared-types';
import { Badge, Board, DescriptionList, HoleCards, Icon, Panel, PlayingCard, Spinner, cx, formatChips, formatChipsDelta } from '@jpb/ui';
import { friendlyError } from '../../api/errors';
import { sectionHref } from '../../app/sections';
import { ButtonLink } from '../../components/ButtonLink';
import { formatDateTime, formatDuration, formatTimeOfDay } from '../../lib/time';
import { HashValue, CheckStrip, VerdictPill } from '../fairness/ui';
import type { HandVerification } from '../fairness/useFairness';
import { bbText, blindsText, handDurationMs } from '../hands/model';
import { STAGE_LABEL, STREETS, actionPhrase, actionShort, isPost } from './replay';
import type { StackDifference } from './replay';

type Seat = HandDetailDto['seats'][number];

const seatName = (hand: HandDetailDto, seat: number | null): string => {
  if (seat === null) return '—';
  const s = hand.seats.find((x) => x.seat === seat);
  return s ? `${s.displayName} · seat ${seat + 1}` : `Seat ${seat + 1}`;
};

function wonBySeat(hand: HandDetailDto): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of hand.pots) for (const w of p.winners) m.set(w.seat, (m.get(w.seat) ?? 0) + w.amount);
  return m;
}

/* ------------------------------------------------------------ summary */

export function HandSummary({ hand }: { hand: HandDetailDto }) {
  const duration = handDurationMs(hand);
  const winners = [...wonBySeat(hand).entries()].map(([seat, amount]) => ({ seat, amount, name: hand.seats.find((s) => s.seat === seat)?.displayName ?? `Seat ${seat + 1}` }));
  const items = [
    { label: 'Level', value: `L${hand.level}`, sub: blindsText(hand.smallBlind, hand.bigBlind, hand.ante) },
    { label: 'Total pot', value: formatChips(hand.totalPot), sub: bbText(hand.totalPot, hand.bigBlind) },
    { label: 'Players', value: String(hand.players), sub: `${hand.seats.filter((s) => s.shown).length} shown at showdown` },
    { label: 'Dealer', value: hand.buttonSeat === null ? 'Dead button' : `Seat ${hand.buttonSeat + 1}`, sub: `SB ${hand.smallBlindSeat === null ? '—' : `seat ${hand.smallBlindSeat + 1}`} · BB seat ${hand.bigBlindSeat + 1}` },
    { label: 'Started', value: formatTimeOfDay(hand.startedAt), sub: formatDateTime(hand.startedAt) },
    { label: 'Duration', value: duration === null ? 'In progress' : formatDuration(duration), sub: hand.completedAt ? `ended ${formatTimeOfDay(hand.completedAt)}` : '' },
  ];
  return (
    <section className="acr-hd-summary" aria-label="Hand summary">
      <dl className="acr-hd-summary__facts">
        {items.map((it) => (
          <div key={it.label} className="acr-hd-summary__fact">
            <dt>{it.label}</dt>
            <dd>
              <span className="acr-hd-summary__value jpb-num">{it.value}</span>
              {it.sub && <span className="acr-hd-summary__sub">{it.sub}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <div className="acr-hd-summary__result">
        <div className="acr-hd-summary__badges">
          {hand.showdown ? (
            <Badge tone="info">
              <Icon name="eye" /> SHOWDOWN
            </Badge>
          ) : (
            <Badge>NO SHOWDOWN</Badge>
          )}
          {hand.allIn && (
            <Badge tone="warning">
              <Icon name="flame" /> ALL-IN
            </Badge>
          )}
        </div>
        <ul className="acr-hd-summary__winners" aria-label="Winners">
          {winners.map((w) => (
            <li key={w.seat}>
              <Icon name="trophy" /> <strong>{w.name}</strong> <span className="jpb-num">+{formatChips(w.amount)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ seats */

export function SeatsPanel({ hand, tournamentId, onSeatJump }: { hand: HandDetailDto; tournamentId: string; onSeatJump?: (seat: number) => void }) {
  const won = wonBySeat(hand);
  const returned = new Map(hand.uncalledReturns.map((u) => [u.seat, u.amount]));
  const seats = [...hand.seats].sort((a, b) => a.seat - b.seat);
  const position = (s: Seat) => (
    <span className="acr-hd-pos">
      {hand.buttonSeat === s.seat && (
        <Badge variant="solid" srLabel="Dealer button">
          D
        </Badge>
      )}
      {hand.smallBlindSeat === s.seat && (
        <Badge tone="info" srLabel="Small blind">
          SB
        </Badge>
      )}
      {hand.bigBlindSeat === s.seat && (
        <Badge tone="info" srLabel="Big blind">
          BB
        </Badge>
      )}
    </span>
  );
  return (
    <Panel title="Players" icon="users" description="Starting stacks, hole cards and results. Stacks in chips and big blinds." flush className="acr-hd-seats">
      <div className="acr-hd-tablewrap">
        <table className="acr-hd-table-data">
          <caption className="jpb-sr-only">Players of hand {hand.handNumber}</caption>
          <thead>
            <tr>
              <th scope="col">Seat</th>
              <th scope="col">Player</th>
              <th scope="col" className="is-num">Starting stack</th>
              <th scope="col">Hole cards</th>
              <th scope="col">Final hand</th>
              <th scope="col" className="is-num">Final stack</th>
              <th scope="col" className="is-num">Result</th>
            </tr>
          </thead>
          <tbody>
            {seats.map((s) => {
              const net = s.finalStack - s.startingStack;
              const w = won.get(s.seat) ?? 0;
              return (
                <tr key={s.seat} className={cx(w > 0 && 'is-winner')}>
                  <td className="jpb-num">
                    {onSeatJump ? (
                      <button type="button" className="acr-hd-seatno" onClick={() => onSeatJump(s.seat)} aria-label={`Seat ${s.seat + 1}: jump the replay to ${s.displayName}'s first action`}>
                        {s.seat + 1}
                      </button>
                    ) : (
                      s.seat + 1
                    )}
                  </td>
                  <th scope="row">
                    <span className="acr-hd-player">
                      <span className="acr-hd-player__line">
                        <Link className="acr-link" to={sectionHref('player-detail', tournamentId, { playerId: s.playerId })}>
                          {s.displayName}
                        </Link>
                        {position(s)}
                      </span>
                      <span className="acr-hd-sub jpb-mono">{s.publicId}</span>
                    </span>
                  </th>
                  <td className="is-num">
                    <span className="jpb-num">{formatChips(s.startingStack)}</span>
                    <span className="acr-hd-sub jpb-num">{bbText(s.startingStack, hand.bigBlind)}</span>
                  </td>
                  <td>
                    {s.holeCards ? (
                      <span className="acr-hd-cards">
                        <HoleCards cards={s.holeCards} size="xs" labelPrefix={`${s.displayName}'s hole cards`} />
                        {s.shown ? (
                          <Badge tone="info" srLabel="Shown at showdown">
                            SHOWN
                          </Badge>
                        ) : (
                          <Badge srLabel="Never shown to the table">HIDDEN</Badge>
                        )}
                      </span>
                    ) : (
                      <span className="acr-hd-dim" title="Hole cards are not part of this record">Not recorded</span>
                    )}
                  </td>
                  <td>
                    {s.finalHand ? (
                      <span className="acr-hd-finalhand">
                        <span>{s.finalHand.description}</span>
                        <span className="acr-hd-fivecards" role="group" aria-label={`Best five: ${s.finalHand.bestFive.join(' ')}`}>
                          {s.finalHand.bestFive.map((c) => (
                            <PlayingCard key={c} card={c} size="xs" />
                          ))}
                        </span>
                      </span>
                    ) : (
                      <span className="acr-hd-dim">—</span>
                    )}
                  </td>
                  <td className="is-num">
                    <span className="jpb-num">{formatChips(s.finalStack)}</span>
                    <span className="acr-hd-sub jpb-num">{s.finalStack === 0 ? 'busted' : bbText(s.finalStack, hand.bigBlind)}</span>
                  </td>
                  <td className="is-num">
                    <span className={cx('jpb-num', net > 0 && 'acr-hd-up', net < 0 && 'acr-hd-down')}>
                      <span className="jpb-sr-only">{net > 0 ? 'gained ' : net < 0 ? 'lost ' : 'no change '}</span>
                      {formatChipsDelta(net)}
                    </span>
                    {w > 0 && (
                      <span className="acr-hd-sub acr-hd-won">
                        <Icon name="trophy" /> won <span className="jpb-num">{formatChips(w)}</span>
                      </span>
                    )}
                    {returned.has(s.seat) && <span className="acr-hd-sub jpb-num">{formatChips(returned.get(s.seat)!)} returned</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------ actions */

export function ActionsPanel({ hand, currentSeq, onJump }: { hand: HandDetailDto; currentSeq: number | null; onJump: (seq: number) => void }) {
  const actions = [...hand.actions].sort((a, b) => a.seq - b.seq);
  return (
    <Panel title="Action history" icon="list" description="Every forced bet and decision in order, with the stack and pot after it. Select a row to show it in the replay." flush className="acr-hd-actions">
      <div className="acr-hd-tablewrap">
        <table className="acr-hd-table-data acr-hd-actiontable">
          <caption className="jpb-sr-only">Actions of hand {hand.handNumber}</caption>
          <thead>
            <tr>
              <th scope="col" className="is-num">#</th>
              <th scope="col">Player</th>
              <th scope="col">Action</th>
              <th scope="col" className="is-num">Chips in</th>
              <th scope="col" className="is-num">Street total</th>
              <th scope="col" className="is-num">Stack after</th>
              <th scope="col" className="is-num">Pot after</th>
            </tr>
          </thead>
          {STREETS.map((street) => {
            const rows = actions.filter((a) => a.street === street);
            if (rows.length === 0) return null;
            return (
              <tbody key={street}>
                <tr className="acr-hd-streetrow">
                  <th scope="colgroup" colSpan={7}>
                    {STAGE_LABEL[street]}
                    <span className="acr-hd-sub"> · {rows.length} action{rows.length === 1 ? '' : 's'}</span>
                  </th>
                </tr>
                {rows.map((a) => (
                  <tr key={a.seq} className={cx(currentSeq === a.seq && 'is-current', isPost(a.action) && 'is-post', a.action === 'FOLD' && 'is-fold')} aria-current={currentSeq === a.seq ? 'step' : undefined}>
                    <td className="is-num jpb-num">
                      <button type="button" className="acr-hd-seq" onClick={() => onJump(a.seq)} aria-label={`Show action ${a.seq} in the replay: ${a.displayName} ${actionPhrase(a)}`}>
                        {a.seq}
                      </button>
                    </td>
                    <td>
                      <span className="acr-hd-player">
                        <span>{a.displayName}</span>
                        <span className="acr-hd-sub">seat {a.seat + 1}</span>
                      </span>
                    </td>
                    <td>
                      <span className={cx('acr-hd-act', `acr-hd-act--${a.action.toLowerCase()}`)}>{actionShort(a)}</span>
                      {a.allIn && a.action !== 'ALL_IN' && <Badge tone="warning">ALL-IN</Badge>}
                      {a.timeout && (
                        <Badge tone="danger" srLabel="Timed out: the server acted on the player's behalf">
                          <Icon name="clock" /> TIMEOUT
                        </Badge>
                      )}
                    </td>
                    <td className="is-num jpb-num">{a.amount > 0 ? formatChips(a.amount) : '—'}</td>
                    <td className="is-num jpb-num">{a.toAmount > 0 ? formatChips(a.toAmount) : '—'}</td>
                    <td className="is-num jpb-num">{a.stackAfter === 0 ? <Badge tone="warning">0 · ALL-IN</Badge> : formatChips(a.stackAfter)}</td>
                    <td className="is-num jpb-num">{formatChips(a.potAfter)}</td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------ board, pots */

export function BoardPanel({ hand }: { hand: HandDetailDto }) {
  const { flop, turn, river } = hand.boardByStreet;
  const streets = [
    { name: 'Flop', cards: flop },
    { name: 'Turn', cards: turn ? [turn] : [] },
    { name: 'River', cards: river ? [river] : [] },
  ];
  return (
    <Panel title="Board by street" icon="layers" className="acr-hd-board">
      {hand.board.length === 0 ? (
        <p className="acr-hd-dim">No community cards: the hand ended before the flop.</p>
      ) : (
        <>
          <div className="acr-hd-board__full">
            <Board cards={hand.board} size="sm" animate={false} />
          </div>
          <dl className="acr-hd-board__streets">
            {streets.map((s) => (
              <div key={s.name} className="acr-hd-board__street">
                <dt>{s.name}</dt>
                <dd>
                  {s.cards.length > 0 ? (
                    <span className="acr-hd-board__cards" role="group" aria-label={`${s.name}: ${s.cards.join(' ')}`}>
                      {s.cards.map((c) => (
                        <PlayingCard key={c} card={c} size="xs" />
                      ))}
                    </span>
                  ) : (
                    <span className="acr-hd-dim">Not dealt</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Panel>
  );
}

export function PotsPanel({ hand, differences }: { hand: HandDetailDto; differences: StackDifference[] }) {
  const pots = [...hand.pots].sort((a, b) => a.potIndex - b.potIndex);
  const sides = pots.filter((p) => p.type === 'SIDE').length;
  const contributed = hand.actions.reduce((s, a) => s + a.amount, 0);
  const returned = hand.uncalledReturns.reduce((s, u) => s + u.amount, 0);
  const awarded = pots.reduce((s, p) => s + p.amount, 0);
  return (
    <Panel title="Pots & winners" icon="trophy" className="acr-hd-pots">
      <ul className="acr-hd-potlist">
        {pots.map((p, i) => (
          <li key={p.potIndex} className="acr-hd-pot">
            <div className="acr-hd-pot__head">
              <span className="acr-hd-pot__name">{p.type === 'MAIN' ? (sides > 0 ? 'Main pot' : 'Pot') : `Side pot ${i}`}</span>
              <span className="acr-hd-pot__amount jpb-num">{formatChips(p.amount)}</span>
            </div>
            <p className="acr-hd-pot__eligible">
              <span className="acr-hd-sub">Eligible: </span>
              {p.eligibleSeats.map((s) => seatName(hand, s)).join(', ') || '—'}
            </p>
            <ul className="acr-hd-pot__winners">
              {p.winners.map((w) => (
                <li key={w.seat}>
                  <Icon name="trophy" /> <strong>{seatName(hand, w.seat)}</strong> <span className="jpb-num">+{formatChips(w.amount)}</span>
                  {w.oddChips > 0 && (
                    <Badge tone="gold" srLabel={`includes ${w.oddChips} odd chip${w.oddChips === 1 ? '' : 's'}`}>
                      +{w.oddChips} odd chip{w.oddChips === 1 ? '' : 's'}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
            {p.winningHand ? <p className="acr-hd-pot__hand">Winning hand: {p.winningHand.description}</p> : <p className="acr-hd-pot__hand acr-hd-dim">Won uncontested (no showdown for this pot)</p>}
          </li>
        ))}
      </ul>
      {hand.uncalledReturns.length > 0 && (
        <div className="acr-hd-uncalled">
          <h4>Uncalled bets returned</h4>
          <ul>
            {hand.uncalledReturns.map((u) => (
              <li key={u.seat}>
                {seatName(hand, u.seat)}: <span className="jpb-num">{formatChips(u.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <DescriptionList
        columns={1}
        className="acr-hd-recon"
        items={[
          { label: 'Chips put in (posts + bets)', value: formatChips(contributed), mono: true },
          { label: 'Uncalled returned', value: returned > 0 ? `− ${formatChips(returned)}` : '0', mono: true },
          { label: 'Awarded in pots', value: formatChips(awarded), mono: true },
        ]}
      />
      {contributed - returned !== awarded && (
        <p className="acr-hd-warn" role="note">
          <Icon name="warning" /> Chips put in minus returns ({formatChips(contributed - returned)}) differ from the pots awarded ({formatChips(awarded)}). Check this hand in the audit log.
        </p>
      )}
      {differences.length > 0 && (
        <div className="acr-hd-warn" role="note">
          <Icon name="warning" />
          <span>
            Replaying the recorded chip movements gives a different final stack for{' '}
            {differences.map((d, i) => (
              <Fragment key={d.seat}>
                {i > 0 ? ', ' : ''}
                {d.name} ({formatChips(d.replayed)} replayed vs {formatChips(d.recorded)} recorded)
              </Fragment>
            ))}
            . The replay shows the recorded final stacks.
          </span>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------ randomness */

export function RandomnessPanel({ hand, verifyHref, verification, canVerify }: { hand: HandDetailDto; verifyHref: string; verification: HandVerification | null; canVerify: boolean }) {
  const r = hand.randomness;
  const v = verification?.verification ?? null;
  return (
    <Panel
      title="Randomness"
      icon="shield"
      description="What this hand's deck is bound to. The deck is a pure function of the server seed, the public entropy and the label."
      className="acr-hd-random"
      actions={
        canVerify ? (
          <ButtonLink to={verifyHref} icon="shield" variant="primary">
            Verify this hand
          </ButtonLink>
        ) : undefined
      }
    >
      <DescriptionList
        columns={1}
        items={[
          { label: 'Method', value: r.method === 'HMAC-SHA256-STREAM+FISHER-YATES' ? 'HMAC-SHA256 stream + Fisher–Yates shuffle' : r.method },
          { label: 'Server seed hash (commitment)', value: <HashValue value={r.serverSeedHash} what="Server seed hash" /> },
          { label: 'Public entropy', value: <HashValue value={r.publicEntropy} what="Public entropy" /> },
          { label: 'Deck hash', value: <HashValue value={r.deckHash} what="Deck hash" /> },
          { label: 'Deck label', value: <HashValue value={r.label} what="Deck label" /> },
        ]}
      />
      {canVerify && (
        <div className="acr-hd-verify" aria-live="polite">
          <div className="acr-hd-verify__head">
            <span className="acr-hd-verify__title">In-browser check</span>
            {v ? <VerdictPill status={v.result.status} /> : null}
          </div>
          {verification === null || (!v && (verification.record.isLoading || verification.fairness.isLoading)) ? (
            <p className="acr-hd-dim">
              <Spinner size="sm" /> Loading the fairness record…
            </p>
          ) : !v ? (
            <p className="acr-hd-dim">{friendlyError(verification.record.error ?? verification.fairness.error).description}</p>
          ) : (
            <>
              <CheckStrip checks={v.result.checks} />
              <p className="acr-hd-sub">
                {verification.seedSource === 'none'
                  ? 'The server seed is still secret (it is revealed after the tournament ends), so the cards cannot be checked yet.'
                  : `Recomputed here from the revealed seed in ${v.ms < 1 ? '<1' : Math.round(v.ms)} ms with the portable fairness engine — the server's own answer is not used.`}
              </p>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
