#!/usr/bin/env bun
/* Browser smoke test for TinTito.
 * Prerequisites: app server on :8080 (ALLOW_PRIVATE=1) and demo MUD on :7777.
 *   bun run demo
 *   ALLOW_PRIVATE=1 PORT=8080 bun run start
 *   bun x playwright install chromium   (once)
 *   bun run ui-smoke
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const MUD_HOST = process.env.MUD_HOST || '127.0.0.1';
const MUD_PORT = process.env.MUD_PORT || '7777';
const OUT = process.env.SHOT_DIR || 'artifacts';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const errors = [];
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.stack || e.message));

try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#welcome').isVisible(), true);
  assert.match(await page.locator('#brandTitle').textContent(), /TinTito/);
  await page.screenshot({ path: `${OUT}/welcome-phone.png` });

  // Connect through the visible form, not a URL shortcut.
  await page.locator('#hostInput').fill(MUD_HOST);
  await page.locator('#portInput').fill(String(MUD_PORT));
  await page.locator('#connectBtn').click();
  await page.waitForSelector('#play:not([hidden])', { timeout: 10000 });
  await page.waitForFunction(
    () => document.querySelector('#statusPill')?.dataset.state === 'connected',
    null,
    { timeout: 10000 },
  );
  await page.waitForTimeout(900);

  const viewportText = await page.locator('#viewport').innerText();
  assert.match(viewportText, /TINY TITO'S KENNEL/);
  assert.equal(await page.locator('#jump').isHidden(), true, 'jump hidden at bottom');
  let metrics = await page.locator('#viewport').evaluate((v) => ({
    sw: v.scrollWidth, cw: v.clientWidth, sh: v.scrollHeight, ch: v.clientHeight, st: v.scrollTop,
  }));
  assert.ok(metrics.sw <= metrics.cw + 1, 'terminal has no horizontal overflow');
  assert.ok(metrics.sh - metrics.st - metrics.ch < 4, 'terminal starts pinned to the bottom');
  assert.match(await page.locator('#viewport').evaluate((v) => getComputedStyle(v).fontFamily), /JetBrains Mono/);
  await page.screenshot({ path: `${OUT}/terminal-phone.png` });

  await page.locator('#cmd').fill('look');
  await page.locator('#cmd').press('Enter');
  await page.waitForTimeout(600);
  assert.match(await page.locator('#viewport').innerText(), /Kennel courtyard/);
  assert.match(await page.locator('#viewport').innerText(), /training dummy/);
  await page.screenshot({ path: `${OUT}/terminal-look.png` });

  // Overflow the screen, scroll up, and use the jump pill.
  for (let i = 0; i < 4; i++) {
    await page.locator('#cmd').fill('help');
    await page.locator('#cmd').press('Enter');
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(500);
  await page.locator('#viewport').evaluate((v) => { v.scrollTop = 0; });
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#jump').isVisible(), true, 'jump appears when scrolled up');
  await page.locator('#jump').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#jump').isHidden(), true, 'jump hides after returning');

  // Settings: font swap must re-measure and keep the terminal aligned.
  await page.locator('#btnSettings').click();
  assert.equal(await page.locator('#settings').evaluate((d) => d.open), true);
  await page.screenshot({ path: `${OUT}/settings-phone.png` });
  await page.locator('#fontSelect').selectOption('plex');
  await page.waitForTimeout(500);
  await page.locator('#doneSettings').click();
  assert.match(await page.locator('#viewport').evaluate((v) => getComputedStyle(v).fontFamily), /IBM Plex Mono/);
  await page.screenshot({ path: `${OUT}/terminal-plex.png` });

  // Rotate: keep the latest output in view.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(900);
  metrics = await page.locator('#viewport').evaluate((v) => ({
    sh: v.scrollHeight, ch: v.clientHeight, st: v.scrollTop,
  }));
  assert.ok(metrics.sh - metrics.st - metrics.ch < 4, 'rotation stays pinned to the bottom');
  await page.screenshot({ path: `${OUT}/terminal-landscape.png` });

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desktop.goto(BASE + '/', { waitUntil: 'networkidle' });
  await desktop.waitForTimeout(400);
  await desktop.screenshot({ path: `${OUT}/welcome-desktop.png` });

  assert.deepEqual(errors, [], 'no console or page errors');
  console.log(`ok — screenshots in ${OUT}/`);
} finally {
  await browser.close();
}
