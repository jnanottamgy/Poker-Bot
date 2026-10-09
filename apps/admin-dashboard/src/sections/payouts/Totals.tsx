import type { PaymentStatus, PayoutsDto } from '@jpb/shared-types';
import { Icon, ProgressBar, formatCount, formatMoneyMinor, formatPercent } from '@jpb/ui';
import type { IconName } from '@jpb/ui';
import type { StatusTally } from './model';

interface Tile {
  key: string;
  icon: IconName;
  label: string;
  value: string;
  sub: string;
  tone?: 'gold' | 'positive' | 'warning';
}

/** Configured / awarded / paid / outstanding (server totals) with the paid progress. */
export function Totals({ data, tally, paidPlaces }: { data: PayoutsDto; tally: Record<PaymentStatus, StatusTally>; paidPlaces: number }) {
  const { totals, currency } = data;
  const money = (m: number) => formatMoneyMinor(m, currency);
  const winners = data.rows.length;
  const toAward = Math.max(0, totals.configuredMinor - totals.awardedMinor);
  const tiles: Tile[] = [
    { key: 'configured', icon: 'trophy', label: 'Configured pool', value: money(totals.configuredMinor), sub: `${formatCount(paidPlaces)} paid ${paidPlaces === 1 ? 'place' : 'places'}`, tone: 'gold' },
    { key: 'awarded', icon: 'award', label: 'Awarded', value: money(totals.awardedMinor), sub: toAward > 0 ? `${formatCount(winners)} winners · ${money(toAward)} still in play` : `${formatCount(winners)} winners · all places decided` },
    { key: 'paid', icon: 'check-circle', label: 'Paid', value: money(totals.paidMinor), sub: `${formatCount(tally.PAID.count)} of ${formatCount(winners)} winners`, tone: 'positive' },
    {
      key: 'outstanding',
      icon: 'clock',
      label: 'Outstanding',
      value: money(totals.outstandingMinor),
      sub: `${formatCount(tally.UNPAID.count)} unpaid · ${formatCount(tally.PROCESSING.count)} processing`,
      tone: totals.outstandingMinor > 0 ? 'warning' : undefined,
    },
  ];
  const ratio = totals.awardedMinor > 0 ? totals.paidMinor / totals.awardedMinor : 0;
  return (
    <section className="acr-payouts-totals" aria-label="Payout totals">
      <div className="acr-payouts-totals__tiles">
        {tiles.map((t) => (
          <div key={t.key} className={`acr-payouts-tile${t.tone ? ` is-${t.tone}` : ''}`}>
            <span className="acr-payouts-tile__label">
              <Icon name={t.icon} /> {t.label}
            </span>
            <span className="acr-payouts-tile__value jpb-num">{t.value}</span>
            <span className="acr-payouts-tile__sub">{t.sub}</span>
          </div>
        ))}
      </div>
      <div className="acr-payouts-totals__bar">
        <ProgressBar
          label="Paid of awarded"
          value={totals.paidMinor}
          max={Math.max(1, totals.awardedMinor)}
          valueText={totals.awardedMinor > 0 ? `${formatPercent(ratio)} · ${money(totals.paidMinor)} of ${money(totals.awardedMinor)}` : 'Nothing awarded yet'}
          tone={ratio >= 1 ? 'positive' : 'gold'}
        />
      </div>
    </section>
  );
}
