import type { AdminRole } from '@jpb/shared-types';
import { hashPassword, verifyPassword } from '../security/crypto';
import { newId } from '../security/ids';
import type { Store } from '../persistence/store';
import type { AdminUserRecord } from '../persistence/repos/admins';
import type { AuditService } from '../audit/audit-service';

/** A fixed, valid scrypt hash used to equalize timing when a username does not exist. */
let DUMMY_HASH: Promise<string> | null = null;
const dummyHash = () => (DUMMY_HASH ??= hashPassword('jpb-dummy-password-for-timing'));

export type LoginResult =
  | { ok: true; admin: AdminUserRecord }
  | { ok: false; reason: 'INVALID_CREDENTIALS' | 'LOCKED' | 'DISABLED' };

export const PASSWORD_POLICY = { minLength: 12, maxLength: 256 } as const;

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_POLICY.minLength) return `Password must be at least ${PASSWORD_POLICY.minLength} characters.`;
  if (password.length > PASSWORD_POLICY.maxLength) return 'Password is too long.';
  return null;
}

export class AdminAuthService {
  constructor(
    private readonly store: Store,
    private readonly audit: AuditService,
  ) {}

  /** Creates the first SUPER_ADMIN from environment variables if no admin exists yet. */
  async bootstrap(credentials: { username: string; password: string } | null): Promise<AdminUserRecord | null> {
    if (!credentials) return null;
    if ((await this.store.repos.admins.count()) > 0) return null;
    const problem = validatePassword(credentials.password);
    if (problem) throw new Error(`BOOTSTRAP_ADMIN_PASSWORD: ${problem}`);
    const admin = await this.store.repos.admins.create({
      id: newId('adm'),
      username: credentials.username,
      displayName: credentials.username,
      role: 'SUPER_ADMIN',
      passwordHash: await hashPassword(credentials.password),
      tournamentScope: null,
      createdBy: null,
    });
    await this.audit.system('ADMIN_BOOTSTRAPPED', `admin:${admin.username}`, null, { role: admin.role });
    return admin;
  }

  async login(username: string, password: string, ip: string | null): Promise<LoginResult> {
    const admin = await this.store.repos.admins.findByUsername(username);
    if (!admin) {
      await verifyPassword(password, await dummyHash());
      await this.audit.system('ADMIN_LOGIN_FAILED', `admin:${username.slice(0, 64)}`, null, { reason: 'UNKNOWN_USER', ip });
      return { ok: false, reason: 'INVALID_CREDENTIALS' };
    }
    if (admin.disabledAt) return { ok: false, reason: 'DISABLED' };
    if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) return { ok: false, reason: 'LOCKED' };
    const valid = await verifyPassword(password, admin.passwordHash);
    if (!valid) {
      await this.store.repos.admins.recordLoginFailure(admin.id);
      await this.audit.system('ADMIN_LOGIN_FAILED', `admin:${admin.username}`, null, { reason: 'BAD_PASSWORD', ip });
      return { ok: false, reason: 'INVALID_CREDENTIALS' };
    }
    await this.store.repos.admins.recordLoginSuccess(admin.id);
    return { ok: true, admin };
  }

  async createAdmin(
    actor: AdminUserRecord,
    input: { username: string; displayName: string; role: AdminRole; password: string; tournamentScope: string[] | null },
    ip: string | null,
  ): Promise<AdminUserRecord> {
    const problem = validatePassword(input.password);
    if (problem) throw new Error(problem);
    if (input.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') throw new Error('Only a SUPER_ADMIN can create another SUPER_ADMIN.');
    return this.store.transaction(async (repos) => {
      const created = await repos.admins.create({
        id: newId('adm'),
        username: input.username,
        displayName: input.displayName,
        role: input.role,
        passwordHash: await hashPassword(input.password),
        tournamentScope: input.tournamentScope,
        createdBy: actor.id,
      });
      await this.audit.recordWith(repos, {
        admin: actor,
        action: 'ADMIN_USER_CREATED',
        target: `admin:${created.username}`,
        tournamentId: null,
        reason: null,
        before: null,
        after: { role: created.role, tournamentScope: created.tournamentScope },
        ip,
      });
      return created;
    });
  }
}
