import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
/* global document, getComputedStyle, innerWidth, innerHeight */
const [base, playwrightModule, screenshots] = process.argv.slice(2);
if (!playwrightModule) throw new Error('Usage: node tools/test-touch-items.mjs <app-url> <playwright-module> [screenshots]');
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch();
if (screenshots) await mkdir(screenshots, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  const preview = page.locator('.touch-tooltip');
  const actionDialog = page.locator('.item-action-dialog');
  const route = async (params = {}) => {
    const url = new URL(base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    await page.goto(url.href);
  };
  const closePreview = async () => { await page.keyboard.press('Escape'); await preview.waitFor({ state: 'hidden' }); };
  const hold = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await route();
  await page.locator('.sequence a').first().waitFor({ timeout: 120000 });
  const families = await page.locator('.sequence:not([aria-hidden]) a').evaluateAll(nodes => nodes.map(node => node.dataset.family));
  assert.equal(new Set(families).size, families.length, 'Each family occupies one logical slot');
  assert(families.length <= 80);
  const seenSheets = new Set(await page.locator('.sequence a').evaluateAll(nodes => nodes.map(node => node.dataset.sheet)));
  assert(!seenSheets.has(undefined), 'Every carousel slot exposes its actual base sheet');
  assert(seenSheets.size <= 6, 'Initial carousel uses at most six base sprite sheets');
  const firstMix = [...families];
  const visibleLink = async () => {
    const index = await page.locator('.sequence a').evaluateAll(nodes => nodes.findIndex(node => {
      const rect = node.getBoundingClientRect(); return rect.left >= 12 && rect.right <= innerWidth - 12 && rect.bottom <= innerHeight;
    }));
    assert(index >= 0, 'A carousel item is visible');
    return page.locator('.sequence a').nth(index);
  };
  const tile = await visibleLink();
  const box = await tile.boundingBox();
  const initialUrl = page.url();
  await page.touchscreen.tap(box.x + 32, box.y + 32);
  await preview.locator('.minecraft-tooltip:not(.tooltip-skeleton)').waitFor();
  assert.equal(page.url(), initialUrl, 'First tap must not navigate');
  assert.equal(await page.locator('.touch-inspecting .track').evaluate(node => getComputedStyle(node).animationPlayState), 'paused');
  const frozenId = await tile.getAttribute('data-item');
  await page.waitForTimeout(1400);
  assert.equal(await tile.getAttribute('data-item'), frozenId);
  for (const sheet of await page.locator('.sequence a').evaluateAll(nodes => nodes.map(node => node.dataset.sheet))) seenSheets.add(sheet);
  assert(seenSheets.size <= 6, 'Cycling stays within the chosen sheet mix');
  const popup = await preview.boundingBox();
  assert(popup.x >= 0 && popup.y >= 0 && popup.x + popup.width <= 391 && popup.y + popup.height <= 845);
  if (screenshots) await page.screenshot({ path: `${screenshots}/touch-landing-mobile.png` });
  await closePreview();
  // Reload changes the stable mix rather than replacing it under the user's finger.
  await page.reload(); await page.locator('.sequence a').first().waitFor();
  assert.notDeepEqual(await page.locator('.sequence:not([aria-hidden]) a').evaluateAll(nodes => nodes.map(node => node.dataset.family)), firstMix);

  const item = 'i:gregtech:gt.blockmachines:262';
  await route({ item });
  const slot = page.locator('.ingredient').first();
  await slot.waitFor({ timeout: 120000 });
  await slot.tap(); await preview.locator('.minecraft-tooltip:not(.tooltip-skeleton)').waitFor();
  const frozenLabel = await slot.getAttribute('aria-label');
  await page.waitForTimeout(1400);
  assert.equal(await slot.getAttribute('aria-label'), frozenLabel, 'Recipe alternatives freeze while inspecting');
  const secondTap = await slot.boundingBox();
  await page.touchscreen.tap(secondTap.x + secondTap.width / 2, secondTap.y + secondTap.height / 2);
  await page.locator('.ore-choice').waitFor();
  assert.equal(await preview.count(), 0);
  await page.locator('.ore-choice').getByRole('button', { name: 'Close', exact: true }).click();
  await hold(slot);
  await page.locator('.ore-choice').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('item'), item, 'Hold must not navigate or leak a click');
  await page.locator('.ore-choice').getByRole('button', { name: 'Close', exact: true }).click();

  const single = page.locator('.ingredient').filter({ hasNot: page.locator('.ore-count') }).first();
  await hold(single); await actionDialog.waitFor();
  if (screenshots) await page.screenshot({ path: `${screenshots}/touch-actions-mobile.png` });
  await actionDialog.getByRole('button', { name: 'Usages', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('view') === 'usages');
  await route({ item }); await slot.waitFor({ timeout: 120000 });
  // Deterministic cancellation cases complement the native touch gestures above.
  for (const cancellation of ['move', 'cancel', 'multitouch']) {
    await slot.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 41, isPrimary: true, clientX: 100, clientY: 200 });
    if (cancellation === 'move') await slot.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 41, clientX: 112, clientY: 200 });
    if (cancellation === 'cancel') await slot.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 41 });
    if (cancellation === 'multitouch') await slot.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 42, isPrimary: false });
    await page.waitForTimeout(550);
    await slot.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 41 });
    await slot.dispatchEvent('click', { detail: 1 });
    await slot.dispatchEvent('contextmenu', { detail: 1 });
    assert.equal(await preview.count(), 0, `${cancellation}: no preview`);
    assert.equal(await page.locator('.ore-choice, .item-action-dialog').count(), 0, `${cancellation}: no menu`);
    assert.equal(new URL(page.url()).searchParams.get('item'), item);
  }
  await slot.tap(); await preview.waitFor();
  await page.locator('.item-head').tap(); await preview.waitFor({ state: 'hidden' });
  await slot.tap(); await preview.waitFor();
  await preview.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 77, isPrimary: true });
  await preview.dispatchEvent('pointercancel', { pointerType: 'touch', pointerId: 77 });
  await preview.evaluate(node => node.dispatchEvent(new Event('scroll')));
  assert.equal(await preview.count(), 1, 'Scrolling item info keeps it open');
  await page.evaluate(() => document.querySelector('.detail').dispatchEvent(new Event('scroll')));
  await preview.waitFor({ state: 'hidden' });

  await route({ page: 'items', search: 'Wrench' });
  const family = page.locator('.item-tile').filter({ hasText: /exact variants/ }).first();
  await family.waitFor({ timeout: 120000 });
  await hold(family); await page.locator('.variant-picker').waitFor();
  await page.locator('.variant-row').first().click(); await actionDialog.waitFor();
  await actionDialog.getByRole('button', { name: 'Close item actions' }).click();
  assert.equal(await preview.count(), 0);

  await route({ item: 'i:cropsnh:genericSeed:0:4d096604a46bf1a05b02bcf08e9550d6d33e630e', special: 'mutation-pool' });
  const special = page.locator('.special-good').first();
  await special.waitFor({ timeout: 120000 });
  const specialUrl = page.url();
  await special.tap(); await preview.locator('.minecraft-tooltip:not(.tooltip-skeleton)').waitFor();
  assert.equal(page.url(), specialUrl);
  await closePreview();
  await hold(special); await actionDialog.waitFor();
  await actionDialog.getByRole('button', { name: 'Close item actions' }).click();

  const registry = JSON.parse(await readFile('src/lib/generated/ore-diagrams.json', 'utf8'));
  const index = JSON.parse(gunzipSync(await readFile(`public/assets/sha256/${registry.releases['2.9.0-v7-rbd0b48ae8ad7'].sha256}`)));
  const data = JSON.parse(gunzipSync(await readFile(`public/assets/sha256/${index.scenes.sha256}`)));
  const scene = Object.values(data.scenes).find(scene => scene.slots.some(slot => slot.key === 'raw-ore'));
  const raw = scene.slots.find(slot => slot.key === 'raw-ore');
  const ore = scene.groups.find(group => group.pos[0] === raw.pos[0] && group.pos[1] === raw.pos[1]).components[0].id;
  await route({ item: ore, view: 'usages', special: 'gt-ore-processing' });
  const diagramItem = page.locator('.diagram-item:not(.diagram-machine)').first();
  await diagramItem.waitFor({ timeout: 120000 }); await diagramItem.tap(); await preview.waitFor();
  const diagramId = await diagramItem.getAttribute('data-goods-id');
  await page.waitForTimeout(1400);
  assert.equal(await diagramItem.getAttribute('data-goods-id'), diagramId);
  await closePreview();
  await hold(page.locator('.diagram-machine').first()); await actionDialog.waitFor();
  await actionDialog.getByRole('button', { name: 'Machine Usages', exact: true }).waitFor();
  await actionDialog.getByRole('button', { name: 'Close item actions' }).click();

  await route({ page: 'finder' });
  await page.getByRole('button', { name: '+ Add input', exact: true }).click();
  const pickerItem = page.locator('.finder-picker .item-tile').filter({ has: page.locator('.item-summary > small').filter({ hasText: /^item$/ }) }).first();
  await pickerItem.waitFor({ timeout: 120000 }); await pickerItem.tap();
  await page.locator('.ingredient-chip').waitFor();
  assert.equal(await preview.count(), 0, 'Finder controls keep single-tap selection');
  await page.locator('.ingredient-chip').tap();
  await page.locator('.ingredient-chip').waitFor({ state: 'hidden' });

  // A desktop mouse still performs the original one-click / right-click actions.
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const desktopPage = await desktop.newPage();
  desktopPage.on('pageerror', error => errors.push(error.message));
  await desktopPage.goto(new URL(`?item=${encodeURIComponent(item)}`, base).href);
  const desktopSlot = desktopPage.locator('.ingredient').filter({ hasNot: desktopPage.locator('.ore-count') }).first();
  await desktopSlot.waitFor({ timeout: 120000 }); await desktopSlot.hover();
  await desktopPage.locator('.floating-tooltip').waitFor();
  await desktopSlot.click({ button: 'right' });
  await desktopPage.waitForURL(url => url.searchParams.get('view') === 'usages');
  await desktopPage.goto(base); await desktopPage.locator('.sequence a').first().waitFor();
  await desktopPage.waitForFunction(() => [...document.querySelectorAll('.sequence a')].every(node => node.querySelector('.atlas-sprite')));
  if (screenshots) await desktopPage.screenshot({ path: `${screenshots}/landing-desktop.png` });
  assert.deepEqual(errors, []);
  console.log('Native touch previews, frozen alternatives, second taps, holds, actions, group pickers, cancellation, dismissal, mobile fit, six-sheet cycling, special goods, ore diagrams, finder selection and desktop controls passed.');
} finally { await browser.close(); }

