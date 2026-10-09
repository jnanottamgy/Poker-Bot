import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { TournamentReportDto } from '@jpb/shared-types';
import { Button, Icon, ProgressBar, TournamentStatusPill, formatCount, formatMoneyMinor, formatOrdinal, formatPercent } from '@jpb/ui';
import { sectionHref } from '../../app/sections';
import { formatDateTime } from '../../lib/time';
import { bandPositions, ladderBands } from '../standings/model';
import { MAX_PRINTED_BANDS, SCREEN_ROWS, isFinal, keyFigures, paidRatio, payoutFigures } from './model';
import type { Figure } from './model';

function Figures({ items, className }: { items: Figure[]; className?: string }) {
  return (
    <dl className={`acr-reports-figs ${className ?? ''}`}>
      {items.map((f) => (
        <div key={f.key} className="acr-reports-fig">
          <dt>{f.label}</dt>
          <dd className={f.mono ? 'jpb-mono' : 'jpb-num'}>{f.value}</dd>
          {f.sub && <dd className="acr-reports-fig__sub">{f.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

/**
 * The tournament report as a document: readable on screen in the dark theme
 * and printed black on white (reports.css @media print) — "Print / save as
 * PDF" is the browser's own print dialog.
 */
export function ReportDocument({ report: r, tournamentId }: { report: TournamentReportDto; tournamentId: string }) {
  const currency = r.prizeStructure.currency;
  const bands = useMemo(() => ladderBands(r.prizeStructure.places), [r.prizeStructure.places]);
  const shownBands = bands.slice(0, MAX_PRINTED_BANDS);
  const pool = r.prizeStructure.places.reduce((a, p) => a + p.amountMinor, 0);
  const moreStandings = r.players > r.standings.length && r.standings.length > 0;
  const final = isFinal(r.status);
  // Long tables are folded on screen only; print always shows every row.
  const [allStandings, setAllStandings] = useState(false);
  const [allBands, setAllBands] = useState(false);
  const fold = (i: number, open: boolean) => (!open && i >= SCREEN_ROWS ? 'acr-reports-more' : undefined);

  return (
    <article className="acr-reports-doc" aria-labelledby="acr-reports-title">
      <header className="acr-reports-doc__head">
        <div>
          <p className="acr-reports-doc__eyebrow">Johnny’s Poker Bot · Tournament report</p>
          <h1 id="acr-reports-title" className="acr-reports-doc__title">
            {r.name}
          </h1>
          <p className="acr-reports-doc__meta">
            <span className="jpb-mono">{r.tournamentId}</span> · generated {formatDateTime(r.generatedAt)}
          </p>
        </div>
        <TournamentStatusPill status={r.status} />
      </header>

      {!final && (
        <p className="acr-reports-provisional" role="note">
          <Icon name="warning" /> Provisional: the tournament is still {r.status === 'DRAFT' ? 'a draft' : 'in progress'}. Figures are as of {formatDateTime(r.generatedAt)} and will change.
        </p>
      )}

      {r.winner && (
        <section className="acr-reports-champion" aria-label="Champion">
          <Icon name="crown" />
          <div>
            <p className="acr-reports-champion__label">Champion</p>
            <p className="acr-reports-champion__name">
              {r.winner.displayName} <span className="jpb-mono">{r.winner.publicId}</span>
            </p>
          </div>
          {r.standings[0]?.finishPosition === 1 && r.standings[0].prizeMinor > 0 && <span className="acr-reports-champion__prize jpb-num">{formatMoneyMinor(r.standings[0].prizeMinor, currency)}</span>}
        </section>
      )}

      <section className="acr-reports-sec" aria-labelledby="acr-reports-key">
        <h2 id="acr-reports-key" className="acr-reports-sec__title">
          Key figures
        </h2>
        <Figures items={keyFigures(r)} />
        {r.largestPot && (
          <p className="acr-reports-note acr-reports-noprint">
            <Link className="acr-link" to={sectionHref('hand-detail', tournamentId, { handId: r.largestPot.handId })}>
              Open the largest pot’s hand <Icon name="arrow-right" />
            </Link>
          </p>
        )}
      </section>

      <section className="acr-reports-sec" aria-labelledby="acr-reports-payouts">
        <h2 id="acr-reports-payouts" className="acr-reports-sec__title">
          Payout status
        </h2>
        <Figures items={payoutFigures(r)} className="acr-reports-figs--4" />
        <ProgressBar
          label="Paid of awarded"
          value={r.payouts.paidMinor}
          max={Math.max(1, r.payouts.awardedMinor)}
          valueText={r.payouts.awardedMinor > 0 ? formatPercent(paidRatio(r.payouts)) : 'Nothing awarded yet'}
          tone="gold"
          className="acr-reports-progress"
        />
      </section>

      <section className="acr-reports-sec" aria-labelledby="acr-reports-standings">
        <h2 id="acr-reports-standings" className="acr-reports-sec__title">
          Final standings
          <span className="acr-reports-sec__count">
            {formatCount(r.standings.length)} {r.standings.length === 1 ? 'place' : 'places'}
          </span>
        </h2>
        {r.standings.length === 0 ? (
          <p className="acr-reports-note">No finishing position has been decided yet.</p>
        ) : (
          <table className="acr-reports-table">
            <thead>
              <tr>
                <th scope="col">Place</th>
                <th scope="col">Player</th>
                <th scope="col">Public ID</th>
                <th scope="col">Tie</th>
                <th scope="col" className="is-num">
                  Prize
                </th>
              </tr>
            </thead>
            <tbody>
              {r.standings.map((s, i) => (
                <tr key={`${s.playerId}-${s.finishPosition}`} className={[s.finishPosition !== null && s.finishPosition <= 3 ? `is-p${s.finishPosition}` : '', fold(i, allStandings) ?? ''].join(' ').trim() || undefined}>
                  <td className="jpb-num">{s.finishPosition === null ? '—' : formatOrdinal(s.finishPosition)}</td>
                  <td>{s.displayName}</td>
                  <td className="jpb-mono">{s.publicId}</td>
                  <td>{s.tiedCount > 1 ? `tied ×${s.tiedCount}` : '—'}</td>
                  <td className="is-num jpb-num">{s.prizeMinor > 0 ? formatMoneyMinor(s.prizeMinor, currency) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {r.standings.length > SCREEN_ROWS && (
          <Button size="sm" variant="ghost" icon={allStandings ? 'chevron-up' : 'chevron-down'} className="acr-reports-showall acr-reports-noprint" aria-expanded={allStandings} onClick={() => setAllStandings((v) => !v)}>
            {allStandings ? 'Show fewer' : `Show all ${formatCount(r.standings.length)} places`}
          </Button>
        )}
        {moreStandings && <p className="acr-reports-note">The report lists the first {formatCount(r.standings.length)} finishing positions; the CSV export contains every player.</p>}
      </section>

      <section className="acr-reports-sec" aria-labelledby="acr-reports-prizes">
        <h2 id="acr-reports-prizes" className="acr-reports-sec__title">
          Prize structure
          <span className="acr-reports-sec__count">
            {formatCount(r.prizeStructure.places.length)} paid places · {currency}
          </span>
        </h2>
        {bands.length === 0 ? (
          <p className="acr-reports-note">No prizes were configured.</p>
        ) : (
          <table className="acr-reports-table acr-reports-table--prizes">
            <thead>
              <tr>
                <th scope="col">Place</th>
                <th scope="col">Label</th>
                <th scope="col" className="is-num">
                  Prize each
                </th>
                <th scope="col" className="is-num">
                  Band total
                </th>
              </tr>
            </thead>
            <tbody>
              {shownBands.map((b, i) => (
                <tr key={b.from} className={fold(i, allBands)}>
                  <td className="jpb-num">{bandPositions(b)}</td>
                  <td>{b.label ?? (b.to > b.from ? `${formatCount(b.to - b.from + 1)} places` : '')}</td>
                  <td className="is-num jpb-num">{formatMoneyMinor(b.amountMinor, currency)}</td>
                  <td className="is-num jpb-num">{formatMoneyMinor(b.totalMinor, currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Total prize pool
                </th>
                <td className="is-num jpb-num">{formatMoneyMinor(pool, currency)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        {shownBands.length > SCREEN_ROWS && (
          <Button size="sm" variant="ghost" icon={allBands ? 'chevron-up' : 'chevron-down'} className="acr-reports-showall acr-reports-noprint" aria-expanded={allBands} onClick={() => setAllBands((v) => !v)}>
            {allBands ? 'Show fewer' : `Show all ${formatCount(shownBands.length)} prize bands`}
          </Button>
        )}
        {bands.length > shownBands.length && <p className="acr-reports-note">{formatCount(bands.length - shownBands.length)} more prize bands are in the JSON export.</p>}
      </section>

      <section className="acr-reports-sec" aria-labelledby="acr-reports-fair">
        <h2 id="acr-reports-fair" className="acr-reports-sec__title">
          Fairness
        </h2>
        <dl className="acr-reports-figs acr-reports-figs--fair">
          <div className="acr-reports-fig acr-reports-fig--wide">
            <dt>Server seed commitment (SHA-256)</dt>
            <dd className="jpb-mono acr-reports-hash">{r.serverSeedHash}</dd>
          </div>
          <div className="acr-reports-fig">
            <dt>Server seed</dt>
            <dd>{r.seedRevealed ? 'Revealed — every hand can be verified' : 'Not revealed yet'}</dd>
          </div>
        </dl>
        <p className="acr-reports-note acr-reports-noprint">
          <Link className="acr-link" to={sectionHref('fairness', tournamentId)}>
            Verify hands in Fairness <Icon name="arrow-right" />
          </Link>
        </p>
      </section>

      <footer className="acr-reports-doc__foot">
        Generated {formatDateTime(r.generatedAt)} from the server’s records. Chips are integers; money is shown in {currency}. Card dealing uses HMAC-SHA256 + Fisher–Yates with a published commitment; no AI is involved in any game decision.
      </footer>
    </article>
  );
}
