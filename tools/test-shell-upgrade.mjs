import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import assert from 'node:assert/strict';

// Optional browser harness: actual previous production shell/worker, no synthetic legacy app.
const [oldDirectory, newDirectory, playwrightModule, workerOnly] = process.argv.slice(2);
if (!playwrightModule) throw new Error('Usage: node tools/test-shell-upgrade.mjs <old-dist> <new-dist> <playwright-module>');
const { chromium } = await import(playwrightModule);
const oldRoot = resolve(oldDirectory);
const newRoot = resolve(newDirectory);
const newIndex = JSON.parse(await readFile(join(newRoot, 'versions-v7.json'), 'utf8'));
const targetDatasetId = newIndex.rollout?.targetDatasetId ?? newIndex.versions[0].datasetId;
const oldIndex = JSON.parse(await readFile(join(oldRoot, 'versions.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(oldRoot, oldIndex.versions[0].packManifestUrl), 'utf8'));
const stalledPaths = new Set(manifest.recordPages.filter((page) => page.family === 'bootstrap' || !page.family).slice(0, 1)
  .map((page) => new URL(page.url, `http://localhost/${oldIndex.versions[0].packManifestUrl}`).pathname));
let upgraded = false;
let stalled = 0;
const navigations = [];
const sockets = new Set();
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/sw.js' || url.pathname === '/sw-takeover.js' || url.pathname === '/versions-v7.json') console.log('Request', url.pathname, upgraded);
  if (!upgraded && stalledPaths.has(url.pathname)) { stalled++; return; }

  try {
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const path = resolve(upgraded ? newRoot : oldRoot, `.${pathname}`);
    if (!path.startsWith(upgraded ? newRoot : oldRoot)) throw new Error('Invalid path');
    const data = await readFile(path);
    const types = { '.js': 'application/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css' };
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  } catch { response.writeHead(404); response.end(); }
});
server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const params = new URLSearchParams({ version: oldIndex.versions[0].datasetId, item: 'missing-item', search: 'steel', view: 'usages', special: 'gtOreVein', 'special-scope': 'all' });
  if (workerOnly === '--worker-only') {
    await context.addInitScript(() => {
      const original = navigator.serviceWorker.addEventListener.bind(navigator.serviceWorker);
      navigator.serviceWorker.addEventListener = (type, ...args) => {
        if (type !== 'controllerchange') original(type, ...args);
      };
    });
  }
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  for (const page of pages) {
    page.on('request', (request) => { if (request.isNavigationRequest()) navigations.push(new URL(request.url()).search); });
    page.on('pageerror', (error) => console.error(error.message));
    console.log('Opening previous shell');
    await page.goto(`${origin}?${params}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 20_000 });
    console.log('Previous worker controls tab');
  }
  await pages[0].waitForFunction(() => navigator.serviceWorker.controller !== null);
  assert(stalled > 0, 'Previous catalog must be stalled before updating');
  const before = navigations.length;
  upgraded = true;
  const start = Date.now();
  console.log('Starting update');
  await pages[0].evaluate(() => navigator.serviceWorker.getRegistration().then((registration) => registration.update()));
  console.log('Update discovered');
  for (const page of pages) {
    await page.waitForURL((url) => url.searchParams.get('version') === targetDatasetId, { timeout: 30_000, waitUntil: 'domcontentloaded' }).catch(async (error) => {
      console.error(JSON.stringify({ url: page.url(), body: await page.locator('body').innerText(), navigations, worker: await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => ({ active: r.active?.state, waiting: r.waiting?.state, installing: r.installing?.state }))) }));
      throw error;
    });
    await page.locator('.item-tile').first().waitFor({ timeout: 60_000 });
  }
  assert(navigations.slice(before).some((search) => search === `?${params}`), 'Worker navigation must preserve all original parameters');
  const settled = navigations.length;
  assert.equal(settled - before, pages.length, 'Each legacy tab must navigate exactly once');
  await pages[0].waitForTimeout(3_000);
  assert.equal(navigations.length, settled, 'No reload loop after takeover');
  await context.setOffline(true);
  await pages[0].reload({ waitUntil: 'domcontentloaded' });
  await pages[0].locator('.item-tile').first().waitFor({ timeout: 60_000 });
  console.log(JSON.stringify({ stalledCatalogRequests: stalled, tabs: pages.length, takeoverMs: Date.now() - start,
    navigationCount: settled - before, navigationUrls: navigations.slice(before, settled), offlineWarmReload: true }, null, 2));
} finally {
  await browser.close();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
}
