import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
/* global document, getComputedStyle, innerWidth */
const [base, playwrightModule, screenshots] = process.argv.slice(2);
if (!playwrightModule)
  throw new Error(
    'Usage: node tools/test-touch-refinements.mjs <app-url> <playwright-module> [screenshots]',
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
const hashes = (family) =>
  new Set(manifest.recordPages.filter((page) => page.family === family).map((page) => page.sha256));
const bootstrapHashes = hashes('bootstrap'),
  detailHashes = hashes('goods-details');
const browser = await chromium.launch();
if (screenshots) await mkdir(screenshots, { recursive: true });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const indexGate = deferred(),
    bootstrapGate = deferred(),
    detailGate = deferred(),
    iconGate = deferred(),
    bootstrapStarted = deferred();
  let delayDetails = true;
  let delayIcons = true;
  await context.route('**/versions-v7.json', async (route) => {
    await indexGate.promise;
    await route.continue();
  });
  await context.route('**/assets/sha256/*', async (route) => {
    const hash = new URL(route.request().url()).pathname.split('/').at(-1);
    if (bootstrapHashes.has(hash)) {
      bootstrapStarted.resolve();
      await bootstrapGate.promise;
    }
    if (delayDetails && detailHashes.has(hash)) await detailGate.promise;
    if (delayIcons && !bootstrapHashes.has(hash) && !detailHashes.has(hash)) await iconGate.promise;
    await route.continue();
  });
  await page.goto(base);
  await page.locator('.showcase-loading').waitFor();
  assert.equal(await page.locator('.showcase-loading .icon-skeleton').count(), 160);
  const skeletonStyle = await page
    .locator('.icon-skeleton>span')
    .first()
    .evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        width: style.width,
        height: style.height,
        border: style.border,
        background: style.backgroundImage,
      };
    });
  assert.equal(await page.locator('.showcase a').count(), 0, 'Loading slots are inert');
  assert.equal(await page.locator('.showcase').getAttribute('aria-busy'), 'true');
  if (screenshots) await page.screenshot({ path: `${screenshots}/cold-start-mobile.png` });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await page
      .locator('.icon-skeleton>span')
      .first()
      .evaluate((node) => getComputedStyle(node).animationName),
    'none',
  );
  indexGate.resolve();
  await bootstrapStarted.promise;
  assert.equal(
    await page.locator('.showcase-loading').count(),
    1,
    'Placeholders persist through bootstrap download',
  );
  bootstrapGate.resolve();
  await page.locator('.sequence a').first().waitFor({ timeout: 120000 });
  await page.locator('.showcase-loading').waitFor({ state: 'hidden' });
  assert.equal(
    await page.locator('.sequence a .icon-skeleton').count(),
    160,
    'The same skeleton covers pending sprite downloads',
  );
  assert.equal(
    await page.locator('.sequence a .sprite').count(),
    0,
    'Pending images never show the old glyph placeholder',
  );
  assert.deepEqual(
    await page
      .locator('.sequence a .icon-skeleton>span')
      .first()
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          width: style.width,
          height: style.height,
          border: style.border,
          background: style.backgroundImage,
        };
      }),
    skeletonStyle,
    'Catalogue and image loading use identical skeleton styling',
  );
  if (screenshots) await page.screenshot({ path: `${screenshots}/pending-icons-mobile.png` });
  delayIcons = false;
  iconGate.resolve();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.sequence a')].every((node) =>
        node.querySelector('.atlas-sprite'),
      ),
    undefined,
    { timeout: 120000 },
  );
  const linkIndex = await page.locator('.sequence a').evaluateAll((nodes) =>
    nodes.findIndex((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left >= 12 && rect.right <= innerWidth - 12;
    }),
  );
  const tile = page.locator('.sequence a').nth(linkIndex);
  const box = await tile.boundingBox();
  await page.touchscreen.tap(box.x + 32, box.y + 32);
  const preview = page.locator('.touch-tooltip');
  await preview.locator('.tooltip-skeleton').waitFor();
  assert.equal((await preview.innerText()).trim(), '', 'Loading tooltip has no visible text');
  if (screenshots) await page.screenshot({ path: `${screenshots}/tooltip-skeleton-mobile.png` });
  detailGate.resolve();
  delayDetails = false;
  await preview.locator('.minecraft-tooltip:not(.tooltip-skeleton)').waitFor({ timeout: 120000 });
  assert.match(await preview.innerText(), /Tap item again to open/);
  assert.match(await preview.innerText(), /Hold for actions/);
  assert.equal(
    await preview.locator('.tooltip-action').evaluate((node) => getComputedStyle(node).fontSize),
    '12px',
  );
  await page.keyboard.press('Escape');

  const itemUrl = new URL(base);
  itemUrl.searchParams.set('item', 'i:gregtech:gt.blockmachines:262');
  await page.goto(itemUrl.href);
  const slot = page.locator('.ingredient').first();
  await slot.waitFor({ timeout: 120000 });
  await slot.tap();
  await preview.locator('.minecraft-tooltip:not(.tooltip-skeleton)').waitFor();
  const second = await slot.boundingBox();
  await page.touchscreen.tap(second.x + 24, second.y + 24);
  await page.locator('.ore-choice').waitFor();
  await page.locator('.ore-choice').getByRole('button', { name: 'Close', exact: true }).click();
  await slot.tap();
  await preview.locator('.minecraft-tooltip:not(.tooltip-skeleton)').waitFor();
  assert.doesNotMatch(await preview.innerText(), /Tap item again to open/);
  assert.match(
    await preview.innerText(),
    /Hold for actions/,
    'Each gesture has its own completion',
  );
  await page.keyboard.press('Escape');
  const single = page
    .locator('.ingredient')
    .filter({ hasNot: page.locator('.ore-count') })
    .first();
  const cdp = await context.newCDPSession(page);
  await single.scrollIntoViewIfNeeded();
  const held = await single.boundingBox();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: held.x + 24, y: held.y + 24 }],
  });
  await page.waitForTimeout(650);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const dialog = page.locator('.item-action-dialog');
  await dialog.waitFor();
  await dialog.locator('.minecraft-tooltip:not(.tooltip-skeleton)').waitFor();
  assert.equal(await dialog.locator('h2').count(), 0, 'Only the tooltip supplies a visible title');
  assert.equal(await dialog.locator('.tooltip-header').count(), 1);
  assert.equal(await dialog.locator('.item-action-icon .slot').count(), 1);
  assert.equal(
    await dialog
      .locator('.item-action-icon button, .item-action-icon a, .item-action-icon [tabindex]')
      .count(),
    0,
  );
  assert.equal(
    await dialog.locator('.tooltip-debug').evaluate((node) => getComputedStyle(node).userSelect),
    'none',
  );
  assert.equal(await page.evaluate(() => document.getSelection()?.toString()), '');
  if (screenshots) await page.screenshot({ path: `${screenshots}/item-actions-mobile.png` });
  await dialog.getByRole('button', { name: 'Close item actions' }).click();
  await slot.tap();
  await preview.locator('.minecraft-tooltip:not(.tooltip-skeleton)').waitFor();
  assert.equal(
    await preview.locator('.tooltip-action').count(),
    0,
    'Completed tutorial has no hint line',
  );
  await page.reload();
  await slot.waitFor({ timeout: 120000 });
  await slot.tap();
  await preview.locator('.minecraft-tooltip:not(.tooltip-skeleton)').waitFor();
  assert.equal(
    await preview.locator('.tooltip-action').count(),
    0,
    'Gesture progress survives reload',
  );
  assert.deepEqual(
    await page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-touch-tutorial-v1'))),
    { opened: true, held: true },
  );

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const desktopPage = await desktop.newPage();
  desktopPage.on('pageerror', (error) => errors.push(error.message));
  await desktopPage.goto(itemUrl.href);
  await desktopPage.locator('.ingredient').first().waitFor({ timeout: 120000 });
  await desktopPage.locator('.ingredient').first().hover();
  await desktopPage.locator('.floating-tooltip .tooltip-action').waitFor();
  assert.equal(
    await desktopPage
      .locator('.floating-tooltip .tooltip-action')
      .evaluate((node) => getComputedStyle(node).fontSize),
    '12px',
  );
  if (screenshots)
    await desktopPage.screenshot({ path: `${screenshots}/tooltip-help-desktop.png` });
  assert.deepEqual(errors, []);
  console.log(
    'Cold-start carousel placeholders, text-free tooltip skeletons, independent persistent gesture hints, smaller help, inert modal icon, single title and touch selection prevention passed.',
  );
} finally {
  await browser.close();
}
