import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
/* global document, innerWidth, getComputedStyle */
const [base, playwrightModule, screenshots] = process.argv.slice(2);
if (!playwrightModule) throw new Error('Usage: node tools/test-ore-diagrams.mjs <app-url> <playwright-module> [screenshots]');
const registry = JSON.parse(await readFile('src/lib/generated/ore-diagrams.json', 'utf8'));
const datasetId = '2.9.0-v7-rbd0b48ae8ad7';
const index = JSON.parse(gunzipSync(await readFile(`public/assets/sha256/${registry.releases[datasetId].sha256}`)));
const data = JSON.parse(gunzipSync(await readFile(`public/assets/sha256/${index.scenes.sha256}`)));
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch();
if (screenshots) await mkdir(screenshots, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1800 } });
  const page = await context.newPage();
  await page.route('**/*', route => new URL(route.request().url()).hostname.includes('posthog') ? route.abort() : route.continue());
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const cases = [
    ['chemical-baths', keys => keys.has('crushed-ore-bath-mercury') && keys.has('crushed-ore-bath-sodium-persulfate')],
    ['sifting', keys => keys.has('purified-ore-sift')],
    ['split-thermal', keys => keys.has('ore-thermal-centrifuge-crushed') && keys.has('ore-thermal-centrifuge-purified')],
    ['additional-recipes', keys => keys.has('additional-recipe-outputs')]
  ];
  let lastUrl;
  for (const [name, matches] of cases) {
    const [sceneId, scene] = Object.entries(data.scenes).find(([, scene]) => matches(new Set(scene.slots.map(slot => slot.key))));
    const slot = scene.slots.find(slot => slot.key === 'raw-ore');
    const item = scene.groups.find(group => group.pos[0] === slot.pos[0] && group.pos[1] === slot.pos[1]).components[0].id;
    const url = new URL(base); url.searchParams.set('version', datasetId); url.searchParams.set('item', item);
    url.searchParams.set('view', 'usages'); url.searchParams.set('special', 'gt-ore-processing');
    await page.goto(url.href); lastUrl = url.href;
    const card = page.locator(`[data-record-id="native-ore:${sceneId}"]`);
    await card.waitFor({ timeout: 120000 });
    assert.equal(await page.locator('.type-row .special-tab small').first().innerText(), 'GT Ore Processing');
    const chart = card.locator('.native-ore-diagram');
    assert(await card.evaluate(element => {
      const card = element.getBoundingClientRect(), list = element.parentElement.getBoundingClientRect();
      return Math.abs((card.left + card.right) / 2 - (list.left + list.right) / 2) < 1;
    }), 'A single diagram should be centered in the available width');
    assert.equal(await chart.locator('.diagram-segment').count(), scene.paths.length);
    assert.equal(await chart.locator('svg image').count(), scene.slots.length);
    assert.equal(await chart.locator('.diagram-item:not(.diagram-machine)').count(), scene.groups.length);
    assert.equal(await chart.locator('.diagram-machine').count(), scene.labels.length);
    await page.waitForFunction(element => [...element.querySelectorAll('.diagram-item')].every(item => item.querySelector('.atlas-sprite')), await chart.elementHandle(), { timeout: 120000 });
    await page.waitForLoadState('networkidle');
    assert.equal(await chart.locator('.slot:not(.frameless)').count(), 0);
    assert.equal(await card.locator('.ore-graph-node').count(), 0);
    if (screenshots) await card.screenshot({ path: `${screenshots}/${name}-desktop.png` });
    const machine = chart.locator('.diagram-machine').first();
    await machine.hover(); await page.locator('.floating-tooltip').waitFor();
    await page.mouse.move(0, 0);
    assert.equal(await chart.locator('.diagram-controls').count(), 0);
    for (const tab of await page.locator('.type-row .machine-tab').all()) {
      const count = tab.locator('.machine-tab-count');
      assert.equal((await count.innerText()).replaceAll(',', ''), (await tab.getAttribute('title')).match(/\((\d+)\)$/)[1]);
      assert(await count.evaluate(element => {
        const count = element.getBoundingClientRect(), icon = element.parentElement.getBoundingClientRect();
        return count.left >= icon.left && count.right <= icon.right && count.bottom <= icon.bottom;
      }), 'Recipe count should stay inside the icon rather than float above it');
    }
    if (screenshots) await page.locator('.type-row').screenshot({ path: `${screenshots}/${name}-ruler-desktop.png` });
    assert.match(await page.locator('.machine-tab small').first().evaluate(element => getComputedStyle(element).fontFamily), /Minecraft/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert(await chart.locator('.diagram-scroll').evaluate(element => element.scrollWidth > element.clientWidth));
    if (screenshots) await page.locator('.type-row').screenshot({ path: `${screenshots}/${name}-ruler-mobile.png` });
    if (screenshots) await page.screenshot({ path: `${screenshots}/${name}-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 1800 });
    console.log(`${name}: ${item}, ${scene.groups.length} item groups, ${scene.paths.length} native segments`);
  }
  const chart = page.locator('.native-ore-diagram').first();
  const ingredient = chart.locator('.diagram-item:not(.diagram-machine)').first();
  const itemId = await ingredient.getAttribute('data-goods-id');
  await ingredient.click();
  await page.waitForURL(url => url.searchParams.get('item') === itemId && url.searchParams.get('view') === 'recipes');
  await page.goto(lastUrl);
  await page.locator('.native-ore-diagram').first().waitFor({ timeout: 120000 });
  const itemTotals = await page.locator('.view-tabs').innerText();
  await page.locator('.special-mark').first().click();
  await page.locator('.recipe-pagination').waitFor();
  assert.equal(await page.locator('.native-ore-diagram').count(), 1, 'Mount one complete diagram at a time');
  assert.match(await page.locator('.recipe-pagination').innerText(), /of 331/);
  const firstRecord = await page.locator('.special-card').getAttribute('data-record-id');
  await page.locator('.recipe-pagination').getByRole('button', { name: 'Next', exact: true }).click();
  assert.notEqual(await page.locator('.special-card').getAttribute('data-record-id'), firstRecord);
  assert.equal(await page.locator('.view-tabs').innerText(), itemTotals);
  await page.setViewportSize({ width: 1920, height: 1100 });
  await page.waitForFunction(() => document.querySelectorAll('.native-ore-diagram').length === 2);
  assert(await page.locator('.diagram-scroll').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth)), 'Two diagrams must fit at native size without horizontal scrolling');
  const twoCards = await page.locator('.special-card').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top };
  }));
  assert(Math.abs(twoCards[0].top - twoCards[1].top) < 1 && twoCards[0].right <= twoCards[1].left);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelectorAll('.native-ore-diagram').length === 1);
  await page.setViewportSize({ width: 1440, height: 1800 });
  await page.locator('.special-mark').first().click();
  await page.locator('.native-ore-diagram').first().waitFor();
  const pendingDownload = page.waitForEvent('download');
  await page.locator('.export-actions > button').first().click();
  const download = await pendingDownload;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert(exported.records.some(record => record.payload.nativeScene?.paths.length > 0));
  await page.waitForLoadState('networkidle');
  await context.setOffline(true);
  await page.reload();
  await page.locator('.native-ore-diagram').first().waitFor({ timeout: 120000 });
  await context.setOffline(false);
  const specialOnly = new URL(base);
  specialOnly.searchParams.set('item', 'i:gregtech:gt.blockores2:86');
  specialOnly.searchParams.set('view', 'recipes');
  await page.goto(specialOnly.href);
  await page.locator('.special-card').first().waitFor({ timeout: 120000 });
  assert.equal(await page.locator('.no-recipes').count(), 0);
  const firstSpecial = page.locator('.special-tab').first();
  assert(await firstSpecial.evaluate(element => element.classList.contains('active')), 'Special-only items default to the first available special tab');
  await page.locator('.view-tabs').getByRole('button', { name: /^Usages/ }).click();
  await page.waitForURL(url => url.searchParams.get('view') === 'usages');
  await page.locator('.recipe-list article.card').first().waitFor();
  assert.equal(await page.locator('.special-tab.active').count(), 0, 'Ordinary recipes keep their normal default');
  await page.locator('.view-tabs').getByRole('button', { name: /^Recipes/ }).click();
  await page.waitForURL(url => url.searchParams.get('view') === 'recipes' && Boolean(url.searchParams.get('special')));
  await page.locator('.special-card').first().waitFor();
  assert(await firstSpecial.evaluate(element => element.classList.contains('active')), 'Switching back to Recipes selects its first special tab');
  await page.locator('.view-tabs').getByRole('button', { name: /^Recipes/ }).click();
  await page.waitForURL(url => Boolean(url.searchParams.get('special')));
  await page.locator('.special-card').first().waitFor();
  assert(await firstSpecial.evaluate(element => element.classList.contains('active')), 'Clicking the current Recipes direction keeps its special default');
  await page.locator('.pane-toolbar input').fill('no-such-recipe-348726');
  await page.locator('.no-recipes').waitFor();
  assert.equal(await page.locator('.no-recipes > span').count(), 0, 'Empty state must not use a decorative glyph');
  assert.deepEqual(errors, []);
  console.log('Native routes, geometry, icons, tooltips, clean ruler labels, special-only defaults, empty state, mobile layout, navigation, pagination, exports and offline rendering passed.');
} finally { await browser.close(); }
