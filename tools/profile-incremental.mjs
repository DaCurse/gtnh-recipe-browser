import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
/* global window, document, IDBObjectStore */

// Keep browser automation optional; it is not an application dependency.
const [baseUrl, packDirectory, playwrightModule] = process.argv.slice(2);
if (!baseUrl || !packDirectory || !playwrightModule) {
  throw new Error('Usage: node tools/profile-incremental.mjs <dev-url> <pack-directory> <playwright-module>');
}
const { chromium } = await import(playwrightModule);
const manifest = JSON.parse(await readFile(join(packDirectory, 'pack-manifest.json'), 'utf8'));
const families = Object.fromEntries(manifest.recordPages.map((page) => [page.sha256, page.family]));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true,
    hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__assetReads = [];
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
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
    await page.waitForTimeout(500);
    const reads = await page.evaluate(() => window.__assetReads);
    const dataRequests = requests.filter((hash) => families[hash]);
    const bootstrapReads = reads.filter((hash) => families[hash] === 'bootstrap');
    const lazy = dataRequests.filter((hash) => families[hash] !== 'bootstrap');
    if (lazy.length) throw new Error('Startup fetched lazy pages: ' + lazy.join(', '));
    if (warm && requests.length) throw new Error('Warm startup requested dataset assets');
    if (warm && bootstrapReads.length > manifest.recordPages.filter((page) => page.family === 'bootstrap').length) {
      throw new Error('Warm startup reread bootstrap pages');
    }
    return { milliseconds: Math.round(performance.now() - start), networkAssetRequests: requests.length,
      networkRecordPages: dataRequests.length, bootstrapReads: bootstrapReads.length,
      domNodes: await page.locator('*').count(), heapBytes: await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null) };
  };
  const cold = await startup(false);
  const warm = await startup(true);
  requests.length = 0;
  await page.locator('.item-tile').first().click();
  await page.waitForFunction(() => !document.body.innerText.includes('Loading item data…'), { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const selection = { assetRequests: requests.length, families: requests.map((hash) => families[hash] ?? 'icons') };
  const detailPages = selection.families.filter((family) => family === 'goods-details').length;
  if (detailPages < 1 || detailPages > 4) throw new Error(`Unexpected detail lookup fan-out: ${detailPages}`);
  const linkedUrl = page.url();
  await page.goto(linkedUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.item-head').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => !document.body.innerText.includes('Loading item data…'));
  const alerts = await page.locator('[role="alert"]').allTextContents();
  if (alerts.length) throw new Error(alerts.join('\n'));
  if (errors.length) throw new Error(errors.join('\n'));
  const deepLinkRestored = new URL(page.url()).searchParams.get('item') === new URL(linkedUrl).searchParams.get('item');
  if (!deepLinkRestored) throw new Error('Selected item deep link was not restored');
  console.log(JSON.stringify({ datasetId: manifest.datasetId, viewport: '390x844', cold, warm, selection,
    deepLinkRestored, errors }, null, 2));
  await context.close();
} finally {
  await browser.close();
}
