import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const [appUrl, playwrightModule, screenshotDirectory] = process.argv.slice(2);
if (!playwrightModule) throw new Error('Usage: node tools/test-item-loading.mjs <app-url> <playwright-module> [screenshot-directory]');
const indexUrl = new URL('versions-v7.json', appUrl);
const index = await fetch(indexUrl).then((response) => response.json());
const version = index.versions.find((version) => version.datasetId === index.rollout?.targetDatasetId) ?? index.versions[0];
const manifest = await fetch(new URL(version.packManifestUrl, indexUrl)).then((response) => response.json());
const detailHashes = new Set(manifest.recordPages.filter((page) => page.family === 'goods-details').map((page) => page.sha256));
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch({ headless: true });
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block', isMobile: viewport.width < 500 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let release;
    const stalled = new Promise((resolve) => { release = resolve; });
    let requested;
    const detailRequested = new Promise((resolve) => { requested = resolve; });
    await context.route('**/assets/sha256/*', async (route) => {
      if (detailHashes.has(new URL(route.request().url()).pathname.split('/').at(-1))) {
        requested();
        await stalled;
      }
      await route.continue();
    });
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('.item-tile').first().waitFor({ timeout: 60_000 });
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.locator('.item-tile').first().click();
    await Promise.race([detailRequested, new Promise((_, reject) => setTimeout(() => reject(new Error('No detail request')), 15_000))]);
    await page.locator('.detail .view-tabs').waitFor();
    await page.locator('.detail .recipe-loading .load-progress.indeterminate').waitFor();
    assert.equal(await page.locator('.detail > p[role="status"]').count(), 0, 'No unstyled loading paragraph');
    assert.equal(await page.getByText('Loading item data…', { exact: true }).count(), 0);
    assert.equal(await page.locator('.detail .export-actions button').first().isDisabled(), true);
    await page.waitForTimeout(500);
    if (screenshotDirectory) await page.screenshot({ path: `${screenshotDirectory}/item-loading-${viewport.width}.png` });
    release();
    await page.locator('.recipe-loading').waitFor({ state: 'hidden', timeout: 60_000 });
    assert.equal(await page.locator('.detail .view-tabs').count(), 1);
    assert.deepEqual(await page.locator('[role="alert"]').allTextContents(), []);
    await page.locator('.detail .view-tabs button').filter({ hasText: 'Usages' }).first().click();
    await page.locator('.recipe-loading').waitFor({ state: 'hidden', timeout: 60_000 });
    const firstItemUrl = page.url();
    if (viewport.width < 500) await page.getByRole('button', { name: 'Back to items' }).click();
    await page.locator('.item-tile').nth(1).click();
    await page.locator('.recipe-loading').waitFor({ state: 'hidden', timeout: 60_000 });
    assert.notEqual(page.url(), firstItemUrl, 'The mounted pane must follow subsequent item selections');
    assert.deepEqual(await page.locator('[role="alert"]').allTextContents(), []);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ viewport, delayedDetailsKeepPaneVisible: true, noPlainLoadingText: true, viewSwitchWorks: true, subsequentItemWorks: true, errors }));
    await context.close();
  }
} finally {
  await browser.close();
}
