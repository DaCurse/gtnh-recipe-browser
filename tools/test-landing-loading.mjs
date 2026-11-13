import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
/* global document, getComputedStyle, innerWidth */
const [base, playwrightModule, screenshots] = process.argv.slice(2);
if (!playwrightModule)
  throw new Error(
    'Usage: node tools/test-landing-loading.mjs <app-url> <playwright-module> [screenshots]',
  );
const { chromium } = await import(playwrightModule);
const versionsUrl = new URL('versions-v7.json', base);
const versions = await fetch(versionsUrl).then((response) => response.json());
const version =
  versions.versions.find((value) => value.datasetId === versions.rollout?.targetDatasetId) ??
  versions.versions[0];
const manifest = await fetch(new URL(version.packManifestUrl, versionsUrl)).then((response) =>
  response.json(),
);
const bootstrapHashes = new Set(
  manifest.recordPages.filter((page) => page.family === 'bootstrap').map((page) => page.sha256),
);
assert(bootstrapHashes.size > 1, 'The release has multiple bootstrap pages to gate');
const browser = await chromium.launch();
if (screenshots) await mkdir(screenshots, { recursive: true });
let release;
const gate = new Promise((resolve) => (release = resolve));
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const errors = [],
    failed = [],
    requests = new Map();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => {
    if (bootstrapHashes.has(new URL(request.url()).pathname.split('/').at(-1)))
      failed.push(request.url());
  });
  await context.route('**/assets/sha256/*', async (route) => {
    const hash = new URL(route.request().url()).pathname.split('/').at(-1);
    if (bootstrapHashes.has(hash)) {
      requests.set(hash, (requests.get(hash) ?? 0) + 1);
      // Let one page finish on the landing page, keeping the rest in flight.
      if (requests.size > 1) await gate;
    }
    await route.continue();
  });
  await page.goto(base);
  const progress = page.getByRole('progressbar', { name: 'Item catalogue loading', exact: true });
  await page.waitForFunction(
    () => Number(document.querySelector('.landing-load-bar')?.getAttribute('aria-valuenow')) > 12,
    undefined,
    { timeout: 120000 },
  );
  await page.waitForTimeout(200);
  const originalProgress = Number(await progress.getAttribute('aria-valuenow'));
  assert(requests.size > 1, 'Network downloads start before opening the catalogue');
  assert.equal(await page.locator('.showcase-loading').count(), 1);
  assert.equal(await progress.evaluate((node) => getComputedStyle(node).height), '3px');
  assert.match(
    await page.locator('.landing-load').innerText(),
    /You can open the catalogue while this finishes/,
  );
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (screenshots) await page.screenshot({ path: `${screenshots}/landing-download-mobile.png` });

  await page.getByRole('link', { name: 'Open item catalogue', exact: true }).click();
  await page.locator('.app-state').waitFor();
  const catalogueProgress = Number(
    (await page.locator('.app-state .load-progress').getAttribute('aria-label')).match(/(\d+)%/)[1],
  );
  assert(catalogueProgress >= originalProgress, 'Opening the catalogue must not reset progress');
  assert(
    [...requests.values()].every((count) => count === 1),
    'Opening the catalogue does not restart physical downloads',
  );
  if (screenshots) await page.screenshot({ path: `${screenshots}/catalogue-download-mobile.png` });

  await page.getByRole('link', { name: /^(?:GTNH\s*)?RECIPE BROWSER$/i }).click();
  await progress.waitFor();
  assert(
    Number(await progress.getAttribute('aria-valuenow')) >= catalogueProgress,
    'Returning home shares the same progress',
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (screenshots) await page.screenshot({ path: `${screenshots}/landing-download-desktop.png` });
  await page.getByRole('link', { name: 'Open item catalogue', exact: true }).click();
  await page.locator('.app-state').waitFor();
  release();
  await page.locator('.item-tile').first().waitFor({ timeout: 120000 });
  assert.equal(await page.locator('.app-state').count(), 0);
  await page.getByRole('link', { name: /^(?:GTNH\s*)?RECIPE BROWSER$/i }).click();
  await page.locator('.sequence a').first().waitFor();
  assert.equal(
    await page.locator('.landing-load').count(),
    0,
    'The indicator disappears when the shared load completes',
  );
  assert(
    [...requests.values()].every((count) => count === 1),
    'Each bootstrap page was requested once across view changes',
  );
  assert.deepEqual(failed, [], 'View changes do not abort bootstrap requests');
  assert.deepEqual(errors, []);
  console.log(
    `Landing started downloading before navigation (${originalProgress}%). Catalogue/home switches retained progress; ${requests.size} bootstrap pages downloaded once with no aborts.`,
  );
} finally {
  release();
  await browser.close();
}
