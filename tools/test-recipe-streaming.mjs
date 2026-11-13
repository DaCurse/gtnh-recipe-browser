import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
/* global location, history, document, dispatchEvent, PopStateEvent */
const [appUrl, playwrightModule, screenshotDirectory] = process.argv.slice(2);
if (!playwrightModule)
  throw new Error(
    'Usage: node tools/test-recipe-streaming.mjs <app-url> <playwright-module> [screenshots]',
  );
const { chromium } = await import(playwrightModule);
const index = await fetch(new URL('versions-v7.json', appUrl)).then((r) => r.json());
const version =
  index.versions.find((v) => v.datasetId === index.rollout?.targetDatasetId) ?? index.versions[0];
const manifest = await fetch(new URL(version.packManifestUrl, appUrl)).then((r) => r.json());
const recipePages = new Set(
  manifest.recordPages.filter((p) => p.family === 'recipes').map((p) => p.sha256),
);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let requests = 0,
    held = 0;
  await context.route('**/assets/sha256/*', async (route) => {
    const hash = new URL(route.request().url()).pathname.split('/').pop();
    if (recipePages.has(hash) && ++requests > 12) {
      held++;
      await gate;
    }
    await route.continue();
  });
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.item-tile').first().waitFor({ timeout: 120000 });
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set('item', 'i:minecraft:iron_ingot:0');
    url.searchParams.set('view', 'recipes');
    history.pushState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.locator('.recipe-list article.card').first().waitFor({ timeout: 120000 });
  const deadline = Date.now() + 30000;
  while (!held) {
    if (Date.now() > deadline) throw new Error('No late recipe pages were held');
    await page.waitForTimeout(50);
  }
  assert(
    await page.locator('.recipe-loading.partial').isVisible(),
    'Available recipes must remain visible while later chunks are held',
  );
  assert(
    await page.locator('.pane-toolbar .export-actions button').first().isDisabled(),
    'Incomplete data must not be exported',
  );
  assert((await page.locator('.recipe-list article.card').count()) <= 20);
  if (screenshotDirectory) {
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: `${screenshotDirectory}/partial-mobile.png` });
  }
  release();
  await page.waitForFunction(() => !document.querySelector('.recipe-loading'), undefined, {
    timeout: 120000,
  });
  const filter = page.getByRole('textbox', { name: 'Filter recipes', exact: true });
  await filter.fill('iron');
  await page.waitForFunction(() =>
    /^[1-9][0-9,]* matching recipes$/.test(
      document.querySelector('.recipe-search-block small')?.textContent?.trim() ?? '',
    ),
  );
  await filter.fill('no-such-recipe-performance-regression');
  await page.locator('.no-recipes').waitFor();
  await page.getByRole('button', { name: 'Clear recipe filter', exact: true }).click();
  await page.locator('.recipe-list article.card').first().waitFor();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all recipes', exact: true }).click();
  const file = await download;
  const exported = JSON.parse(await readFile(await file.path(), 'utf8'));
  assert.equal(exported.kind, 'recipes');
  assert(exported.records.length > 20);
  assert.equal(new Set(exported.records.map((r) => r.id)).size, exported.records.length);
  const metadataRecipe = exported.records.find((r) => r.voltageExact || r.metadata?.length);
  assert(metadataRecipe, 'Real-data fixture must include recipe metadata');
  await page.getByRole('button', { name: metadataRecipe.type, exact: true }).click();
  await filter.fill(metadataRecipe.id);
  await page.waitForFunction(
    () =>
      document.querySelector('.recipe-search-block small')?.textContent?.trim() ===
      '1 matching recipes',
  );
  assert.equal(await page.locator('.recipe-list article.card').count(), 1);
  await filter.fill(metadataRecipe.voltageExact || metadataRecipe.metadata[0]);
  await page.waitForFunction(() =>
    /^[1-9][0-9,]* matching recipes$/.test(
      document.querySelector('.recipe-search-block small')?.textContent?.trim() ?? '',
    ),
  );
  await page.getByRole('button', { name: 'Clear recipe filter', exact: true }).click();
  await page.locator('.recipe-list article.card').first().waitFor();
  const next = page
    .getByRole('navigation', { name: 'Recipe pages' })
    .getByRole('button', { name: 'Next', exact: true });
  if ((await next.count()) && (await next.isEnabled())) {
    await next.click();
    await page
      .getByRole('navigation', { name: 'Recipe pages' })
      .getByRole('button', { name: 'Previous', exact: true })
      .click();
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      partialRecipesVisibleWhileChunksHeld: true,
      heldPages: held,
      exportsWaitForCompleteData: true,
      exportedRecipes: exported.records.length,
      ingredientAndMetadataFiltering: true,
      pagination: true,
      errors,
    }),
  );
  await context.close();
} finally {
  await browser.close();
}
