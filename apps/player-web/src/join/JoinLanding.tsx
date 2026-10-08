import type { JoinInfoDto } from '@jpb/shared-types';
import { Alert, Button, Icon, TournamentStatusPill, formatChips, formatCount, formatMoneyMinor, formatOrdinal } from '@jpb/ui';
import { InfoTiles } from '../components/InfoTiles';
import { formatStartTime, prizePool } from './joinFormat';

export interface JoinLandingProps {
  info: JoinInfoDto;
  onJoin: () => void;
  onRejoin: () => void;
}

/** "JOHNNY'S POKER BOT · TOURNAMENT · [JOIN TOURNAMENT]". */
export function JoinLanding({ info, onJoin, onRejoin }: JoinLandingProps) {
  const open = info.registration.open;
  const registered = info.counters?.registered ?? null;
  const places = [...info.prizes.places].sort((a, b) => a.position - b.position);
  const pool = prizePool(places);
  return (
    <section className="pw-hero" aria-labelledby="t-name">
      <p className="pw-eyebrow pw-hero__eyebrow">Johnny&apos;s Poker Bot · Tournament</p>
      <h1 id="t-name" className="pw-hero__title">
        {info.name}
      </h1>
      <div className="pw-hero__status">
        <TournamentStatusPill status={info.status} />
        {info.registration.requiresApproval && <span className="pw-hero__note">Entries approved by staff</span>}
      </div>
      <InfoTiles
        className="pw-hero__tiles"
        tiles={[
          { label: 'Starts', value: formatStartTime(info.startTime) },
          {
            label: 'Players',
            value: registered === null ? '—' : `${formatCount(registered)} / ${formatCount(info.limits.maxPlayers)}`,
            title: registered === null ? undefined : `${formatCount(registered)} registered of ${formatCount(info.limits.maxPlayers)}`,
          },
          { label: 'Starting stack', value: formatChips(info.startingStack) },
          { label: 'Prize pool', value: pool > 0 ? formatMoneyMinor(pool, info.prizes.currency) : 'Prizes TBA', emphasis: pool > 0 },
        ]}
      />
      {places.length > 0 && (
        <div className="pw-prizes" aria-label="Top prizes">
          {places.slice(0, 3).map((p) => (
            <div key={p.position} className={`pw-prizes__item is-p${p.position}`}>
              <span className="pw-prizes__pos">{formatOrdinal(p.position)}</span>
              <span className="pw-prizes__amt jpb-num">{formatMoneyMinor(p.amountMinor, info.prizes.currency)}</span>
            </div>
          ))}
          <p className="pw-prizes__more">
            {formatCount(places.length)} places paid{info.prizes.notes ? ` · ${info.prizes.notes}` : ''}
          </p>
        </div>
      )}
      {open ? (
        <div className="pw-hero__cta">
          <Button variant="primary" size="xl" block onClick={onJoin} iconRight="arrow-right">
            JOIN TOURNAMENT
          </Button>
          <Button variant="ghost" size="lg" block onClick={onRejoin}>
            Already registered? Rejoin
          </Button>
        </div>
      ) : (
        <div className="pw-hero__cta">
          <Alert severity="WARNING" title="Registration is closed">
            New entries are no longer accepted. Already registered? Rejoin with your player ID and code.
          </Alert>
          <Button variant="primary" size="xl" block onClick={onRejoin}>
            Rejoin tournament
          </Button>
        </div>
      )}
      <p className="pw-hero__fair">
        <Icon name="shield" />
        <span>
          Every deck is committed before play. Commitment <span className="jpb-mono">{info.serverSeedHash.slice(0, 16)}…</span>
        </span>
      </p>
    </section>
  );
}
