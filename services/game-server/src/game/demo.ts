import type { DemoRequest, DemoStatusDto, LegalActions, TournamentConfig, TournamentEventEnvelope } from '@jpb/shared-types';
import { applyPreset, defaultTournamentConfig } from '@jpb/validation';
import { decide, simulationConfig, testPrizeLadder } from '@jpb/simulation';
import type { BotStrategy } from '@jpb/simulation';
import { secureRandomInt, secureRandomSource } from '@jpb/randomness/node';
import type { RandomSource } from '@jpb/randomness';
import { channels } from '../bus/bus';
import type { MessageBus, Unsubscribe } from '../bus/bus';
import type { TableUpdateMessage, TournamentChannelMessage } from '../runtime/contracts';
import { newId, newJoinCode } from '../security/ids';
import type { GameService } from './game-service';

type DemoStrategy = keyof DemoRequest['strategyMix'];

interface Bot {
  playerId: string;
  strategy: DemoStrategy;
  rng: RandomSource;
  /** turnVersion already answered at a table (one decision per turn). */
  answered: string | null;
  connected: boolean;
}

interface Demo {
  tournamentId: string;
  joinCode: string;
  players: number;
  startedAt: number;
  running: boolean;
  actionsSubmitted: number;
  bots: Map<string, Bot>;
  subs: Map<string, Unsubscribe>;
  timers: Set<NodeJS.Timeout>;
  thinkMs: [number, number];
}

const DEFAULT_MIX: DemoRequest['strategyMix'] = { RANDOM_LEGAL_ACTION: 4, CALL_HEAVY: 2, RAISE_HEAVY: 2, ALL_IN_RANDOMLY: 1, ALWAYS_FOLD: 1 };

/** Weighted, evenly interleaved assignment of strategies to bots. */
export function assignStrategies(n: number, mix: DemoRequest['strategyMix']): DemoStrategy[] {
  const entries = (Object.entries(mix) as Array<[DemoStrategy, number]>).filter(([, w]) => Number.isFinite(w) && w > 0);
  const use = entries.length ? entries : (Object.entries(DEFAULT_MIX) as Array<[DemoStrategy, number]>);
  const total = use.reduce((a, [, w]) => a + w, 0);
  const out: DemoStrategy[] = [];
  for (let i = 0; i < n; i++) {
    let k = (i * 7919) % total;
    for (const [s, w] of use) {
      if (k < w) {
        out.push(s);
        break;
      }
      k -= w;
    }
  }
  return out;
}

/**
 * Demo mode (spec "simulation mode"): a tournament of deterministic rule-based
 * bots (no AI) played through the real runtime — same director, same table
 * actors, same persistence and the same WebSocket fan-out as human players, so
 * the admin control room and broadcast display can be exercised end to end.
 */
export class DemoRunner {
  private readonly demos = new Map<string, Demo>();

  constructor(
    private readonly game: GameService,
    private readonly bus: MessageBus,
    private readonly opts: { maxPlayers: number; speedModeAllowed: boolean },
  ) {}

  list(): DemoStatusDto[] {
    return [...this.demos.values()].map((d) => this.statusOf(d, null));
  }

  async create(req: DemoRequest, adminId: string): Promise<DemoStatusDto> {
    const players = Math.floor(req.players);
    if (!Number.isInteger(players) || players < 2 || players > this.opts.maxPlayers) {
      throw new DemoError('INVALID_INPUT', `Choose between 2 and ${this.opts.maxPlayers.toLocaleString('en-US')} bots.`);
    }
    const speed = req.speedMode && this.opts.speedModeAllowed;
    const name = (req.name?.trim() || `Demo · ${players.toLocaleString('en-US')} bots`).slice(0, 80);
    const joinCode = `DEMO${newJoinCode(4)}`;
    const config = demoConfig(players, speed, name, joinCode);
    const t = await this.game.createTournament({ config, createdBy: adminId, isSimulation: true });
    const demo: Demo = {
      tournamentId: t.id,
      joinCode: t.joinCode,
      players,
      startedAt: Date.now(),
      running: true,
      actionsSubmitted: 0,
      bots: new Map(),
      subs: new Map(),
      timers: new Set(),
      thinkMs: speed ? [150, 900] : [800, 4000],
    };
    this.demos.set(t.id, demo);
    const sub = await this.bus.subscribe(channels.tournamentEvents(t.id), (m) => this.onTournament(demo, m as TournamentChannelMessage));
    demo.subs.set('tournament', sub);
    await this.ok(this.game.directorInput(t.id, { type: 'OPEN_REGISTRATION', admin: { adminId, reason: 'demo' } }));
    await this.registerBots(demo, assignStrategies(players, req.strategyMix ?? DEFAULT_MIX));
    await this.ok(this.game.start(t.id, { adminId, reason: 'demo' }, `demo:${t.id}`));
    // Tables created at START: subscribe to each of them.
    const tables = (await this.game.directorQuery<Array<{ summary: { tableId: string } }>>(t.id, { q: 'TABLES' })) ?? [];
    for (const tb of tables) await this.watchTable(demo, tb.summary.tableId);
    return this.statusOf(demo, null);
  }

  async status(tournamentId: string): Promise<DemoStatusDto | null> {
    const d = this.demos.get(tournamentId);
    if (!d) return null;
    return this.statusOf(d, await this.game.tournamentSummary(tournamentId).catch(() => null));
  }

  async stop(tournamentId: string, adminId: string): Promise<DemoStatusDto | null> {
    const d = this.demos.get(tournamentId);
    if (!d) return null;
    const summary = await this.game.tournamentSummary(tournamentId).catch(() => null);
    if (summary && summary.status !== 'COMPLETED' && summary.status !== 'CANCELLED') {
      await this.game.directorInput(tournamentId, { type: 'CANCEL', admin: { adminId, reason: 'Demo stopped' } }).catch(() => undefined);
    }
    await this.halt(d);
    return this.status(tournamentId);
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.demos.values()].map((d) => this.halt(d)));
  }

  // ------------------------------------------------------------------ internals

  private statusOf(d: Demo, summary: { status: DemoStatusDto['status']; counters: { handsCompleted: number; active: number } } | null): DemoStatusDto {
    const done = summary?.status === 'COMPLETED' || summary?.status === 'CANCELLED';
    return {
      tournamentId: d.tournamentId,
      joinCode: d.joinCode,
      players: d.players,
      running: d.running && !done,
      status: summary?.status ?? 'RUNNING',
      startedAt: d.startedAt,
      handsCompleted: summary?.counters.handsCompleted ?? 0,
      actionsSubmitted: d.actionsSubmitted,
      playersRemaining: summary?.counters.active ?? d.players,
    };
  }

  private async ok(p: Promise<{ ok: boolean; message: string | null }>): Promise<void> {
    const r = await p;
    if (!r.ok) throw new DemoError('DEMO_FAILED', r.message ?? 'The demo could not be started.');
  }

  private async registerBots(demo: Demo, strategies: DemoStrategy[]): Promise<void> {
    const store = this.game.store;
    for (let start = 0; start < strategies.length; start += 500) {
      const chunk = strategies.slice(start, start + 500);
      const created = await store.transaction(async (repos) => {
        const out: Array<{ playerId: string; entryId: string; publicId: string; name: string; seq: number }> = [];
        for (let i = 0; i < chunk.length; i++) {
          const n = start + i + 1;
          const seq = await repos.tournaments.nextRegistrationSeq(demo.tournamentId);
          const playerId = newId('ply');
          const entryId = newId('ent');
          const publicId = `BOT-${String(n).padStart(5, '0')}`;
          const name = `Bot ${n}`;
          await repos.players.createPlayer({ id: playerId, tournamentId: demo.tournamentId, publicId, displayName: name, nickname: chunk[i]!.replace(/_/g, ' ').toLowerCase(), participantId: null, email: null, phone: null, collegeId: null });
          await repos.players.createEntry({ entryId, tournamentId: demo.tournamentId, playerId, registrationSeq: seq, entryNumber: 1, status: 'REGISTERED', clientSeed: null, stack: 0 });
          out.push({ playerId, entryId, publicId, name, seq });
        }
        return out;
      });
      for (let i = 0; i < created.length; i++) {
        const c = created[i]!;
        const reply = await this.game.registerPlayer(demo.tournamentId, { playerId: c.playerId, entryId: c.entryId, displayName: c.name, publicId: c.publicId, registrationSeq: c.seq, clientSeed: null, approved: true });
        if (!reply.ok) throw new DemoError('DEMO_FAILED', reply.message ?? 'Bot registration failed.');
        demo.bots.set(c.playerId, { playerId: c.playerId, strategy: chunk[i]!, rng: secureRandomSource(), answered: null, connected: true });
      }
    }
  }

  private onTournament(demo: Demo, m: TournamentChannelMessage): void {
    if (m.kind !== 'TOURNAMENT_EVENT') return;
    const e = (m.envelope as TournamentEventEnvelope).event;
    if (e.kind === 'TABLE_CREATED') void this.watchTable(demo, e.tableId);
    if (e.kind === 'TOURNAMENT_COMPLETED' || (e.kind === 'TOURNAMENT_STATUS_CHANGED' && (e.to === 'COMPLETED' || e.to === 'CANCELLED'))) void this.halt(demo);
  }

  private async watchTable(demo: Demo, tableId: string): Promise<void> {
    if (!demo.running || demo.subs.has(tableId)) return;
    demo.subs.set(tableId, async () => undefined);
    const unsub = await this.bus.subscribe(channels.tableEvents(tableId), (m) => this.onTable(demo, m as TableUpdateMessage));
    demo.subs.set(tableId, unsub);
    // Catch up with a turn that started before we subscribed.
    const snap = await this.game.tableSnapshot(tableId).catch(() => null);
    if (snap) this.onTable(demo, snap);
  }

  private onTable(demo: Demo, m: TableUpdateMessage): void {
    if (!demo.running || m.kind !== 'TABLE_UPDATE') return;
    if (m.publicView.status === 'CLOSED') {
      const unsub = demo.subs.get(m.tableId);
      demo.subs.delete(m.tableId);
      void unsub?.();
      return;
    }
    const turnVersion = m.publicView.hand?.turnVersion ?? null;
    if (turnVersion === null) return;
    for (const [playerId, priv] of Object.entries(m.privateByPlayer)) {
      if (!priv.legal) continue;
      const bot = demo.bots.get(playerId);
      if (!bot) continue;
      const key = `${m.tableId}:${m.publicView.hand?.handId}:${turnVersion}`;
      if (bot.answered === key) continue;
      bot.answered = key;
      this.schedule(demo, bot, m.tableId, turnVersion, priv.legal);
    }
  }

  private schedule(demo: Demo, bot: Bot, tableId: string, turnVersion: number, legal: LegalActions): void {
    let strategy: BotStrategy;
    if (bot.strategy === 'FLAKY') {
      // Flaky connection: sometimes drops for a while (the table marks it away), otherwise plays normally.
      if (secureRandomInt(100) < 15) {
        bot.connected = !bot.connected;
        this.game.playerConnection(bot.playerId, bot.connected);
      }
      if (!bot.connected) return;
      strategy = 'RANDOM_LEGAL_ACTION';
    } else strategy = bot.strategy;
    const intent = decide(strategy, legal, bot.rng);
    if (!intent) return;
    const [lo, hi] = demo.thinkMs;
    const timer = setTimeout(() => {
      demo.timers.delete(timer);
      if (!demo.running) return;
      demo.actionsSubmitted++;
      void this.game
        .submitPlayerAction({ playerId: bot.playerId, tableId, actionId: newId('bot'), type: intent.type, ...(intent.amount !== undefined ? { amount: intent.amount } : {}), tableStateVersion: turnVersion, receivedAt: Date.now() })
        .catch(() => undefined);
    }, lo + secureRandomInt(Math.max(1, hi - lo)));
    demo.timers.add(timer);
  }

  private async halt(d: Demo): Promise<void> {
    if (!d.running) return;
    d.running = false;
    for (const t of d.timers) clearTimeout(t);
    d.timers.clear();
    await Promise.allSettled([...d.subs.values()].map((u) => u()));
    d.subs.clear();
  }
}

export class DemoError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function demoConfig(players: number, speed: boolean, name: string, joinCode: string): TournamentConfig {
  const paid = Math.max(1, Math.floor(players * 0.15));
  const base = speed
    ? simulationConfig(players)
    : applyPreset(defaultTournamentConfig({ name, joinCode, minPlayers: 2, maxPlayers: Math.max(2, players) }), 'HYPER');
  return {
    ...base,
    name,
    joinCode,
    minPlayers: 2,
    maxPlayers: Math.max(2, players),
    registration: { ...base.registration, requireApproval: false, accessCode: null },
    spectators: { ...base.spectators, enabled: true, publicWatch: true, delaySeconds: 0 },
    features: { ...base.features, broadcastDisplay: true, spectatorMode: true },
    prizeStructure: { currency: 'INR', places: testPrizeLadder(paid), notes: 'Demo prizes (not real money).' },
  };
}
