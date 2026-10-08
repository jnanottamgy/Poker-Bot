import type { Alert, AuditEntryDto } from '@jpb/shared-types';
import { Rng, fakeHash } from './rng';
import { TOURNAMENT_SPECS, buildTournament } from './generate';
import type { MockAdmin, MockAdminSession, MockTournament, MockWorld } from './state';

/** Password of every mock account (shown on the login page in mock mode only). */
export const MOCK_PASSWORD = 'poker-demo-2026';

const H = 3600_000;

function makeAdmins(now: number): MockAdmin[] {
  const base = { password: MOCK_PASSWORD, createdBy: 'adm_root', disabled: false, lockedUntil: null, failedLogins: 0 };
  return [
    { ...base, id: 'adm_root', username: 'super', displayName: 'Riya Kapoor', role: 'SUPER_ADMIN', tournamentScope: null, createdAt: now - 90 * 24 * H, createdBy: null, lastLoginAt: now - 2 * H },
    { ...base, id: 'adm_meera', username: 'director', displayName: 'Meera Iyer', role: 'TOURNAMENT_DIRECTOR', tournamentScope: null, createdAt: now - 60 * 24 * H, lastLoginAt: now - 20 * 60_000 },
    { ...base, id: 'adm_karan', username: 'staff', displayName: 'Karan Mehta', role: 'STAFF', tournamentScope: null, createdAt: now - 40 * 24 * H, lastLoginAt: now - 3 * H },
    { ...base, id: 'adm_ana', username: 'viewer', displayName: 'Ana Costa', role: 'VIEWER', tournamentScope: null, createdAt: now - 30 * 24 * H, lastLoginAt: now - 26 * H },
    { ...base, id: 'adm_dev', username: 'campus.td', displayName: 'Dev Rao', role: 'TOURNAMENT_DIRECTOR', tournamentScope: ['trn_campus'], createdAt: now - 20 * 24 * H, lastLoginAt: now - 6 * H },
    { ...base, id: 'adm_lock', username: 'locked.user', displayName: 'Omar Haddad', role: 'STAFF', tournamentScope: null, createdAt: now - 10 * 24 * H, lastLoginAt: null, lockedUntil: now + 15 * 60_000, failedLogins: 5 },
    { ...base, id: 'adm_off', username: 'former.staff', displayName: 'Lena Fischer', role: 'STAFF', tournamentScope: null, createdAt: now - 80 * 24 * H, lastLoginAt: now - 50 * 24 * H, disabled: true },
  ];
}

function makeAlerts(spring: MockTournament, tuesday: MockTournament, now: number): Alert[] {
  const stalled = spring.tables.find((t) => t.stalled);
  const timeoutPlayer = spring.players.find((p) => p.status === 'SEATED' && p.connected === false);
  const a = (x: Partial<Alert> & Pick<Alert, 'id' | 'code' | 'severity' | 'message' | 'at'>): Alert => ({
    tournamentId: spring.id,
    target: null,
    acknowledgedBy: null,
    acknowledgedAt: null,
    resolvedAt: null,
    ...x,
  });
  return [
    a({ id: 'alr_1', code: 'TABLE_STALLED', severity: 'CRITICAL', at: now - 92_000, message: `Table ${stalled?.tableNumber ?? 37} stalled — no hand progress for 92s`, target: stalled ? `table:${stalled.tableId}` : null }),
    a({ id: 'alr_2', code: 'PLAYER_CANNOT_ACT', severity: 'WARNING', at: now - 4 * 60_000, message: `${timeoutPlayer?.displayName ?? 'A player'} timed out 3 hands in a row`, target: timeoutPlayer ? `player:${timeoutPlayer.playerId}` : null }),
    a({ id: 'alr_3', code: 'ACTION_LATENCY_HIGH', severity: 'WARNING', at: now - 18 * 60_000, message: 'Action latency p99 above 250 ms on node worker-2', target: 'node:worker-2', acknowledgedBy: 'adm_meera', acknowledgedAt: now - 15 * 60_000 }),
    a({ id: 'alr_4', code: 'WS_FAILURE_SPIKE', severity: 'INFO', at: now - 70 * 60_000, message: 'WebSocket reconnects spiked to 42/s (venue Wi-Fi handover)', resolvedAt: now - 66 * 60_000, acknowledgedBy: 'adm_karan', acknowledgedAt: now - 69 * 60_000 }),
    a({ id: 'alr_5', code: 'WORKER_LOST', severity: 'CRITICAL', at: now - 2 * H, message: 'Worker worker-3 stopped heartbeating; 34 tables re-leased to worker-1', target: 'node:worker-3', resolvedAt: now - 2 * H + 40_000, acknowledgedBy: 'adm_meera', acknowledgedAt: now - 2 * H + 20_000 }),
    a({ id: 'alr_6', code: 'TOURNAMENT_STALLED', severity: 'WARNING', tournamentId: tuesday.id, at: now - 12 * 60_000, message: 'Tournament paused for more than 10 minutes', target: `tournament:${tuesday.id}` }),
  ];
}

const AUDIT_TEMPLATES: Array<{ action: string; target: (r: Rng, t: MockTournament) => string; reason: string | null; admin: string }> = [
  { action: 'PLAYER_APPROVED', target: (r, t) => `player:${r.pick(t.players).publicId}`, reason: null, admin: 'staff' },
  { action: 'CLOCK_ADD_TIME', target: () => 'tournament', reason: 'Dealer change took longer than planned', admin: 'director' },
  { action: 'TABLE_HOLD', target: (r) => `table:${r.int(1, 120)}`, reason: 'Card count requested by floor', admin: 'director' },
  { action: 'TABLE_RELEASE', target: (r) => `table:${r.int(1, 120)}`, reason: 'Count verified', admin: 'director' },
  { action: 'PLAYER_MOVED', target: (r, t) => `player:${r.pick(t.players).publicId}`, reason: 'Accessibility seat request', admin: 'director' },
  { action: 'ANNOUNCE', target: () => 'tournament', reason: null, admin: 'staff' },
  { action: 'FORCE_TIMEOUT', target: (r) => `table:${r.int(1, 120)}`, reason: 'Player left the venue', admin: 'director' },
  { action: 'ALERT_ACKNOWLEDGED', target: (r) => `alert:alr_${r.int(1, 9)}`, reason: null, admin: 'director' },
  { action: 'ADMIN_LOGIN', target: () => 'admin:director', reason: null, admin: 'director' },
  { action: 'REBALANCE', target: () => 'tournament', reason: null, admin: 'director' },
];

function makeAudit(world: { tournaments: MockTournament[] }, now: number): AuditEntryDto[] {
  const rng = new Rng('audit');
  const raw: Array<Omit<AuditEntryDto, 'seq' | 'prevHash' | 'hash' | 'id'>> = [];
  const ip = () => `10.20.${rng.int(0, 9)}.${rng.int(2, 250)}`;
  for (const t of world.tournaments) {
    raw.push({ at: t.createdAt, tournamentId: t.id, adminId: 'adm_meera', adminUsername: 'director', action: 'TOURNAMENT_CREATED', target: 'tournament', reason: null, beforeState: null, afterState: { name: t.name }, ip: ip() });
    if (t.startedAt === null) continue;
    raw.push({ at: t.startedAt - 30 * 60_000, tournamentId: t.id, adminId: 'adm_meera', adminUsername: 'director', action: 'REGISTRATION_OPENED', target: 'tournament', reason: null, beforeState: { status: 'DRAFT' }, afterState: { status: 'REGISTRATION' }, ip: ip() });
    raw.push({ at: t.startedAt, tournamentId: t.id, adminId: 'adm_meera', adminUsername: 'director', action: 'TOURNAMENT_STARTED', target: 'tournament', reason: null, beforeState: { status: 'REGISTRATION_CLOSED' }, afterState: { status: 'STARTING' }, ip: ip() });
    const span = (t.completedAt ?? now) - t.startedAt;
    const count = Math.min(260, Math.round(t.players.length / 6));
    for (let i = 0; i < count; i++) {
      const tpl = rng.pick(AUDIT_TEMPLATES);
      const before = tpl.action === 'CLOCK_ADD_TIME' ? { remainingMs: 240_000 } : tpl.action === 'TABLE_HOLD' ? { status: 'IN_HAND' } : null;
      const after = tpl.action === 'CLOCK_ADD_TIME' ? { remainingMs: 300_000 } : tpl.action === 'TABLE_HOLD' ? { status: 'HELD', holds: ['ADMIN'] } : null;
      raw.push({
        at: t.startedAt + Math.round(rng.next() * span),
        tournamentId: t.id,
        adminId: tpl.admin === 'staff' ? 'adm_karan' : 'adm_meera',
        adminUsername: tpl.admin,
        action: tpl.action,
        target: tpl.target(rng, t),
        reason: tpl.reason,
        beforeState: before,
        afterState: after,
        ip: ip(),
      });
    }
  }
  const spring = world.tournaments[0]!;
  const p = spring.players.find((x) => x.status === 'SEATED')!;
  raw.push({ at: now - 41 * 60_000, tournamentId: spring.id, adminId: 'adm_meera', adminUsername: 'director', action: 'ADJUST_STACK', target: `player:${p.publicId}`, reason: 'Dealer miscount verified on camera', beforeState: { stack: p.stack - 6050 }, afterState: { stack: p.stack }, ip: '10.20.1.17' });
  raw.push({ at: now - 22 * 60_000, tournamentId: spring.id, adminId: 'adm_meera', adminUsername: 'director', action: 'CLOCK_ADD_TIME', target: 'tournament', reason: 'Venue PA announcement overran', beforeState: { remainingMs: 120_000 }, afterState: { remainingMs: 180_000 }, ip: '10.20.1.17' });
  raw.sort((x, y) => x.at - y.at);
  return chainAudit(raw);
}

/** Assigns seq / id and the hash chain (prevHash → hash) in order. */
export function chainAudit(raw: Array<Omit<AuditEntryDto, 'seq' | 'prevHash' | 'hash' | 'id'>>, start: { seq: number; prevHash: string } = { seq: 0, prevHash: '0'.repeat(64) }): AuditEntryDto[] {
  let prev = start.prevHash;
  return raw.map((e, i) => {
    const seq = start.seq + i + 1;
    const hash = auditHash(prev, seq, e);
    const entry: AuditEntryDto = { ...e, id: `aud_${seq}`, seq, prevHash: prev, hash };
    prev = hash;
    return entry;
  });
}

export function auditHash(prevHash: string, seq: number, e: Pick<AuditEntryDto, 'at' | 'action' | 'target' | 'reason' | 'adminUsername'>): string {
  return fakeHash(`${prevHash}|${seq}|${e.at}|${e.adminUsername}|${e.action}|${e.target}|${e.reason ?? ''}`);
}

function makeSessions(admins: MockAdmin[], now: number): MockAdminSession[] {
  return admins
    .filter((a) => !a.disabled && a.lastLoginAt !== null)
    .map((a, i) => ({
      id: `ses_${a.username}`,
      adminId: a.id,
      createdAt: a.lastLoginAt!,
      lastSeenAt: now - i * 47_000,
      expiresAt: a.lastLoginAt! + 12 * H,
      ip: `10.20.1.${10 + i}`,
      userAgent: i % 2 === 0 ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Chrome/131.0' : 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) Safari/605.1',
      revokedAt: null,
    }));
}

export function buildWorld(now: number): MockWorld {
  const tournaments = TOURNAMENT_SPECS.map((s) => buildTournament(s, now));
  const admins = makeAdmins(now);
  const byKey = (k: string) => tournaments.find((t) => t.seedKey === k)!;
  return {
    tournaments,
    alerts: makeAlerts(byKey('spring'), byKey('tuesday'), now),
    audit: makeAudit({ tournaments }, now),
    admins,
    sessions: makeSessions(admins, now),
    demos: [
      { tournamentId: 'trn_demo1000', joinCode: 'DEMO1K', players: 1000, running: true, status: 'RUNNING', startedAt: now - 48 * 60_000, handsCompleted: 0, actionsSubmitted: 0, playersRemaining: 612 },
      { tournamentId: 'trn_demo32', joinCode: 'DEMO32', players: 32, running: false, status: 'COMPLETED', startedAt: now - 300 * 60_000, handsCompleted: 214, actionsSubmitted: 1890, playersRemaining: 1 },
    ],
    currentSessionId: null,
    idCounter: 1000,
  };
}
