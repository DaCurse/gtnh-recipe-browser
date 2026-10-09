import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
/* global window, document, IDBObjectStore, indexedDB */

// Keep browser automation optional; it is not an application dependency.
const [baseUrl, packDirectory, playwrightModule, cpuRate = '1'] = process.argv.slice(2);
if (!baseUrl || !packDirectory || !playwrightModule) {
  throw new Error('Usage: node tools/profile-incremental.mjs <dev-url> <pack-directory> <playwright-module> [cpu-rate]');
}
const { chromium } = await import(playwrightModule);
const manifest = JSON.parse(await readFile(join(packDirectory, 'pack-manifest.json'), 'utf8'));
const families = Object.fromEntries(manifest.recordPages.map((page) => [page.sha256, page.family]));
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true,
    hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: Number(cpuRate) });
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'warning' || message.type() === 'error') console.error(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__assetReads = [];
    window.__runtimeReads = [];
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      if (this.name === 'runtime-cache') window.__runtimeReads.push(key);
      if (this.name === 'assets') window.__assetReads.push(String(key));
      return original.call(this, key);
    };
  });
  await context.route('**/versions-v7.json', (route) => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ schemaVersion: 1, versions: [{ datasetId: manifest.datasetId,
      gtnhVersion: manifest.gtnhVersion, revision: manifest.revision, packManifestUrl: './profile-manifest.json' }] }) }));
  await context.route('**/profile-manifest.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) }));
  const requests = [];
  await context.route('**/assets/sha256/*', async (route) => {
    const hash = basename(new URL(route.request().url()).pathname);
    requests.push(hash);
    await route.fulfill({ body: await readFile(join(packDirectory, 'assets', 'sha256', hash)) });
  });
  const startup = async (warm) => {
    requests.length = 0;
    const start = performance.now();
    if (warm) await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    else await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    try {
      await page.locator('.item-tile').first().waitFor({ timeout: 120_000 });
    } catch (error) {
      throw new Error(`Catalog failed: ${await page.locator('body').innerText()}\n${error.message}`, { cause: error });
    }
    const milliseconds = Math.round(performance.now() - start);
    await page.locator('.mini-spinner').waitFor({ state: 'hidden', timeout: 120_000 });
    await page.waitForTimeout(1500);
    if (!warm && !process.env.PROFILE_BASELINE) {
      const deadline = performance.now() + 60_000;
      let saved = false;
      while (!saved && performance.now() < deadline) {
        saved = await page.evaluate(() => new Promise((resolve, reject) => {
        const opening = indexedDB.open('gtnh-recipe-browser');
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const request = db.transaction('runtime-cache').objectStore('runtime-cache').getAllKeys();
          request.onsuccess = () => { db.close(); resolve(request.result.some((key) => /^prepared-v5:[a-f0-9]{64}$/.test(String(key[1])))); };
          request.onerror = () => { db.close(); reject(request.error); };
        };
      }));
        if (!saved) await page.waitForTimeout(100);
      }
      if (!saved) throw new Error('Prepared catalog was not persisted');
    }
    const reads = await page.evaluate(() => window.__assetReads);
    const dataRequests = requests.filter((hash) => families[hash]);
    const bootstrapReads = reads.filter((hash) => families[hash] === 'bootstrap');
    const lazy = dataRequests.filter((hash) => families[hash] !== 'bootstrap');
    if (lazy.length) throw new Error('Startup fetched lazy pages: ' + lazy.join(', '));
    if (warm && requests.length && !process.env.PROFILE_BASELINE) throw new Error('Warm startup requested dataset assets');
    if (warm && bootstrapReads.length && !process.env.PROFILE_BASELINE) {
      throw new Error('Warm startup reread bootstrap pages: ' + JSON.stringify(await page.evaluate(() => window.__runtimeReads)));
    }
    return { milliseconds, networkAssetRequests: requests.length,
      networkRecordPages: dataRequests.length, bootstrapReads: bootstrapReads.length,
      runtimeCacheReads: await page.evaluate(() => window.__runtimeReads.length),
      domNodes: await page.locator('*').count(), heapBytes: await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null) };
  };
  const cold = await startup(false);
  console.error('Cold startup:', JSON.stringify(cold));
  const warm = await startup(true);
  console.error('Warm startup:', JSON.stringify(warm));
  requests.length = 0;
  await page.locator('.item-tile').filter({ has: page.locator('.item-summary > small').filter({ hasText: /^(item|fluid)$/ }) }).first().click();
  await page.waitForURL((url) => url.searchParams.has('item'), { timeout: 30_000 });
  await page.locator('.detail.mobile-visible').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => !document.body.innerText.includes('Loading item data…'), { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.recipe-loading'), undefined, { timeout: 120_000 });
  await page.waitForTimeout(1500);
  const selection = { assetRequests: requests.length, families: requests.map((hash) => families[hash] ?? 'icons') };
  const detailPages = selection.families.filter((family) => family === 'goods-details').length;
  if (detailPages > 4) throw new Error(`Unexpected detail lookup fan-out: ${detailPages}`);
  const linkedUrl = page.url();
  await page.goto(linkedUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.detail.mobile-visible').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => !document.body.innerText.includes('Loading item data…'));
  const alerts = await page.locator('[role="alert"]').allTextContents();
  if (alerts.length) throw new Error(alerts.join('\n'));
  if (errors.length) throw new Error(errors.join('\n'));
  const deepLinkRestored = new URL(page.url()).searchParams.get('item') === new URL(linkedUrl).searchParams.get('item');
  if (!deepLinkRestored) throw new Error('Selected item deep link was not restored');
  console.log(JSON.stringify({ datasetId: manifest.datasetId, viewport: '390x844', cpuRate: Number(cpuRate), cold, warm, selection,
    deepLinkRestored, errors }, null, 2));
  await context.close();
} finally {
  await browser.close();
}
