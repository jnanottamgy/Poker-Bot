import type pg from 'pg';
import type { Database } from './db';
import type { Queryable } from './db';
import { AdminRepo } from './repos/admins';
import { AlertRepo } from './repos/alerts';
import { AuditRepo } from './repos/audit';
import { DirectorLogRepo, TableLogRepo } from './repos/logs';
import { PlayerRepo } from './repos/players';
import { SessionRepo } from './repos/sessions';
import { TournamentRepo } from './repos/tournaments';

/** All repositories bound to one connection (pool or transaction client). */
export interface Repos {
  admins: AdminRepo;
  sessions: SessionRepo;
  tournaments: TournamentRepo;
  players: PlayerRepo;
  audit: AuditRepo;
  alerts: AlertRepo;
  tableLogs: TableLogRepo;
  directorLogs: DirectorLogRepo;
  q: Queryable;
}

export function bindRepos(q: Queryable): Repos {
  return {
    admins: new AdminRepo(q),
    sessions: new SessionRepo(q),
    tournaments: new TournamentRepo(q),
    players: new PlayerRepo(q),
    audit: new AuditRepo(q),
    alerts: new AlertRepo(q),
    tableLogs: new TableLogRepo(q),
    directorLogs: new DirectorLogRepo(q),
    q,
  };
}

export class Store {
  readonly repos: Repos;

  constructor(readonly db: Database) {
    this.repos = bindRepos(db.pool);
  }

  /** All-or-nothing unit of work (spec §63). */
  transaction<T>(fn: (repos: Repos, client: pg.PoolClient) => Promise<T>): Promise<T> {
    return this.db.transaction((client) => fn(bindRepos(client), client));
  }

  close(): Promise<void> {
    return this.db.close();
  }
}
