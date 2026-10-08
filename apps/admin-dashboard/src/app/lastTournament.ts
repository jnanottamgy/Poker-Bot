/** Remembers the tournament the operator last opened (per browser; a convenience only). */
const KEY = 'jpb.admin.lastTournament';

export function readLastTournament(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeLastTournament(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable (private mode): nothing to remember */
  }
}
