import type { TournamentPublicSummary } from '@jpb/shared-types';
import { BlindClock, IconButton, PlayerHeader } from '@jpb/ui';

/** No running blind clock before play starts or after it ended. */
const NO_CLOCK = new Set(['DRAFT', 'REGISTRATION', 'REGISTRATION_CLOSED', 'STARTING', 'COMPLETED', 'CANCELLED']);

export interface GameHeaderProps {
  name: string;
  tournament: TournamentPublicSummary | null;
  serverOffsetMs: number;
  /** Phone only: open the hand log / tournament sheets (desktop shows a side panel). */
  onLog?: () => void;
  onInfo?: () => void;
  onSettings: () => void;
}

/** Tournament name, quiet status, the blind clock line, and the few controls a player needs. */
export function GameHeader({ name, tournament, serverOffsetMs, onLog, onInfo, onSettings }: GameHeaderProps) {
  const level = tournament?.currentLevel;
  const showClock = tournament && level && !NO_CLOCK.has(tournament.status);
  return (
    <PlayerHeader
      tournamentName={tournament?.name ?? name}
      status={tournament?.status ?? 'RUNNING'}
      playersLeft={tournament?.counters.active}
      end={
        <>
          {onLog && <IconButton icon="list" label="Hand log" size="md" onClick={onLog} />}
          {onInfo && <IconButton icon="trophy" label="Tournament info" size="md" onClick={onInfo} />}
          <IconButton icon="sliders" label="Settings" size="md" onClick={onSettings} />
        </>
      }
      clock={
        showClock ? (
          <BlindClock
            variant="compact"
            current={level}
            next={tournament.nextLevel}
            levelEndsAt={tournament.clock.levelEndsAt}
            pausedRemainingMs={tournament.clock.pausedRemainingMs}
            breakEndsAt={tournament.status === 'BREAK' ? tournament.clock.breakEndsAt : null}
            serverOffsetMs={serverOffsetMs}
          />
        ) : undefined
      }
    />
  );
}
