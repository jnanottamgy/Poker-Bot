import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { AdminMeDto } from '@jpb/shared-types';

/** True when the admin may act on this tournament (null scope = every tournament). */
export function inTournamentScope(me: AdminMeDto | null, tournamentId: string | null): boolean {
  if (!me) return false;
  if (tournamentId === null) return true;
  const scope = me.admin.tournamentScope;
  return scope === null || scope.includes(tournamentId);
}

const TournamentScopeContext = createContext<string | null>(null);

/** Provided by the /t/:tournamentId layout: the tournament every section below works on. */
export function TournamentScopeProvider({ tournamentId, children }: { tournamentId: string | null; children: ReactNode }) {
  return <TournamentScopeContext.Provider value={tournamentId}>{children}</TournamentScopeContext.Provider>;
}

/** Current tournament, or null on global screens (Tournaments, Admin users, Demo…). */
export function useCurrentTournamentId(): string | null {
  return useContext(TournamentScopeContext);
}

/** Current tournament id for tournament-scoped sections (throws outside /t/:tournamentId). */
export function useTournamentId(): string {
  const id = useContext(TournamentScopeContext);
  if (!id) throw new Error('useTournamentId() used outside a tournament route');
  return id;
}
