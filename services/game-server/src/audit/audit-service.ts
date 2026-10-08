import { newId } from '../security/ids';
import type { Repos, Store } from '../persistence/store';
import type { AdminUserRecord } from '../persistence/repos/admins';
import type { AuditRow } from '../persistence/repos/audit';

export interface AuditInput {
  admin: Pick<AdminUserRecord, 'id' | 'username'> | null;
  action: string;
  target: string;
  tournamentId: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
}

/**
 * Writes tamper-evident audit entries (spec §57). Admin overrides call
 * `recordWith` inside the same transaction as the change they describe, so a
 * change can never happen without its audit row (and vice versa).
 */
export class AuditService {
  constructor(
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {}

  recordWith(repos: Repos, input: AuditInput): Promise<AuditRow> {
    return repos.audit.append({
      id: newId('aud'),
      at: this.now(),
      tournamentId: input.tournamentId,
      adminId: input.admin?.id ?? null,
      adminUsername: input.admin?.username ?? 'SYSTEM',
      action: input.action,
      target: input.target,
      reason: input.reason,
      beforeState: input.before ?? null,
      afterState: input.after ?? null,
      ip: input.ip,
    });
  }

  record(input: AuditInput): Promise<AuditRow> {
    return this.store.transaction((repos) => this.recordWith(repos, input));
  }

  system(action: string, target: string, tournamentId: string | null, details: unknown): Promise<AuditRow> {
    return this.record({ admin: null, action, target, tournamentId, reason: null, before: null, after: details, ip: null });
  }
}
