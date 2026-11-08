import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
/* global getComputedStyle, document, innerWidth */
const [base, playwrightModule, screenshots] = process.argv.slice(2);
if (!playwrightModule) throw new Error('Usage: node tools/test-mc-controls.mjs <app-url> <playwright-module> [screenshots]');
const { chromium } = await import(playwrightModule);
if (screenshots) await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/*', route => new URL(route.request().url()).hostname.includes('posthog') ? route.abort() : route.continue());
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('.sequence a').first().waitFor({ timeout: 120000 });
  const action = page.getByRole('link', { name: 'Open item catalogue', exact: true });
  await page.mouse.move(0, 0);
  const state = locator => locator.evaluate(element => {
    const css = getComputedStyle(element);
    return { source: css.borderImageSource, color: css.color, font: css.fontFamily, radius: css.borderRadius,
      width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height };
  });
  const normal = await state(action);
  assert.match(normal.source, /button-normal\.png/);
  assert.match(normal.font, /Minecraft/);
  assert.equal(normal.radius, '0px');
  await action.hover();
  const hover = await state(action);
  assert.match(hover.source, /button-hover\.png/);
  assert.equal(hover.color, 'rgb(239, 198, 47)');
  assert.notEqual(hover.color, normal.color);
  assert.equal(hover.width, normal.width); assert.equal(hover.height, normal.height);
  if (screenshots) await page.locator('.actions').screenshot({ path: `${screenshots}/landing-hover.png` });
  await page.mouse.move(0, 0); await action.focus();
  assert.equal(await action.evaluate(element => element.matches(':focus-visible')), true);
  assert.equal((await state(action)).color, hover.color);
  await action.click();
  await page.locator('.item-tile').first().waitFor();
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => document.querySelectorAll('.item-tile .atlas-sprite').length >= 12);
  assert.match(await page.locator('.item-summary strong').first().evaluate(element => getComputedStyle(element).fontFamily), /Minecraft/);
  assert.equal(await page.locator('.item-tile.mc-button').count(), 0, 'Item slots should not become framed action buttons');
  if (screenshots) await page.screenshot({ path: `${screenshots}/catalogue-desktop.png` });
  await page.getByRole('link', { name: 'Recipe Finder', exact: true }).click();
  await page.getByRole('heading', { name: 'Recipe finder', exact: true }).waitFor();
  const add = page.getByRole('button', { name: '+ Add input', exact: true });
  assert.match((await state(add)).source, /button-normal\.png/);
  await add.click();
  await page.locator('.finder-picker').waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No page overflow at ${width}px`);
    for (const button of await page.locator('.finder-modes .mc-button,.side-heading .mc-button').all()) {
      assert(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Button labels must fit');
      assert((await state(button)).height >= (width <= 800 ? 44 : 40));
    }
    if (screenshots) await page.screenshot({ path: `${screenshots}/finder-${width}.png` });
  }
  await page.getByRole('button', { name: /2\.9\.0/ }).click();
  await page.getByRole('heading', { name: 'Your GTNH versions', exact: true }).waitFor();
  const download = page.locator('.dataset-actions .mc-button.primary').first();
  assert.match((await state(download)).source, /button-normal\.png/, 'Dialogs outside the app shell must use the shared theme');
  await download.hover();
  assert.equal((await state(download)).color, hover.color);
  for (const button of await page.locator('.manager .mc-button').all()) {
    assert(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Dataset button label must fit inside its frame');
  }
  if (screenshots) await page.screenshot({ path: `${screenshots}/datasets-mobile.png` });
  await page.locator('.manager .close').click();
  const furnace = new URL(base);
  furnace.searchParams.set('item', 'i:gregtech:gt.blockmachines:262');
  furnace.searchParams.set('view', 'machine-usages');
  await page.goto(furnace.href);
  await page.locator('.recipe-list article.card').first().waitFor({ timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector('.recipe-loading.recipe-progress'));
  const previous = page.locator('.recipe-pagination button').first();
  await previous.waitFor();
  assert(await previous.isDisabled());
  assert.match((await state(previous)).source, /button-disabled\.png/);
  await previous.hover();
  assert.equal((await state(previous)).color, 'rgb(136, 136, 136)');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (screenshots) await page.screenshot({ path: `${screenshots}/recipes-mobile.png` });
  assert.deepEqual(errors, []);
  console.log('Shadow UI texture states, gold hover, keyboard focus, catalogue font, native-slot isolation, responsive buttons and navigation passed.');
} finally { await browser.close(); }
