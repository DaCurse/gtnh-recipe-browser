import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
/* global document, getComputedStyle, innerWidth, Image */
const [base, playwrightModule, screenshots] = process.argv.slice(2);
if (!playwrightModule) throw new Error('Usage: node tools/test-special-ui.mjs <app-url> <playwright-module> [screenshots]');
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch();
if (screenshots) await mkdir(screenshots, { recursive: true });
async function assertSlotPaint(slot) {
  const sprite = slot.locator('.atlas-sprite');
  await sprite.waitFor({ timeout: 120000 });
  await sprite.evaluate(async element => {
    const image = new Image();
    image.src = getComputedStyle(element).backgroundImage.slice(5, -2);
    await image.decode();
  });
  // DOM visibility does not detect an opaque sibling painting over a sprite.
  // Hiding the item must change the pixels while leaving the slot intact.
  const painted = await slot.screenshot();
  await slot.locator('.slot').evaluate(element => element.style.visibility = 'hidden');
  const background = await slot.screenshot();
  assert(!painted.equals(background), 'Special item sprite must paint above its slot background');
  await slot.locator('.slot').evaluate(element => element.style.visibility = '');
}
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
  const specialTotal = (await page.locator('.special-tab-count').allTextContents()).reduce((sum, count) => sum + Number(count), 0);
  assert(specialTotal > 0);
  assert.match(await page.locator('.view-tabs').innerText(), new RegExp(`Recipes\\s+${specialTotal}\\b`));
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
  const poolUrl = new URL(base);
  poolUrl.searchParams.set('item', 'i:cropsnh:genericSeed:0:4d096604a46bf1a05b02bcf08e9550d6d33e630e');
  poolUrl.searchParams.set('view', 'recipes');
  poolUrl.searchParams.set('special', 'mutation-pool');
  await page.goto(poolUrl.href);
  const pool = page.locator('.pool-grid').first();
  await pool.waitFor({ timeout: 120000 });
  await assertSlotPaint(pool.locator('.special-slot').first());
  if (screenshots) await page.screenshot({ path: `${screenshots}/pool-mobile.png` });
  const meteorUrl = new URL(base);
  meteorUrl.searchParams.set('item', 'i:appliedenergistics2:tile.BlockSkyChest:1');
  meteorUrl.searchParams.set('view', 'usages');
  meteorUrl.searchParams.set('special', 'meteor-ritual');
  await page.goto(meteorUrl.href);
  const meteor = page.locator('.meteor-card').first();
  await meteor.waitFor({ timeout: 120000 });
  await assertSlotPaint(meteor.locator('.special-slot').first());
  await assertSlotPaint(meteor.locator('.special-goods').filter({ hasText: 'Weighted outputs' }).locator('.special-slot').first());
  if (screenshots) await page.screenshot({ path: `${screenshots}/meteor-mobile.png` });
  assert.deepEqual(errors, []);
  console.log('Special-only totals, native crop layout, shared panel/slots, visible pool and meteor sprites, global counts, mobile and item navigation passed.');
} finally {
  await browser.close();
}
