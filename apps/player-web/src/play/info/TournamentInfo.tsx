import type { JoinInfoDto, PlayerSelfSummary, TournamentPublicSummary } from '@jpb/shared-types';
import { BlindClock, TournamentStatus } from '@jpb/ui';
import { FairnessSection } from './FairnessSection';
import { LeaderboardSection } from './LeaderboardSection';
import { MyHistory } from './MyHistory';
import { PrizeLadder } from './PrizeLadder';

export interface TournamentInfoProps {
  joinCode: string;
  tournament: TournamentPublicSummary | null;
  self: PlayerSelfSummary | null;
  joinInfo: JoinInfoDto | null;
  serverOffsetMs: number;
  /** Bump to refetch REST data (e.g. when the panel is opened). */
  refreshKey: number;
}

/** Tournament tab: status, blinds, leaderboard, prizes, your history, fairness. */
export function TournamentInfo({ joinCode, tournament, self, joinInfo, serverOffsetMs, refreshKey }: TournamentInfoProps) {
  const currency = joinInfo?.prizes.currency ?? 'INR';
  const c = tournament?.counters;
  const level = tournament?.currentLevel;
  const finished = tournament?.status === 'COMPLETED' || tournament?.status === 'CANCELLED';
  return (
    <div className="pw-info">
      {tournament && c && (
        <section className="pw-info__section" aria-label="Status">
          <TournamentStatus
            status={tournament.status}
            playersRemaining={c.active}
            playersTotal={c.registered}
            tables={c.tables}
            level={level?.level ?? 1}
            averageStack={c.active > 0 ? Math.floor(c.totalChips / c.active) : undefined}
            handForHand={tournament.handForHand}
            layout="stacked"
          />
        </section>
      )}
      {tournament && level && !finished && (
        <section className="pw-info__section" aria-labelledby="blinds-title">
          <h2 id="blinds-title" className="pw-info__h">
            Blinds
          </h2>
          <BlindClock
            variant="full"
            current={level}
            next={tournament.nextLevel}
            levelEndsAt={tournament.clock.levelEndsAt}
            pausedRemainingMs={tournament.clock.pausedRemainingMs}
            breakEndsAt={tournament.status === 'BREAK' ? tournament.clock.breakEndsAt : null}
            serverOffsetMs={serverOffsetMs}
          />
        </section>
      )}
      <LeaderboardSection joinCode={joinCode} playerId={self?.playerId ?? null} currency={currency} refreshKey={refreshKey} initialMode={finished ? 'finish' : 'stack'} />
      <section className="pw-info__section" aria-labelledby="prize-title">
        <h2 id="prize-title" className="pw-info__h">
          Prizes
        </h2>
        <PrizeLadder places={joinInfo?.prizes.places ?? []} currency={currency} notes={joinInfo?.prizes.notes ?? null} yourPosition={self?.finishPosition ?? null} />
      </section>
      <section className="pw-info__section" aria-labelledby="me-title">
        <h2 id="me-title" className="pw-info__h">
          My tournament
        </h2>
        <MyHistory refreshKey={refreshKey} />
      </section>
      <section className="pw-info__section" aria-labelledby="fair-title">
        <h2 id="fair-title" className="pw-info__h">
          Fairness
        </h2>
        <FairnessSection joinCode={joinCode} refreshKey={refreshKey} />
      </section>
    </div>
  );
}
