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
    mobileLayout: true, staleClear: true, normalBrowseGraphReads: 0, errors }));
  await context.close();
} finally { await browser.close(); }
