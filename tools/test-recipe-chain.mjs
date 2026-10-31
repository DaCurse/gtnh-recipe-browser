import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
/* global document, location, history, dispatchEvent, PopStateEvent, innerWidth */
const [appUrl, playwrightModule, screenshotDirectory] = process.argv.slice(2);
if (!playwrightModule) throw new Error('Usage: node tools/test-recipe-chain.mjs <app-url> <playwright-module> [screenshots]');
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch({ headless: true });
const molten = 'f:gregtech:molten.iron', dust = 'i:gregtech:gt.metaitem.01:2032';
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(); const errors = []; const graphReads = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (request.url().includes('/assets/recipe-chains/')) graphReads.push(request.url()); });
  const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.item-tile').first().waitFor({ timeout: 120000 });
  assert.equal(graphReads.length, 0, 'Normal browsing must not load the global graph');
  await page.getByRole('link', { name: 'Recipe finder', exact: true }).click();
  await page.getByRole('button', { name: 'Recipe chain', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.get('finder-mode'), 'chain');
  assert.equal(graphReads.length, 0, 'An empty chain must not load the graph');
  await page.evaluate(({ molten, dust }) => {
    const url = new URL(location.href); url.searchParams.append('input', molten); url.searchParams.append('output', dust);
    history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate'));
  }, { molten, dust });
  const finish = () => page.waitForFunction(() => !document.querySelector('.chain-status'), undefined, { timeout: 120000 });
  await page.locator('.chain-status').waitFor({ timeout: 120000 }); await finish();
  assert.equal(await page.locator('.chain-error').count(), 0);
  assert.equal(await page.locator('.chain-steps > li').count(), 2);
  assert.match(await page.locator('.chain-step-heading').allTextContents().then((v) => v.join(' ')), /Fluid Solidifier.*Macerator/);
  assert.match(await page.locator('.chain-extras').innerText(), /Mold.*tool \/ catalyst/);
  assert.equal(graphReads.length, 1);
  console.log(JSON.stringify({ phase: 'route-ready' }));
  const link = page.url();
  const alternatives = page.getByRole('navigation', { name: 'Alternative routes to Iron Dust', exact: true });
  assert.match(await alternatives.innerText(), /[2-9][0-9]* verified routes found|10 verified routes found/);
  const firstRouteCount = Number((await alternatives.innerText()).match(/(\d+) verified routes/)?.[1]);
  await alternatives.getByRole('button', { name: 'Next route', exact: true }).click();
  await alternatives.getByText(`Route 2 of ${firstRouteCount}`, { exact: true }).waitFor({ timeout: 120000 });
  assert.equal(await page.locator('.chain-steps > li').count(), 2);
  await alternatives.getByRole('button', { name: 'Previous route', exact: true }).click();
  await alternatives.getByText(`Route 1 of ${firstRouteCount}`, { exact: true }).waitFor();
  assert.equal(graphReads.length, 1);
  await page.setViewportSize({ width: 1100, height: 900 });
  const scroller = page.locator('.chain-scroll');
  assert.equal(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth), true);
  const boxes = await page.locator('.chain-steps > li').evaluateAll((items) => items.map((el) => { const box = el.getBoundingClientRect(); return { x: box.x, y: box.y }; }));
  assert(boxes[1].x > boxes[0].x && Math.abs(boxes[1].y - boxes[0].y) < 1);
  await scroller.evaluate((el) => { el.scrollLeft = 400; });
  assert((await scroller.evaluate((el) => el.scrollLeft)) > 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (screenshotDirectory) { await mkdir(screenshotDirectory, { recursive: true }); await page.screenshot({ path: `${screenshotDirectory}/chain-desktop.png` }); }
  await page.getByRole('checkbox', { name: 'Allow additional ingredients' }).uncheck(); await finish();
  assert.equal(await page.locator('.chain-steps > li').count(), 0);
  assert.match(await page.locator('.chain-empty').innerText(), /No route found/);
  await page.getByRole('checkbox', { name: 'Allow additional ingredients' }).check(); await finish();
  assert.equal(await page.locator('.chain-steps > li').count(), 2);
  assert.equal(graphReads.length, 1, 'Options must reuse the worker graph');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (screenshotDirectory) await page.screenshot({ path: `${screenshotDirectory}/chain-mobile.png` });
  const mobileBoxes = await page.locator('.chain-steps > li').evaluateAll((items) => items.map((el) => { const box = el.getBoundingClientRect(); return { x: box.x, y: box.y }; }));
  assert(mobileBoxes[1].y > mobileBoxes[0].y);
  // Cache refresh must restore the graph without another immutable download.
  await page.reload(); await page.locator('.chain-view').waitFor({ timeout: 120000 }); await finish();
  assert.equal(page.url(), link); assert.equal(await page.locator('.chain-steps > li').count(), 2);
  assert.equal(graphReads.length, 1);
  console.log(JSON.stringify({ phase: 'cache-ready' }));
  // Add the real missing tool and require every ingredient kind.
  await page.getByRole('button', { name: '+ Add input', exact: true }).click();
  const picker = page.locator('dialog.finder-picker');
  await picker.getByRole('textbox', { name: 'Search catalog', exact: true }).fill('Mold (Ingot)');
  await picker.getByRole('button', { name: 'Mold (Ingot)', exact: true }).first().waitFor({ timeout: 120000 });
  await picker.getByRole('button', { name: 'Mold (Ingot)', exact: true }).first().click();
  await picker.waitFor({ state: 'detached' }); await finish();
  await page.getByRole('checkbox', { name: 'Allow additional ingredients' }).uncheck(); await finish();
  assert.equal(await page.locator('.chain-steps > li').count(), 2);
  assert.equal(await page.locator('.chain-extras').count(), 0);
  await page.getByRole('combobox', { name: 'Maximum chain depth' }).selectOption('6'); await finish();
  assert.equal(await page.locator('.chain-steps > li').count(), 2);
  // The reported Pu241 -> borrowed tungsten recovery -> Pu239 route must never reappear.
  await page.getByRole('checkbox', { name: 'Allow additional ingredients' }).check();
  await page.evaluate(() => {
    const url = new URL(location.href); url.searchParams.delete('input'); url.searchParams.delete('output');
    url.searchParams.set('input', 'i:gregtech:gt.metaitem.01:2101');
    url.searchParams.set('output', 'i:gregtech:gt.metaitem.01:2100');
    history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate'));
  });
  await finish();
  assert.equal(await page.locator('.chain-steps > li').count(), 0);
  assert.match(await page.locator('.chain-empty').innerText(), /exploration limit|No route found/);
  // Oil must follow a real refining procedure, not a recovered container filled with borrowed diesel.
  await page.getByRole('combobox', { name: 'Maximum chain depth' }).selectOption('12'); await finish();
  await page.evaluate(() => {
    const url = new URL(location.href); url.searchParams.set('input', 'f:BuildCraft|Energy:oil');
    url.searchParams.set('output', 'f:gregtech:nitrofuel');
    history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate'));
  });
  await finish();
  assert((await page.locator('.chain-steps > li').count()) >= 3);
  assert.match(await page.locator('.chain-step-heading').first().innerText(), /Distillation/);
  assert.doesNotMatch(await page.locator('.chain-extras').allTextContents().then((items) => items.join(' ')), /Diesel/);
  assert.doesNotMatch(await page.locator('.chain-step-heading').allTextContents().then((items) => items.join(' ')), /Canner/);
  const oilChoices = page.getByRole('navigation', { name: 'Alternative routes to Cetane-Boosted Diesel', exact: true });
  const routeCount = async () => Number((await oilChoices.innerText()).match(/(\d+) verified routes/)?.[1]);
  const beforeMore = await routeCount(); const beforeSteps = await page.locator('.chain-steps > li').count();
  await oilChoices.getByRole('button', { name: 'Search more routes', exact: true }).click();
  await page.getByRole('button', { name: 'Stop searching', exact: true }).waitFor();
  assert.equal(await page.locator('.chain-steps > li').count(), beforeSteps, 'More search must keep existing results visible');
  await page.getByRole('button', { name: 'Stop searching', exact: true }).click();
  await finish(); assert.equal(await routeCount(), beforeMore);
  await oilChoices.getByRole('button', { name: 'Next route', exact: true }).click();
  await oilChoices.getByText(`Route 2 of ${beforeMore}`, { exact: true }).waitFor({ timeout: 120000 });
  await oilChoices.getByRole('button', { name: 'Search more routes', exact: true }).click();
  await finish();
  const afterMore = await routeCount();
  assert(afterMore > beforeMore, 'Broader oil search must reveal additional routes');
  await oilChoices.getByText(`Route 2 of ${afterMore}`, { exact: true }).waitFor();
  assert.equal(graphReads.length, 1, 'Expanded search must reuse the loaded graph');
  assert.match(await page.locator('.search-coverage').innerText(), /not a total count/);
  if (screenshotDirectory) await page.screenshot({ path: `${screenshotDirectory}/expanded-oil-routes-mobile.png` });
  // Changing modes and clearing must suppress stale worker and detail responses.
  await page.getByRole('button', { name: 'Single recipe', exact: true }).click();
  assert.equal(await page.locator('.chain-view').count(), 0);
  await page.getByRole('button', { name: 'Recipe chain', exact: true }).click();
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('.chain-view').count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ realItemFluidConversion: true, steps: 2, missingToolVisible: true, strictWithTool: true,
    strictWithoutToolRejected: true, workerGraphReuse: true, cachedGraphRefresh: true, shareableMode: true,
    mobileLayout: true, horizontalDesktopScroller: true, selectableAlternatives: true, borrowedTungstenRejected: true, realOilRefinery: true, initialOilRoutes: beforeMore, expandedOilRoutes: afterMore, cancellableExpansion: true, retainedSelectedRoute: true, borrowedDieselContainerDetourRejected: true, staleClear: true, normalBrowseGraphReads: 0, errors }));
  await context.close();
} finally { await browser.close(); }
