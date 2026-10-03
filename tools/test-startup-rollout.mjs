import assert from 'node:assert/strict';
/* global indexedDB */

const [appUrl, previousId, targetId, playwrightModule] = process.argv.slice(2);
if (!playwrightModule) throw new Error('Usage: node tools/test-startup-rollout.mjs <app-url> <previous-id> <target-id> <playwright-module>');
const { chromium } = await import(playwrightModule);
const index = await fetch(new URL('versions-v7.json', appUrl)).then((response) => response.json());
assert.equal(index.rollout?.targetDatasetId, targetId);
const previous = index.versions.find((version) => version.datasetId === previousId);
assert(previous, 'Previous selectable dataset must still be published');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/versions-v7.json', (route) => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ schemaVersion: 1, versions: [previous] }) }));
  await page.goto(`${appUrl}?version=${previousId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.item-tile').first().waitFor({ timeout: 120_000 });
  await page.evaluate((epoch) => new Promise((resolve, reject) => {
    const request = indexedDB.open('gtnh-recipe-browser');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('metadata', 'readwrite');
      transaction.objectStore('metadata').put({ key: 'dataset-rollout-epoch', url: '', value: epoch, cachedAt: Date.now() });
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }), index.rollout.epoch - 1);
  await page.locator('.item-tile').first().click();
  const itemId = new URL(page.url()).searchParams.get('item');
  assert(itemId);
  await context.unroute('**/versions-v7.json');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForURL((url) => url.searchParams.get('version') === targetId, { timeout: 120_000, waitUntil: 'domcontentloaded' });
  assert.equal(new URL(page.url()).searchParams.get('item'), itemId, 'Matching item must survive rollout');
  await page.locator('.item-head').waitFor({ timeout: 60_000 });
  const metadata = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('gtnh-recipe-browser');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('metadata').objectStore('metadata').get('dataset-rollout-epoch');
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => reject(read.error);
    };
  }));
  assert.equal(metadata.value, index.rollout.epoch);
  // A deliberate supported link then becomes the saved choice for later startup.
  await page.goto(`${appUrl}?version=${previousId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.item-tile').first().waitFor({ timeout: 120_000 });
  assert.equal(new URL(page.url()).searchParams.get('version'), previousId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.item-tile').first().waitFor({ timeout: 120_000 });
  assert.equal(new URL(page.url()).searchParams.get('version'), previousId);
  const managerSwitch = async (datasetId) => {
    const version = index.versions.find((candidate) => candidate.datasetId === datasetId);
    await page.locator('header .version').click();
    const row = page.getByRole('dialog', { name: 'Dataset manager' }).locator('.dataset')
      .filter({ has: page.locator('.dataset-title b', { hasText: version.gtnhVersion }) });
    await row.getByRole('button', { name: 'Switch', exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get('version') === datasetId,
      { timeout: 120_000, waitUntil: 'domcontentloaded' });
  };
  await managerSwitch(targetId);
  await managerSwitch(previousId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.item-tile').first().waitFor({ timeout: 120_000 });
  assert.equal(new URL(page.url()).searchParams.get('version'), previousId);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ appUrl, previousId, targetId, appliedEpoch: metadata.value,
    itemPreserved: itemId, manualChoicePreserved: true, managerChoicePreserved: true, errors }, null, 2));
} finally { await browser.close(); }
