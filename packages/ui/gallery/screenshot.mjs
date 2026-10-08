#!/usr/bin/env node
/**
 * Captures gallery screenshots with Playwright Chromium.
 *
 *   node packages/ui/gallery/screenshot.mjs [section ...]
 *
 * Starts a Vite dev server for the gallery on a free port, then saves one
 * full-page PNG per section and viewport into packages/ui/gallery/screenshots/:
 *   <section>-mobile.png   (390 x 844, DPR 2, touch)
 *   <section>-desktop.png  (1440 x 900)
 * plus interaction shots (raise sizer, all-in confirmation, high-contrast mode),
 * and these CHECKS (any failure sets a non-zero exit code):
 *   - no horizontal overflow: documentElement.scrollWidth <= the FIXED viewport
 *     width (mobile emulation widens innerWidth to fit content, so innerWidth
 *     would hide the very overflow we are looking for);
 *   - player-fit: on a 390 x 664 viewport (Safari with its toolbars) the bottom
 *     of FOLD is on screen;
 *   - geometry: for 2-10 seat tall tables at 328 / 358 / 398px, no seat box
 *     intersects the board, the pot or another seat box (mid-hand, spectator and
 *     showdown), and no bet marker covers a seat box on the wide tables;
 *   - variant="tall" and variant="auto" render identically at 366px.
 */
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = fileURLToPath(new URL('./screenshots/', import.meta.url));

const ALL_SECTIONS = ['tokens', 'primitives', 'cards', 'player', 'actions', 'notices', 'table', 'final', 'admin', 'dialogs', 'palette', 'broadcast', 'geometry'];
const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const sections = requested.length > 0 ? requested : ALL_SECTIONS;

const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  // Let entrance animations finish so shots show the resting state.
  await page.waitForTimeout(900);
}

/** In-page: seat boxes vs board / pot / each other (and face-up cards) for every [data-geom] cell. */
function checkGeometry() {
  const out = [];
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  for (const cell of document.querySelectorAll('[data-geom]')) {
    const id = cell.getAttribute('data-geom');
    const table = cell.querySelector('.jpb-table').getBoundingClientRect();
    const board = cell.querySelector('.jpb-board').getBoundingClientRect();
    const pot = cell.querySelector('.jpb-pot').getBoundingClientRect();
    const slots = [...cell.querySelectorAll('.jpb-table__slot:not(.is-docked)')].filter((e) => e.querySelector('.jpb-seat__pod'));
    const pods = slots.map((e) => e.querySelector('.jpb-seat__pod').getBoundingClientRect());
    const cards = slots.map((e) => e.querySelector('.jpb-seat__cards')?.getBoundingClientRect() ?? null);
    pods.forEach((p, i) => {
      if (hit(p, board)) out.push(`${id}: seat box ${i} covers the board`);
      if (hit(p, pot)) out.push(`${id}: seat box ${i} covers the pot`);
      if (p.left < table.left - 1 || p.right > table.right + 1 || p.top < table.top - 1 || p.bottom > table.bottom + 1) out.push(`${id}: seat box ${i} outside the table`);
      pods.forEach((q, j) => {
        if (j > i && hit(p, q)) out.push(`${id}: seat boxes ${i} and ${j} overlap`);
      });
      cards.forEach((c, j) => {
        if (c && j !== i && hit(p, c)) out.push(`${id}: seat box ${i} covers the cards of seat ${j}`);
      });
    });
    cards.forEach((c, i) => {
      if (c && hit(c, board)) out.push(`${id}: cards of seat ${i} cover the board`);
    });
  }
  return out;
}

/** In-page: on wide tables, a bet marker never covers a seat box or the board. */
function checkWideBets() {
  const out = [];
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  document.querySelectorAll('.jpb-table-wrap[data-layout="wide"]').forEach((wrap, t) => {
    const board = wrap.querySelector('.jpb-board').getBoundingClientRect();
    const pods = [...wrap.querySelectorAll('.jpb-seat__pod')].map((e) => e.getBoundingClientRect());
    wrap.querySelectorAll('.jpb-table__bet').forEach((b, i) => {
      const r = b.getBoundingClientRect();
      if (hit(r, board)) out.push(`wide table ${t}: bet ${i} covers the board`);
      pods.forEach((p, j) => {
        if (hit(r, p)) out.push(`wide table ${t}: bet ${i} covers seat box ${j}`);
      });
    });
    pods.forEach((p, i) => {
      if (hit(p, board)) out.push(`wide table ${t}: seat box ${i} covers the board`);
    });
  });
  return out;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const server = await createServer({ configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)), root: here, server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5173;
  const base = `http://127.0.0.1:${port}/`;
  console.log(`gallery on ${base}`);

  const browser = await chromium.launch();
  const errors = [];
  try {
    for (const [name, opts] of Object.entries(VIEWPORTS)) {
      const context = await browser.newContext({ ...opts, colorScheme: 'dark' });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`[${name}] console: ${m.text()}`);
      });
      for (const section of sections) {
        await page.goto(`${base}?section=${section}`);
        await settle(page);
        const width = opts.viewport.width;
        const overflow = await page.evaluate((w) => document.documentElement.scrollWidth - w, width);
        // The geometry page lays out fixed 328-398px test cells on purpose.
        if (overflow > 0 && section !== 'geometry') errors.push(`[${name}] ${section}: horizontal overflow of ${overflow}px`);
        const file = `${outDir}${section}-${name}.png`;
        await page.screenshot({ path: file, fullPage: true });
        console.log(`saved ${file}`);
      }

      if (sections.includes('actions')) {
        // Interaction: open the raise sizer and pick a preset.
        await page.goto(`${base}?section=actions`);
        await settle(page);
        const host = page.getByTestId('sizer-host');
        await host.getByRole('button', { name: 'RAISE' }).click();
        await host.getByRole('button', { name: /^2\.5x/ }).click();
        await page.waitForTimeout(400);
        await host.screenshot({ path: `${outDir}actions-sizer-${name}.png` });
        console.log(`saved actions-sizer-${name}.png`);
      }
      if (sections.includes('actions')) {
        await page.goto(`${base}?section=actions`);
        await settle(page);
        const host = page.getByTestId('confirm-host');
        await host.getByRole('button', { name: /^ALL-IN/ }).click();
        await page.waitForTimeout(300);
        await host.screenshot({ path: `${outDir}actions-confirm-${name}.png` });
        console.log(`saved actions-confirm-${name}.png`);
      }
      if (sections.includes('player')) {
        await page.goto(`${base}?section=player&contrast=high&deck=four-color`);
        await settle(page);
        await page.getByTestId('phone-turn').screenshot({ path: `${outDir}player-high-contrast-${name}.png` });
        console.log(`saved player-high-contrast-${name}.png`);
      }
      await context.close();
    }

    if (sections.includes('player')) {
      // The real phone viewport: Safari on a 390 x 844 iPhone shows ~664px.
      const context = await browser.newContext({ ...VIEWPORTS.mobile, viewport: { width: 390, height: 664 }, colorScheme: 'dark' });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`[fit] ${e.message}`));
      await page.goto(`${base}?section=fit`);
      await settle(page);
      const fold = await page.getByRole('button', { name: 'FOLD' }).boundingBox();
      if (!fold || fold.y + fold.height > 664) errors.push(`[fit] FOLD bottom at ${fold ? Math.round(fold.y + fold.height) : 'missing'} > 664`);
      else console.log(`player-fit: FOLD bottom at ${Math.round(fold.y + fold.height)}px (<= 664)`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - 390);
      if (overflow > 0) errors.push(`[fit] horizontal overflow of ${overflow}px`);
      await page.screenshot({ path: `${outDir}player-fit.png` });
      console.log('saved player-fit.png');
      await context.close();
    }

    if (sections.includes('geometry')) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
      const page = await context.newPage();
      for (const mode of ['hand', 'spectator', 'showdown']) {
        await page.goto(`${base}?section=geometry&mode=${mode}`);
        await settle(page);
        const problems = await page.evaluate(checkGeometry);
        for (const p of problems) errors.push(`[geometry ${mode}] ${p}`);
        console.log(`geometry ${mode}: ${problems.length} overlap problem(s)`);
      }
      // Compare with motion off: the board flip / pot count-up would differ frame to frame.
      await page.goto(`${base}?section=geometry&motion=reduced`);
      await settle(page);
      // Structural visual diff (sub-pixel x offsets make raw pixels differ between identical renders).
      const boxes = await page.evaluate(() => {
        const out = {};
        for (const el of document.querySelectorAll('[data-compare]')) {
          const o = el.getBoundingClientRect();
          out[el.getAttribute('data-compare')] = JSON.stringify(
            [...el.querySelectorAll('.jpb-seat__pod, .jpb-board, .jpb-pot, .jpb-dock, .jpb-table, .jpb-seat__cards')].filter((e) => e.getClientRects().length > 0).map((e) => {
              const r = e.getBoundingClientRect();
              return [e.className, Math.round(r.left - o.left), Math.round(r.top - o.top), Math.round(r.width), Math.round(r.height)];
            }),
          );
        }
        return out;
      });
      if (boxes.tall !== boxes.auto) errors.push('[geometry] variant="tall" and variant="auto" lay out differently at 366px');
      if (boxes.tall !== boxes.wide) errors.push('[geometry] variant="wide" does not fall back to the tall layout at 366px');
      else console.log('geometry: tall, auto and wide are identical at 366px');
      await context.close();
    }

    if (sections.includes('table') || sections.includes('final')) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
      const page = await context.newPage();
      for (const section of ['table', 'final']) {
        await page.goto(`${base}?section=${section}`);
        await settle(page);
        const problems = await page.evaluate(checkWideBets);
        for (const p of problems) errors.push(`[${section}] ${p}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  if (errors.length > 0) {
    console.error(`\n${errors.length} page error(s):\n${errors.join('\n')}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
