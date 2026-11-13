import assert from 'node:assert/strict';
/* global indexedDB */
const [appUrl, previousId, targetId, playwrightModule] = process.argv.slice(2);
if (!playwrightModule)
  throw new Error(
    'Usage: node tools/test-deferred-rollout.mjs <app-url> <previous-id> <target-id> <playwright-module>',
  );
const { chromium } = await import(playwrightModule);
const index = await fetch(new URL('versions-v7.json', appUrl)).then((response) => response.json());
assert.equal(index.rollout.targetDatasetId, targetId);
const manualVersion = index.versions.find(
  (version) => version.datasetId !== previousId && version.datasetId !== targetId,
);
assert(manualVersion);
const browser = await chromium.launch({ headless: true });
const epoch = async (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const opening = indexedDB.open('gtnh-recipe-browser');
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const read = db
            .transaction('metadata')
            .objectStore('metadata')
            .get('dataset-rollout-epoch');
          read.onsuccess = () => {
            db.close();
            resolve(read.result?.value);
          };
          read.onerror = () => reject(read.error);
        };
      }),
  );
async function returningClient() {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/versions-v7.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: 1, versions: index.versions }),
    }),
  );
  await page.goto(`${appUrl}?version=${previousId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.item-tile').first().waitFor({ timeout: 120_000 });
  await page.locator('.item-tile').first().click();
  await page.locator('.item-head').waitFor({ timeout: 60_000 });
  await page.evaluate(
    (value) =>
      new Promise((resolve, reject) => {
        const opening = indexedDB.open('gtnh-recipe-browser');
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const transaction = db.transaction('metadata', 'readwrite');
          transaction
            .objectStore('metadata')
            .put({ key: 'dataset-rollout-epoch', url: '', value, cachedAt: Date.now() });
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    index.rollout.epoch - 1,
  );
  await context.unroute('**/versions-v7.json');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await context.route('**/versions-v7.json', async (route) => {
    await gate;
    await route.continue();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.item-head').waitFor({ timeout: 60_000 });
  assert.equal(new URL(page.url()).searchParams.get('version'), previousId);
  return { context, page, errors, release };
}
try {
  // The target cannot load: preserve the usable cache and leave the epoch retryable.
  const failed = await returningClient();
  let attempted;
  const targetAttempt = new Promise((resolve) => {
    attempted = resolve;
  });
  await failed.context.route(`**/data/${targetId}/pack-manifest.json`, async (route) => {
    attempted();
    await route.fulfill({ status: 503, body: 'temporarily unavailable' });
  });
  failed.release();
  await Promise.race([
    targetAttempt,
    failed.page.waitForTimeout(60_000).then(() => {
      throw new Error('Automatic target load was never attempted');
    }),
  ]);
  await failed.page.locator('.app-state').waitFor({ state: 'hidden', timeout: 60_000 });
  await failed.page.locator('.item-head').waitFor({ timeout: 60_000 });
  assert.equal(new URL(failed.page.url()).searchParams.get('version'), previousId);
  assert.equal(await epoch(failed.page), index.rollout.epoch - 1);
  assert.deepEqual(failed.errors, []);
  console.log(
    JSON.stringify({ failedBootstrapKeepsOldDataset: true, epochRemainsRetryable: true }),
  );
  await failed.context.close();

  // A deliberate manager choice made before the policy arrives cancels the switch.
  const manual = await returningClient();
  await manual.page.locator('header .version').click();
  const row = manual.page
    .getByRole('dialog', { name: 'Dataset manager' })
    .locator('.dataset')
    .filter({ has: manual.page.getByText(manualVersion.gtnhVersion, { exact: true }) });
  await row.getByRole('button', { name: 'Switch', exact: true }).click();
  await manual.page.waitForURL(
    (url) => url.searchParams.get('version') === manualVersion.datasetId,
    { timeout: 120_000, waitUntil: 'domcontentloaded' },
  );
  await manual.page.locator('.item-head').waitFor({ timeout: 120_000 });
  manual.release();
  await assert.doesNotReject(async () => {
    const deadline = Date.now() + 60_000;
    while ((await epoch(manual.page)) !== index.rollout.epoch) {
      if (Date.now() > deadline) throw new Error('Manual choice was not acknowledged');
      await manual.page.waitForTimeout(100);
    }
  });
  assert.equal(new URL(manual.page.url()).searchParams.get('version'), manualVersion.datasetId);
  await manual.page.reload({ waitUntil: 'domcontentloaded' });
  await manual.page.locator('.item-head').waitFor({ timeout: 120_000 });
  await manual.page.waitForTimeout(1500);
  assert.equal(new URL(manual.page.url()).searchParams.get('version'), manualVersion.datasetId);
  assert.deepEqual(manual.errors, []);
  console.log(
    JSON.stringify({ manualChoiceCancelsPendingSwitch: true, manualChoiceSurvivesRefresh: true }),
  );
  await manual.context.close();
} finally {
  await browser.close();
}
