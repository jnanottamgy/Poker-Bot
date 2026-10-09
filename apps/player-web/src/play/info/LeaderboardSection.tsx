import { useState } from 'react';
import { Button, ErrorState, Leaderboard, Skeleton, Tabs } from '@jpb/ui';
import type { LeaderboardRow } from '@jpb/ui';
import type { LeaderboardMode } from '../../api/client';
import { useBackend } from '../../app/backend';
import { useAsync } from '../../hooks/useAsync';

const PAGE = 25;

/** Leaderboard with an explicit label: "Current stack ranking" vs "Finishing positions". */
export interface LeaderboardSectionProps {
  joinCode: string;
  playerId: string | null;
  currency: string;
  refreshKey: number;
  /** Finishing positions are the interesting view once the tournament is over. */
  initialMode?: LeaderboardMode;
}

export function LeaderboardSection({ joinCode, playerId, currency, refreshKey, initialMode = 'stack' }: LeaderboardSectionProps) {
  const { api } = useBackend();
  const [mode, setMode] = useState<LeaderboardMode>(initialMode);
  const [limit, setLimit] = useState(PAGE);
  const board = useAsync((signal) => api.leaderboard(joinCode, { mode, offset: 0, limit }, signal), [joinCode, mode, limit, refreshKey]);
  const rows: LeaderboardRow[] = (board.data?.rows ?? []).map((r) => ({
    id: r.playerId,
    rank: mode === 'finish' ? (r.finishPosition ?? r.rank) : r.rank,
    name: r.displayName,
    publicId: r.publicId,
    stack: r.stack,
    prizeMinor: r.prizeMinor,
    tableNumber: r.tableNumber,
    isYou: r.playerId === playerId,
    tied: r.tiedCount > 1,
  }));

  return (
    <section className="pw-info__section" aria-labelledby="lb-title">
      <h2 id="lb-title" className="pw-info__h">
        Leaderboard
      </h2>
      <Tabs
        variant="segmented"
        label="Leaderboard view"
        value={mode}
        onChange={(id) => {
          setMode(id as LeaderboardMode);
          setLimit(PAGE);
        }}
        tabs={[
          { id: 'stack', label: 'Current stacks' },
          { id: 'finish', label: 'Finishing positions' },
        ]}
      />
      {board.error && !board.data ? (
        <ErrorState title={board.error.title} description={board.error.message} onRetry={board.reload} />
      ) : !board.data ? (
        <Skeleton lines={6} />
      ) : (
        <>
          <Leaderboard mode={mode} rows={rows} currency={currency} totalPlayers={board.data.total} />
          {rows.length === 0 && <p className="pw-muted">{mode === 'finish' ? 'No one has finished yet.' : 'No players yet.'}</p>}
          {board.data.total > rows.length && (
            <Button variant="secondary" block loading={board.loading} onClick={() => setLimit((l) => l + PAGE)}>
              Show more
            </Button>
          )}
        </>
      )}
    </section>
  );
}
