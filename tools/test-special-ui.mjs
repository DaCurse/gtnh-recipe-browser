import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
/* global document, getComputedStyle, innerWidth */
const [base, playwrightModule, screenshots] = process.argv.slice(2);
if (!playwrightModule) throw new Error('Usage: node tools/test-special-ui.mjs <app-url> <playwright-module> [screenshots]');
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch();
if (screenshots) await mkdir(screenshots, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/*', route => new URL(route.request().url()).hostname.includes('posthog') ? route.abort() : route.continue());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = new URL(base);
  url.searchParams.set('item', 'i:gregtech:gt.blockores2:6382');
  url.searchParams.set('view', 'recipes');
  await page.goto(url.href);
  const breeding = page.locator('.type-row button').filter({ hasText: /breeding/i });
  await breeding.waitFor({ timeout: 120000 });
  await breeding.click();
  const card = page.locator('.special-card').first();
  await card.waitFor({ timeout: 120000 });
  assert.match(await page.locator('.view-tabs').innerText(), /Recipes\s+1\b/);
  assert.match(await card.evaluate(element => getComputedStyle(element).borderImageSource), /nei-panel\.png/);
  assert.equal(await breeding.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await card.locator('.special-good .slot:not(.frameless)').count(), 0);
  await card.locator('[data-special-layout="breeding2"], [data-special-layout="breeding4"]').waitFor();
  assert(await card.locator('.special-good').count() >= 3);
  const before = await page.locator('.view-tabs').innerText();
  await card.locator('.special-mark').click();
  await page.locator('.special-card').nth(1).waitFor({ timeout: 120000 });
  assert.equal(await page.locator('.view-tabs').innerText(), before, 'Global special browsing must not replace this item’s totals');
  if (screenshots) await page.screenshot({ path: `${screenshots}/special-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (screenshots) await page.screenshot({ path: `${screenshots}/special-mobile.png` });
  await page.locator('.special-card').first().locator('.special-mark').click();
  const ingredient = page.locator('.special-card .special-good').first();
  await ingredient.click();
  await page.waitForURL(next => next.searchParams.get('item') !== 'i:gregtech:gt.blockores2:6382');
  assert.deepEqual(errors, []);
  console.log('Special-only totals, native crop layout, shared panel/slots, global counts, mobile and item navigation passed.');
} finally {
  await browser.close();
}
