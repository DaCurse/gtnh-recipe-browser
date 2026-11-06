import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
/* global document, getComputedStyle, innerWidth, Image */
const [base, playwrightModule, screenshots] = process.argv.slice(2);
if (!playwrightModule) throw new Error('Usage: node tools/test-machine-ui.mjs <app-url> <playwright-module> [screenshots]');
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch({ headless: true });
if (screenshots) await mkdir(screenshots, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); const errors = [], uiImages = new Set();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().includes('/assets/machine-ui/')) {
    assert.equal(response.status(), 200); assert.match(response.headers()['content-type'], /^image\/png/); uiImages.add(response.url());
  } });
  const examples = [
    { type: 'Distillation Tower', item: 'f:BuildCraft|Energy:oil', view: 'usages', map: 'gt.recipe.distillationtower' },
    { type: 'Assemblyline Process', item: 'i:gregtech:gt.metaitem.01:32619', view: 'recipes', map: 'gt.recipe.fakeAssemblylineProcess' },
    { type: 'Chemical Plant', item: 'i:miscutils:item.BasicAgrichemItem:25', view: 'recipes', map: 'gt.recipe.fluidchemicaleactor' }
  ];
  for (const example of examples) {
    const url = new URL(base); url.searchParams.set('item', example.item); url.searchParams.set('view', example.view);
    await page.goto(url.href);
    await page.getByRole('button', { name: example.type, exact: true }).waitFor({ timeout: 120000 });
    await page.getByRole('button', { name: example.type, exact: true }).click();
    const stage = page.locator(`[data-machine-map="${example.map}"]`).first();
    await stage.waitFor({ timeout: 120000 });
    assert(await stage.locator('.slot-surface').count() > 0);
    assert.equal(await stage.locator('.ingredient .slot:not(.frameless)').count(), 0, 'Native layout ingredients must not paint individual frames');
    if (example.type === 'Distillation Tower') {
      assert(await stage.locator('.non-consumable').count() > 0);
      assert.equal(await stage.locator('.non-consumable').first().innerText(), 'NC');
      assert.equal(await stage.locator('.non-consumable').first().evaluate(element => getComputedStyle(element).color), 'rgb(253, 216, 53)');
      const fluid = await stage.locator('.fluid-amount').first().evaluate(element => ({ left: getComputedStyle(element).left, right: getComputedStyle(element).right }));
      assert.equal(fluid.left, '1px');
      assert.equal(await stage.locator('.amount').filter({ hasText: /^0L?$/ }).count(), 0);
      const voltage = page.locator('.voltage-badge.fmt-6').first();
      await voltage.waitFor();
      assert.equal(await voltage.evaluate(element => getComputedStyle(element).color), 'rgb(255, 170, 0)');
      assert.equal(await voltage.getAttribute('title'), 'Tier: Medium Voltage');
      assert.equal(await voltage.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(52, 55, 59)');
      const card = stage.locator('xpath=ancestor::article');
      assert.equal(await card.locator('.duration-badge svg').count(), 1);
      assert.match(await card.locator('.duration-badge').getAttribute('title'), /^Duration: processing time/);
      assert.match(await card.locator('.meta span').filter({ hasText: /EU\/t/ }).first().getAttribute('title'), /^Power usage per tick/);
      assert.equal(await stage.locator('.ingredient').first().evaluate(element => element.getBoundingClientRect().width), 54);
    }
    if (example.type === 'Chemical Plant') {
      const amount = stage.locator('.amount:not(.fluid-amount)').first();
      if (await amount.count()) assert.equal(await amount.evaluate(element => getComputedStyle(element).right), '1px');
    }
    if (example.type === 'Assemblyline Process') assert.equal(await stage.locator('.widget').count(), 4);
    await page.waitForLoadState('networkidle');
    if (screenshots) await page.screenshot({ path: `${screenshots}/${example.map}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (screenshots) await page.screenshot({ path: `${screenshots}/${example.map}-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  const tower = new URL(base); tower.searchParams.set('item', 'i:gregtech:gt.blockmachines:1126'); tower.searchParams.set('view', 'machine-usages');
  await page.goto(tower.href);
  await page.locator('[data-machine-map="gt.recipe.distillationtower"]').first().waitFor({ timeout: 120000 });
  assert.match(await page.locator('.view-tabs').innerText(), /Machine Usages\s+[1-9]/);
  const url = new URL(base); url.searchParams.set('item', 'i:minecraft:iron_ingot:0'); url.searchParams.set('view', 'recipes');
  await page.goto(url.href); await page.getByRole('button', { name: 'Crafting (Shapeless)', exact: true }).waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: 'Crafting (Shapeless)', exact: true }).click();
  await page.locator('.recipe-flow .slot-grid').first().waitFor();
  assert.equal(await page.locator('.recipe-flow .slot-grid').first().evaluate(element => getComputedStyle(element).gridAutoRows), '54px');
  assert(await page.locator('.recipe-flow .slot-surface pattern').count() > 0, 'Fallback grids use shared tiling surfaces');
  await page.getByRole('button', { name: 'Furnace', exact: true }).click();
  const output = page.locator('[data-machine-map="gt.recipe.furnace"] .ingredient').last();
  await output.click({ button: 'right' });
  assert.equal(new URL(page.url()).searchParams.get('view'), 'usages');
  assert.equal(new URL(page.url()).searchParams.get('item'), 'i:minecraft:iron_ingot:0');
  assert(uiImages.size <= 3, 'All machine decorations must share one atlas plus two native slot sprites');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  const oil = new URL(base); oil.searchParams.set('item', examples[0].item); oil.searchParams.set('view', 'usages');
  await page.goto(oil.href);
  await page.getByRole('button', { name: 'Distillation Tower', exact: true }).waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: 'Distillation Tower', exact: true }).click();
  const native = page.locator('[data-machine-map="gt.recipe.distillationtower"]').first();
  await native.waitFor({ timeout: 120000 });
  const atlasUrl = new URL(await native.locator('.widget image').first().getAttribute('href'), base).href;
  assert(await page.evaluate(async url => { const image = new Image(); image.src = url; await image.decode(); return image.naturalWidth > 0; }, atlasUrl), 'UI atlas must decode successfully offline');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ nativeTower: true, nativeAssemblyLine: true, nativeChemicalPlant: true,
    tiledCraftingFallback: true, rightClickNavigation: true, responsive: true, offlineNativeUi: true, uiImages: uiImages.size, errors }));
} finally { await browser.close(); }
