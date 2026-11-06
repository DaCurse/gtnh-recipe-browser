import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
/* global innerWidth, document, location, history, dispatchEvent, PopStateEvent */
const [appUrl, playwrightModule, screenshotDirectory] = process.argv.slice(2);
if (!playwrightModule) throw new Error('Usage: node tools/test-recipe-finder.mjs <app-url> <playwright-module> [screenshots]');
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch({ headless: true });
const iron = 'i:minecraft:iron_ingot:0';
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.item-tile').first().waitFor({ timeout: 120000 });
  // The existing item browser provides an independent complete real-data oracle.
  await page.evaluate((id) => {
    const url = new URL(location.href); url.searchParams.set('item', id); url.searchParams.set('view', 'recipes');
    history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate'));
  }, iron);
  await page.locator('.recipe-list article').first().waitFor({ timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector('.recipe-loading'), undefined, { timeout: 120000 });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all recipes', exact: true }).click();
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8')).records;
  const contains = (ingredients, id) => ingredients.some((ingredient) => ingredient.id === id || ingredient.alternatives?.includes(id));
  const outputRecipes = exported.filter((recipe) => contains(recipe.outputs, iron));
  assert(outputRecipes.length > 20, 'Need enough real recipes to exercise pagination');
  const fluidRecipe = outputRecipes.find((recipe) => recipe.inputs.some((ingredient) => ingredient.kind === 'fluid'));
  assert(fluidRecipe, 'Need a fluid-input fixture');
  const fluid = fluidRecipe.inputs.find((ingredient) => ingredient.kind === 'fluid');
  const expectedMixed = outputRecipes.filter((recipe) => contains(recipe.inputs, fluid.id));
  const finish = () => page.waitForFunction(() => !document.querySelector('.finder-progress'), undefined, { timeout: 120000 });
  const count = () => page.locator('.finder-results-bar h2').innerText().then((value) => Number(value.replace(/[^0-9]/g, '')));
  async function pick(side, id) {
    await page.getByRole('button', { name: `+ Add ${side}`, exact: true }).click();
    const dialog = page.locator('dialog.finder-picker');
    await dialog.getByRole('textbox', { name: 'Search catalog', exact: true }).fill(id);
    await page.waitForFunction(() => /^1 ITEMS & FLUIDS$/.test(document.querySelector('dialog .result-bar')?.textContent?.trim() ?? ''), undefined, { timeout: 120000 });
    await dialog.locator('.item-tile').first().click();
    const variant = page.locator('.variant-picker');
    if (await variant.count()) await variant.locator('.variant-list button').first().click();
    await page.locator('dialog.finder-picker').waitFor({ state: 'detached' });
    await finish();
  }
  await page.getByRole('link', { name: 'Recipe Finder', exact: true }).click();
  assert.equal(await page.locator('.finder-recipes article').count(), 0);
  await pick('output', iron);
  console.log(JSON.stringify({ phase: 'output-ready' }));
  assert.equal(await count(), outputRecipes.length);
  const ruler = page.getByRole('navigation', { name: 'Filter by machine', exact: true });
  assert((await ruler.getByRole('button').count()) > 2);
  await ruler.locator('.atlas-sprite').first().waitFor();
  if (screenshotDirectory) {
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: `${screenshotDirectory}/finder-machines-desktop.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await ruler.evaluate((el) => el.scrollWidth > el.clientWidth), true);
  if (screenshotDirectory) await page.screenshot({ path: `${screenshotDirectory}/finder-machines-mobile.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.locator('.finder-recipes article').count(), 20);
  await page.getByRole('navigation', { name: 'Finder result pages' }).getByRole('button', { name: 'Next', exact: true }).click();
  assert.match(await page.locator('.finder-pagination').innerText(), /Page 2/);
  const index = await fetch(new URL('versions-v7.json', appUrl)).then((response) => response.json());
  const version = index.versions.find((candidate) => candidate.datasetId === new URL(page.url()).searchParams.get('version'));
  const manifest = await fetch(new URL(version.packManifestUrl, appUrl)).then((response) => response.json());
  const recipePages = new Set(manifest.recordPages.filter((asset) => asset.family === 'recipes').map((asset) => asset.sha256));
  let recipePageReads = 0;
  let assetReads = 0;
  const onRequest = (request) => {
    if (request.url().includes('/assets/sha256/')) assetReads++;
    if (recipePages.has(new URL(request.url()).pathname.split('/').pop())) recipePageReads++;
  };
  page.on('request', onRequest);
  await pick('input', fluid.id);
  assert.equal(await count(), expectedMixed.length);
  assert.equal(recipePageReads, 0, 'Adding a constraint must reuse complete candidate results');
  const mixedUrl = page.url();
  const machine = expectedMixed[0].type;
  await ruler.getByRole('button', { name: machine, exact: true }).click();
  assert.equal(await ruler.getByRole('button', { name: machine, exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await count(), expectedMixed.filter((recipe) => recipe.type === machine).length);
  await ruler.getByRole('button', { name: /All machines/ }).click();
  // An impossible second output must remove results, never act as an OR query.
  await pick('output', fluid.id);
  assert.equal(await count(), outputRecipes.filter((recipe) => contains(recipe.inputs, fluid.id) && contains(recipe.outputs, fluid.id)).length);
  await page.goBack(); await finish();
  assert.equal(await count(), expectedMixed.length);
  await page.reload();
  await page.locator('.finder-recipes article').first().waitFor({ timeout: 120000 }); await finish();
  assert.equal(await count(), expectedMixed.length);
  assert.equal(page.url(), mixedUrl);
  if (screenshotDirectory) {
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: `${screenshotDirectory}/finder-desktop.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const lastMachine = ruler.getByRole('button').last();
  await lastMachine.focus();
  await page.keyboard.press('Space');
  assert.equal(await lastMachine.getAttribute('aria-pressed'), 'true');
  await ruler.getByRole('button', { name: /All machines/ }).click();
  if (screenshotDirectory) await page.screenshot({ path: `${screenshotDirectory}/finder-mobile.png` });
  await page.getByRole('button', { name: '+ Add input', exact: true }).click();
  const picker = page.locator('dialog.finder-picker');
  await picker.getByRole('textbox', { name: 'Search catalog', exact: true }).fill('water');
  await page.keyboard.press('Control+k');
  assert.equal(await picker.getByRole('textbox', { name: 'Search catalog', exact: true }).evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('button', { name: '+ Add input', exact: true }).evaluate((el) => el === document.activeElement), true);
  await page.getByRole('button', { name: /Remove .* from outputs/ }).click(); await finish();
  const inputOnly = await count();
  console.log(JSON.stringify({ phase: 'input-ready' }));
  assert(inputOnly >= expectedMixed.length);
  // Multiple inputs, including a member accepted by an interchangeable slot.
  const groupedRecipe = outputRecipes.find((recipe) => recipe.inputs.length > 1 && recipe.inputs.some((ingredient) => ingredient.alternatives?.length > 1));
  assert(groupedRecipe);
  const grouped = groupedRecipe.inputs.find((ingredient) => ingredient.alternatives?.length > 1);
  const other = groupedRecipe.inputs.find((ingredient) => ingredient !== grouped);
  const inputIds = [grouped.alternatives[0], other.alternatives?.[0] ?? other.id];
  const expectedGroup = outputRecipes.filter((recipe) => inputIds.every((id) => contains(recipe.inputs, id)));
  await page.evaluate(({ inputIds, iron }) => {
    const url = new URL(location.href); url.searchParams.delete('input'); url.searchParams.delete('output');
    for (const id of inputIds) url.searchParams.append('input', id);
    url.searchParams.append('output', iron);
    history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate'));
  }, { inputIds, iron });
  await finish();
  assert.equal(await count(), expectedGroup.length);
  assert(expectedGroup.length > 0);
  console.log(JSON.stringify({ phase: 'grouped-subset-ready' }));
  // Exact NBT variant selection works inside the native dialog.
  await page.getByRole('button', { name: '+ Add input', exact: true }).click();
  await picker.getByRole('textbox', { name: 'Search catalog', exact: true }).fill('Iron Ore');
  const variantTile = picker.locator('.item-tile').filter({ has: page.locator('small', { hasText: 'exact variants' }) }).first();
  console.log(JSON.stringify({ phase: 'variant-search' }));
  await variantTile.waitFor({ timeout: 120000 }); await variantTile.click();
  await page.locator('.variant-row').first().waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.variant-picker').waitFor({ state: 'detached' });
  assert(await picker.isVisible());
  await variantTile.click(); await page.locator('.variant-row').first().click();
  await picker.waitFor({ state: 'detached' });
  assert.equal(new URL(page.url()).searchParams.getAll('input').length, inputIds.length + 1);
  // Clear during an in-flight change must prevent stale recipes returning.
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.finder-recipes article').count(), 0);
  assert.equal(new URL(page.url()).searchParams.has('input'), false);
  console.log(JSON.stringify({ phase: 'cancellation-check' }));
  const cold = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const pendingPage = await cold.newPage();
  pendingPage.on('pageerror', (error) => errors.push(error.message));
  let release, started;
  const gate = new Promise((resolve) => { release = resolve; });
  const held = new Promise((resolve) => { started = resolve; });
  await cold.route('**/assets/sha256/*', async (route) => {
    if (recipePages.has(new URL(route.request().url()).pathname.split('/').pop())) { started(); await gate; }
    await route.continue();
  });
  const pendingUrl = new URL(mixedUrl); pendingUrl.searchParams.delete('output');
  try {
    await pendingPage.goto(pendingUrl.href, { waitUntil: 'domcontentloaded' });
    await pendingPage.getByRole('button', { name: 'Clear all', exact: true }).waitFor({ timeout: 120000 });
    await held;
    await pendingPage.getByRole('button', { name: 'Clear all', exact: true }).click();
    release();
    await pendingPage.waitForTimeout(1000);
    assert.equal(await pendingPage.locator('.finder-recipes article').count(), 0);
    assert.equal(await pendingPage.locator('.finder-progress').count(), 0);
  } finally { release(); await cold.close(); }
  assert.deepEqual(errors, []);
  page.off('request', onRequest);
  console.log(JSON.stringify({ outputRecipes: outputRecipes.length, mixedRecipes: expectedMixed.length, fluid: fluid.id,
    inputOnlyRecipes: inputOnly, groupedMultiInputRecipes: expectedGroup.length, cachedRefinement: true, exactVariant: true, subsetBothSides: true, allMachines: true, machineFilter: true,
    pagination: true, urlRefreshAndBack: true, mobilePickerKeyboard: true, staleClear: true, assetReads, errors }));
  await context.close();
} finally { await browser.close(); }
