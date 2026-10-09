import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { WebSocket } from 'ws';
import type { PlayerTableView, ServerMessage, TournamentConfig, TournamentListItemDto } from '@jpb/shared-types';
import { applyPreset, defaultTournamentConfig } from '@jpb/validation';
import { loadEnv } from '../../services/game-server/src/config/env';
import { buildServer } from '../../services/game-server/src/server';
import type { JpbServer } from '../../services/game-server/src/server';
import { createTestDatabase, TEST_DATABASE_URL } from '../../services/game-server/test/helpers/db';
import { Http } from '../../services/game-server/test/helpers/client';

/**
 * The player app in a real (headless Chromium) phone browser against the real
 * server: a fresh production build of apps/player-web served from STATIC_DIR
 * by an in-process game server (PostgreSQL, actors, WebSocket gateway).
 *
 * join → register → one-time rejoin code → lobby → table → an action by
 * tapping a button → staff message → reload (session cookie keeps the seat) →
 * rejoin on a second device with the rejoin code ("another device" →
 * takeover → the first screen goes stale → it takes the seat back).
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const APP_DIR = join(ROOT, 'apps/player-web');
const VITE_BIN = join(ROOT, 'node_modules/vite/bin/vite.js');
const ADMIN = { username: 'director', password: 'a very long e2e password' };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
/** Generous for slow CI machines; the test never waits for a timer to expire. */
const UI_TIMEOUT_MS = 30_000;
const LEVEL_SECONDS = 600;
const ACTION_TIMER_SECONDS = 30;
const BOTS = 3;

function chromiumPath(): string | undefined {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (fromEnv) return fromEnv;
  return existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
}

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => ok(port));
    });
  });
}

/** Fast blinds structure, but long levels and a long action timer: nothing expires while the browser works. */
function browserTestConfig(): TournamentConfig {
  const base = applyPreset(defaultTournamentConfig({ name: 'Browser E2E Cup', maxPlayers: 20 }), 'SPEED_TEST');
  return {
    ...base,
    speedMode: true,
    blindSchedule: base.blindSchedule.map((l) => ({ ...l, durationSeconds: LEVEL_SECONDS })),
    timing: { ...base.timing, actionTimerSeconds: ACTION_TIMER_SECONDS, awayActionTimerSeconds: ACTION_TIMER_SECONDS, startCountdownSeconds: 1 },
  };
}

/** Checks when free, calls small bets, folds to anything big: nobody busts while the test runs. */
class PassiveBot {
  private ws: WebSocket | null = null;
  private readonly answered = new Set<string>();

  constructor(
    private readonly http: Http,
    private readonly url: string,
    private readonly tournamentId: string,
  ) {}

  connect(): Promise<void> {
    return new Promise((ok, fail) => {
      const ws = new WebSocket(this.url, { headers: { cookie: this.http.jar.header(), origin: this.http.origin } });
      this.ws = ws;
      ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, audience: 'PLAYER', tournamentId: this.tournamentId, resume: null })));
      ws.on('message', (data) => {
        const m = JSON.parse(String(data)) as ServerMessage;
        if (m.t === 'snapshot') {
          ok();
          if (m.snapshot.audience === 'PLAYER') this.onView(m.snapshot.table);
        } else if (m.t === 'table_update') this.onView(m.view as PlayerTableView);
      });
      ws.on('error', fail);
    });
  }

  close(): void {
    this.ws?.close();
  }

  private onView(view: PlayerTableView | null): void {
    const legal = view?.you?.legal;
    if (!view || !legal || !view.hand || view.hand.turnVersion === null) return;
    const key = `${view.tableId}:${view.hand.handId}:${view.hand.turnVersion}`;
    if (this.answered.has(key)) return;
    this.answered.add(key);
    const type = legal.canCheck ? 'CHECK' : legal.canCall && legal.callAmount <= view.blinds.bigBlind * 2 ? 'CALL' : 'FOLD';
    this.ws?.send(JSON.stringify({ t: 'action', actionId: randomUUID(), tableId: view.tableId, type, tableStateVersion: view.hand.turnVersion }));
  }
}

/** Every action_result frame the page's WebSocket receives (the server's verdict on a tap). */
function recordActionResults(page: Page): Array<{ ok: boolean; code: string | null }> {
  const results: Array<{ ok: boolean; code: string | null }> = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => {
      try {
        const m = JSON.parse(String(f.payload)) as ServerMessage;
        if (m.t === 'action_result') results.push({ ok: m.ok, code: m.code });
      } catch {
        /* not JSON */
      }
    });
  });
  return results;
}

/** Waits for the hero's decision and taps CHECK when free, otherwise FOLD. */
async function tapAnAction(page: Page): Promise<void> {
  const passive = page.locator('.jpb-act--call');
  const fold = page.locator('.jpb-act--fold');
  await passive.or(fold).first().waitFor({ state: 'visible', timeout: 120_000 });
  const label = (await passive.count()) > 0 ? ((await passive.first().textContent()) ?? '') : '';
  if (/CHECK/.test(label)) await passive.first().click();
  else await fold.first().click();
}

const seatShown = (page: Page) => page.locator('.jpb-table');

describe.skipIf(!TEST_DATABASE_URL)('player app in a phone browser against the real server', () => {
  let server: JpbServer;
  let base: string;
  let staticDir: string;
  let browser: Browser;
  const contexts: BrowserContext[] = [];
  const bots: PassiveBot[] = [];

  beforeAll(async () => {
    staticDir = mkdtempSync(join(tmpdir(), 'jpb-player-e2e-'));
    // A fresh production build, laid out the way the server serves it (STATIC_DIR/player).
    execFileSync(process.execPath, [VITE_BIN, 'build', '--outDir', join(staticDir, 'player'), '--emptyOutDir', '--logLevel', 'error'], {
      cwd: APP_DIR,
      env: { ...process.env, NODE_ENV: 'production', VITE_MOCK: '' },
      stdio: 'pipe',
    });
    expect(existsSync(join(staticDir, 'player/index.html'))).toBe(true);

    const db = await createTestDatabase('e2e_player_browser');
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    const env = loadEnv({
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      // The gateway accepts browser WebSockets only from this origin.
      PUBLIC_BASE_URL: base,
      COOKIE_SECURE: 'false',
      SEED_ENCRYPTION_KEY: 'c'.repeat(64),
      BOOTSTRAP_ADMIN_USERNAME: ADMIN.username,
      BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password,
      RATE_LIMIT_SCALE: '100',
      STATIC_DIR: staticDir,
      NODE_ID: 'e2e-browser',
    });
    server = await buildServer(env, { db });
    await server.listen();
    const close = server.close.bind(server);
    server.close = async () => {
      await close();
      await db.close();
    };
    browser = await chromium.launch({ executablePath: chromiumPath() });
  });

  afterAll(async () => {
    for (const b of bots) b.close();
    for (const c of contexts) await c.close().catch(() => undefined);
    await browser?.close();
    await server?.close();
    if (staticDir) rmSync(staticDir, { recursive: true, force: true });
  });

  it('joins, registers, plays, survives a reload and moves between devices with the rejoin code', async () => {
    const admin = new Http(base, base);
    await admin.ok('POST', '/api/admin/auth/login', ADMIN);
    const { tournament } = await admin.ok<{ tournament: TournamentListItemDto }>('POST', '/api/admin/tournaments', { config: browserTestConfig() });
    const T = `/api/admin/tournaments/${tournament.id}`;
    await admin.ok('POST', `${T}/registration/open`, { reason: 'browser e2e' });

    // ---- join → register → rejoin code → lobby (phone)
    const phone = await browser.newContext(PHONE);
    contexts.push(phone);
    const page = await phone.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const results = recordActionResults(page);

    await page.goto(`${base}/join/${tournament.joinCode}`);
    await expect.poll(() => page.getByRole('heading', { name: 'Browser E2E Cup' }).count(), { timeout: UI_TIMEOUT_MS }).toBe(1);
    await page.getByRole('button', { name: 'JOIN TOURNAMENT' }).click();
    await page.getByLabel('Full name').fill('Grace Hopper');
    await page.getByLabel('Nickname').fill('Grace');
    await page.getByRole('button', { name: 'Register' }).click();
    await page.getByText('Save your rejoin code').waitFor({ timeout: UI_TIMEOUT_MS });
    const publicId = ((await page.locator('.pw-codecard__v').first().textContent()) ?? '').trim();
    const rejoinCode = ((await page.locator('.pw-codecard__code').textContent()) ?? '').trim();
    expect(publicId).toMatch(/^JPN-[0-9A-Z]{4,}$/);
    expect(rejoinCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    // The rejoin code must be acknowledged before going on.
    const goToSeat = page.getByRole('button', { name: /Go to my seat/ });
    expect(await goToSeat.isDisabled()).toBe(true);
    await page.getByLabel('I have saved my player ID and rejoin code').check();
    await goToSeat.click();
    await page.waitForURL('**/play', { timeout: UI_TIMEOUT_MS });
    await page.getByRole('heading', { name: 'Welcome, Grace' }).waitFor({ timeout: UI_TIMEOUT_MS });
    // Before seating the server holds 0 chips for the entry; the lobby shows the configured starting stack.
    await page.getByText('10,000').first().waitFor({ timeout: UI_TIMEOUT_MS });
    expect((await phone.cookies()).some((c) => c.name === 'jpb_ps' && c.httpOnly)).toBe(true);

    // ---- more players (scripted, over the same public interfaces), then start
    for (let i = 0; i < BOTS; i++) {
      const http = new Http(base, base);
      await http.ok('POST', `/api/public/tournaments/${tournament.joinCode}/register`, { fields: { name: `Rail Bird ${i + 1}` }, clientSeed: (i + 7).toString(16).padStart(64, '0') });
      const bot = new PassiveBot(http, `${base.replace('http', 'ws')}/ws`, tournament.id);
      bots.push(bot);
      await bot.connect();
    }
    // Live counters reach the lobby without a reload.
    await page.getByText(`${BOTS + 1} players registered`).waitFor({ timeout: UI_TIMEOUT_MS });
    await admin.ok('POST', `${T}/start`, { adminEntropy: 'browser e2e dice 3-1-4', reason: 'browser e2e' });

    // ---- the table: tap an action, the server accepts it
    await seatShown(page).waitFor({ timeout: 60_000 });
    await tapAnAction(page);
    await expect.poll(() => results.some((r) => r.ok), { timeout: UI_TIMEOUT_MS }).toBe(true);
    expect(results.filter((r) => !r.ok)).toEqual([]);

    // ---- reload: the session cookie brings the seat straight back
    await page.reload();
    await seatShown(page).waitFor({ timeout: UI_TIMEOUT_MS });
    expect(await page.getByText('Please rejoin').count()).toBe(0);

    // ---- a private staff message shows in the banner area (never over the actions) until acknowledged
    const players = await admin.ok<{ rows: Array<{ playerId: string; publicId: string }> }>('GET', `${T}/players?limit=50`);
    const hero = players.rows.find((r) => r.publicId === publicId);
    expect(hero).toBeDefined();
    await admin.ok('POST', `/api/admin/players/${hero!.playerId}/notice`, { text: 'Please visit the director desk at the break.', reason: 'browser e2e' });
    await page.getByText('Please visit the director desk at the break.').waitFor({ timeout: UI_TIMEOUT_MS });
    await page.getByRole('button', { name: 'Got it' }).click();
    await page.getByText('Please visit the director desk at the break.').waitFor({ state: 'detached', timeout: UI_TIMEOUT_MS });

    // ---- another device: rejoin with the code, then take over
    const other = await browser.newContext(PHONE);
    contexts.push(other);
    const page2 = await other.newPage();
    page2.on('pageerror', (e) => pageErrors.push(e.message));
    await page2.goto(`${base}/join/${tournament.joinCode}`);
    await page2.getByRole('button', { name: /Rejoin/ }).first().click();
    // Typed the way people type it: lower case, no dash.
    await page2.getByLabel('Player ID').fill(publicId.toLowerCase().replace('-', ''));
    await page2.getByLabel('Rejoin code').fill(rejoinCode.toLowerCase().replace('-', ''));
    await page2.getByRole('button', { name: 'Rejoin tournament' }).click();
    await page2.waitForURL('**/play', { timeout: UI_TIMEOUT_MS });
    // The first phone still controls the seat: this one asks before taking over.
    await page2.getByRole('button', { name: 'Continue on this device' }).click({ timeout: UI_TIMEOUT_MS });
    await seatShown(page2).waitFor({ timeout: UI_TIMEOUT_MS });
    await page.getByText('This screen is no longer live').waitFor({ timeout: UI_TIMEOUT_MS });

    // ---- and back: the first phone takes its seat again, the second one goes stale
    await page.getByRole('button', { name: 'Use this device' }).click();
    await seatShown(page).waitFor({ timeout: UI_TIMEOUT_MS });
    await page2.getByText('This screen is no longer live').waitFor({ timeout: UI_TIMEOUT_MS });

    expect(pageErrors).toEqual([]);
  });
});
