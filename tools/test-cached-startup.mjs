import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
/* global indexedDB, document, window, IDBObjectStore */

const [appUrl, playwrightModule] = process.argv.slice(2);
if (!playwrightModule) throw new Error('Usage: node tools/test-cached-startup.mjs <app-url> <playwright-module>');
const indexUrl = new URL('versions-v7.json', appUrl);
const index = await fetch(indexUrl).then((response) => response.json());
const version = index.versions.find((version) => version.datasetId === index.rollout?.targetDatasetId) ?? index.versions[0];
const manifest = await fetch(new URL(version.packManifestUrl, indexUrl)).then((response) => response.json());
const recordPageHashes = new Set(manifest.recordPages.map((page) => page.sha256));
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__assetReads = [];
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      if (this.name === 'assets') window.__assetReads.push(String(key));
      return get.call(this, key);
    };
  });
  const errors = [];
  const assets = [];
  page.on('pageerror', (error) => errors.push(error.message));
  context.on('request', (request) => {
    if (new URL(request.url()).pathname.includes('/assets/sha256/')) assets.push(request.url());
  });
  const session = await context.newCDPSession(page);
  const keys = () => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('gtnh-recipe-browser');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const reading = db.transaction('runtime-cache').objectStore('runtime-cache').getAllKeys();
      reading.onsuccess = () => { db.close(); resolve(reading.result.map((key) => key[1])); };
      reading.onerror = () => { db.close(); reject(reading.error); };
    };
  }));
  const waitForCache = async (predicate) => {
    const deadline = performance.now() + 60_000;
    while (performance.now() < deadline) {
      if ((await keys()).some(predicate)) return;
      await page.waitForTimeout(100);
    }
    throw new Error('Prepared cache did not finish');
  };
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.item-tile').first().waitFor({ timeout: 120_000 });
  await waitForCache((key) => /^prepared-v5:[a-f0-9]{64}$/.test(key));
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.waitForTimeout(500);
  assert(!(await keys()).some((key) => key.includes(':search')), 'Blank browsing must not prepare search data');

  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const reload = async () => {
    assets.length = 0;
    const start = performance.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.item-tile').first().waitFor({ timeout: 60_000 });
    const milliseconds = Math.round(performance.now() - start);
    await page.waitForTimeout(500);
    assert.equal(assets.length, 0, 'Cached browsing must not request dataset assets');
    return milliseconds;
  };
  const warmMilliseconds = await reload();

  const stalled = [];
  await context.route('**/versions-v7.json', (route) => { stalled.push(route); });
  const stalledNetworkMilliseconds = await reload();
  assert(stalled.length > 0, 'The version-index network request must really be stalled');
  await Promise.all(stalled.map((route) => route.abort().catch((error) => {
    if (!error.message.includes('already handled')) throw error;
  })));
  await context.unroute('**/versions-v7.json');

  // Block the actual network, including metadata revalidation and worker updates.
  await context.setOffline(true);
  const offlineMilliseconds = await reload();
  await context.setOffline(false);

  const search = page.locator('.search-wrap input');
  const startSearch = performance.now();
  await search.fill('iron ingot');
  await page.locator('.item-tile[aria-label="Iron Ingot"]').first().waitFor({ timeout: 60_000 });
  await page.locator('.mini-spinner').waitFor({ state: 'hidden', timeout: 60_000 });
  const firstSearchMilliseconds = Math.round(performance.now() - startSearch);
  await waitForCache((key) => /^prepared-v5:[a-f0-9]{64}:search$/.test(key));
  const searchNames = await page.locator('.item-tile').evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('aria-label')));
  const searchUrl = page.url();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.item-tile[aria-label="Iron Ingot"]').first().waitFor({ timeout: 60_000 });
  await page.locator('.mini-spinner').waitFor({ state: 'hidden', timeout: 60_000 });
  assert.equal(page.url(), searchUrl, 'Search bookmarks must survive refresh');
  assert.deepEqual(await page.locator('.item-tile').evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('aria-label'))), searchNames);
  await search.fill('enderios');
  await page.getByRole('button', { name: '"Enderios"', exact: true }).waitFor({ timeout: 60_000 });
  await page.locator('.mini-spinner').waitFor({ state: 'hidden', timeout: 60_000 });
  await search.fill('');
  await page.locator('.mini-spinner').waitFor({ state: 'hidden' });
  await page.locator('.item-tile').first().click();
  await page.locator('.detail.mobile-visible').waitFor();
  await page.waitForFunction(() => !document.querySelector('.recipe-loading') && !document.body.innerText.includes('Loading item data…'), undefined, { timeout: 60_000 });
  const itemUrl = page.url();
  await page.waitForTimeout(500);
  assets.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.detail.mobile-visible').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector('.recipe-loading') && !document.body.innerText.includes('Loading item data…'), undefined, { timeout: 60_000 });
  await page.waitForTimeout(500);
  assert.equal(page.url(), itemUrl);
  assert.equal(assets.length, 0, 'A cached item bookmark must not redownload lazy pages');
  const lazyPageReads = (await page.evaluate(() => window.__assetReads)).filter((hash) => recordPageHashes.has(hash));
  assert.equal(lazyPageReads.length, 0, 'Cached item hydration must use decoded shards without rereading compressed pages');
  assert.deepEqual(await page.locator('[role="alert"]').allTextContents(), []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ viewport: '390x844', cpuRate: 4, warmMilliseconds, stalledNetworkMilliseconds, offlineMilliseconds,
    firstSearchMilliseconds, savedSearchRestored: true, repeatedSearchAndClear: true, cachedItemRestored: true, cachedItemRecordPageReads: lazyPageReads.length, errors }, null, 2));
} finally {
  await browser.close();
}
