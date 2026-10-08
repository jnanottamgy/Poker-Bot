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
 * plus a few interaction shots (raise sizer open, high-contrast mode).
 */
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = fileURLToPath(new URL('./screenshots/', import.meta.url));

const ALL_SECTIONS = ['tokens', 'primitives', 'cards', 'player', 'actions', 'notices', 'table', 'final', 'admin', 'dialogs', 'broadcast'];
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
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 0) errors.push(`[${name}] ${section}: horizontal overflow of ${overflow}px`);
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
      if (sections.includes('player')) {
        await page.goto(`${base}?section=player&contrast=high&deck=four-color`);
        await settle(page);
        await page.getByTestId('phone-turn').screenshot({ path: `${outDir}player-high-contrast-${name}.png` });
        console.log(`saved player-high-contrast-${name}.png`);
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
