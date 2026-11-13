import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
/* global getComputedStyle */
const [base, playwrightModule, screenshots] = process.argv.slice(2);
if (!playwrightModule)
  throw new Error(
    'Usage: node tools/test-quest-links.mjs <app-url> <playwright-module> [screenshots]',
  );
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch();
if (screenshots) await mkdir(screenshots, { recursive: true });
const itemUrl = (id, view = 'recipes') => {
  const url = new URL(base);
  url.searchParams.set('item', id);
  url.searchParams.set('view', view);
  return url.href;
};
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const errors = [],
    fullQuestRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  context.on('request', (request) => {
    if (/\/quests\/[a-f0-9]{64}\.mpk$/.test(new URL(request.url()).pathname))
      fullQuestRequests.push(request.url());
  });
  await page.goto(itemUrl('i:minecraft:apple:0'), { waitUntil: 'domcontentloaded' });
  const questTab = page.locator('.special-tab[aria-label="Quests"]');
  await questTab.waitFor({ timeout: 120000 });
  await questTab.click();
  const linked = page.locator('.quest-linked-icon').first();
  await linked.waitFor({ timeout: 120000 });
  await page.locator('.quest-name-link').first().hover();
  await page.locator('.quest-tooltip').waitFor();
  assert.equal(await page.getByText(/Rewards this item/).count(), 0);
  await page.locator('.linked-quest .quest-linked-goods .atlas-sprite').first().waitFor();
  assert.match(await page.locator('.linked-quest .special-amount').first().innerText(), /^[0-9]+$/);
  await linked.hover();
  await page.locator('.quest-tooltip').waitFor();
  assert.equal(
    await page.locator('.quest-tooltip .task-count').evaluate((el) => getComputedStyle(el).color),
    'rgb(153, 153, 153)',
  );
  assert.equal(await linked.evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
  assert.equal(
    fullQuestRequests.length,
    0,
    'Item quest tabs and hover previews do not fetch the full questbook',
  );
  if (screenshots) await page.screenshot({ path: `${screenshots}/quest-rewards-tab.png` });
  await linked.click();
  await page.locator('.quest-description').waitFor({ timeout: 120000 });
  assert.match(new URL(page.url()).searchParams.get('quest'), /^q[0-9a-z]+$/);
  const taskHeading = page.locator('.quest-tasks .quest-section h3').first();
  assert.match(await taskHeading.innerText(), /^1\. .+ Task$/);
  assert.equal(await taskHeading.evaluate((el) => getComputedStyle(el).textAlign), 'center');
  assert.equal(
    await taskHeading.evaluate((el) => getComputedStyle(el).color),
    'rgb(255, 255, 255)',
  );
  const toolQuest = new URL(base);
  toolQuest.search = 'page=quests&chapter=q1&quest=q10';
  await page.goto(toolQuest.href, { waitUntil: 'domcontentloaded' });
  const hammer = page
    .locator('.quest-tasks')
    .getByRole('button', { name: /Hammer/ })
    .first();
  await hammer.waitFor({ timeout: 120000 });
  await hammer.hover();
  await page.locator('.minecraft-tooltip').first().waitFor();
  assert.equal(await page.locator('.nbt-tree').count(), 0);
  await page.keyboard.down('Shift');
  await page.locator('.nbt-tree').waitFor();
  await page.keyboard.up('Shift');
  await page.locator('.nbt-tree').waitFor({ state: 'detached' });
  await hammer.click();
  await page.waitForURL(
    (url) =>
      url.searchParams.get('item') ===
      'i:gregtech:gt.metatool.01:12:303388477f39f6c9ee5460198b32269e81610dd3',
  );
  await page.locator('.recipe-list article.card').first().waitFor({ timeout: 120000 });
  await page
    .getByRole('button', { name: /^Usages/ })
    .first()
    .click();
  await page.locator('.special-tab[aria-label="Quests"]').waitFor();
  await page.locator('.special-tab[aria-label="Quests"]').click();
  await page.locator('.linked-quest').first().waitFor();
  if (screenshots) await page.screenshot({ path: `${screenshots}/quest-usages-tab.png` });
  const orQuest = new URL(base);
  orQuest.search = 'page=quests&chapter=q7&quest=q136';
  await page.goto(orQuest.href, { waitUntil: 'domcontentloaded' });
  const separator = page.locator('.special-row-separator').first();
  await separator.waitFor({ timeout: 120000 });
  assert.equal(await separator.innerText(), 'OR');
  assert.equal(await separator.evaluate((el) => getComputedStyle(el).color), 'rgb(0, 0, 255)');
  const separatorBox = await separator.boundingBox(),
    slotBox = await page.locator('.quest-tasks .special-good').first().boundingBox();
  assert(Math.abs(separatorBox.x + separatorBox.width / 2 - slotBox.x - slotBox.width / 2) < 1);
  assert.equal(
    await page.getByText('Any one of these items is required (OR).', { exact: true }).count(),
    0,
  );
  assert.equal(await page.getByText('Choose one reward.', { exact: true }).count(), 0);
  if (screenshots) await page.screenshot({ path: `${screenshots}/native-task-or.png` });
  await page.goto(itemUrl('i:IC2:itemCellEmpty:0'), { waitUntil: 'domcontentloaded' });
  const vending = page.locator('.special-tab[aria-label*="Vending"]').first();
  await vending.waitFor({ timeout: 120000 });
  await vending.click();
  const requiredQuest = page.locator('.quest-requirement-ruler .quest-linked-icon').first();
  await requiredQuest.waitFor({ timeout: 120000 });
  await requiredQuest.hover();
  await page.locator('.quest-tooltip').waitFor();
  assert.equal(
    await page
      .getByText(
        'These are static mod requirements; the browser does not claim quest completion.',
        { exact: true },
      )
      .count(),
    0,
  );
  const trade = page.locator('.trade-layout').first();
  assert.equal(await trade.locator('.special-goods-grid.slotted').count(), 2);
  assert.equal(await trade.locator('.recipe-progress').count(), 1);
  assert.equal(await trade.locator('h3,.special-goods-label,.special-good-label').count(), 0);
  assert.equal(
    await trade
      .locator('.special-goods-grid')
      .first()
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns),
    '48px 48px 48px 48px',
  );
  const corner = page.locator('.special-mark').first();
  await corner.hover();
  assert.equal(await corner.evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
  if (screenshots) await page.screenshot({ path: `${screenshots}/vending-required-quests.png` });
  for (const item of ['o:netherrack', 'i:minecraft:blaze_rod:0']) {
    const cropUrl = new URL(itemUrl(item));
    cropUrl.searchParams.set('special', 'crop-output');
    await page.goto(cropUrl.href, { waitUntil: 'domcontentloaded' });
    const crop = page.locator('[data-special-layout="cropList"]').first();
    await crop.waitFor({ timeout: 120000 });
    await page
      .locator('[data-special-layout="cropList"]')
      .getByRole('button', { name: 'Netherrack', exact: true })
      .first()
      .locator('.atlas-sprite')
      .waitFor({ timeout: 120000 });
  }
  if (screenshots) await page.screenshot({ path: `${screenshots}/crop-netherrack.png` });
  assert.deepEqual(errors, []);
  await context.close();

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  const mobile = await phone.newPage();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await phone.route('**/quests/*.mpk', async (route) => {
    if (/\/[a-f0-9]{64}\.mpk$/.test(new URL(route.request().url()).pathname)) await gate;
    await route.continue();
  });
  await mobile.goto(itemUrl('i:minecraft:apple:0'), { waitUntil: 'domcontentloaded' });
  const mobileTab = mobile.locator('.special-tab[aria-label="Quests"]');
  await mobileTab.waitFor({ timeout: 120000 });
  await mobileTab.tap();
  const mobileQuest = mobile.locator('.quest-name-link').first();
  await mobileQuest.waitFor();
  await mobileQuest.tap();
  await mobile.locator('.touch-tooltip .quest-tooltip').waitFor();
  const navHeight = (await mobile.locator('.primary-nav').boundingBox()).height;
  if (screenshots) await mobile.screenshot({ path: `${screenshots}/quest-link-phone-preview.png` });
  await mobileQuest.tap();
  await mobile.getByRole('progressbar', { name: 'Questbook loading' }).waitFor();
  assert.equal(
    (await mobile.locator('.primary-nav').boundingBox()).height,
    navHeight,
    'Questbook loading preserves navbar height',
  );
  release();
  await mobile.locator('.quest-description').waitFor({ timeout: 120000 });
  assert.equal(
    (await mobile.locator('.primary-nav').boundingBox()).height,
    navHeight,
    'Loaded version picker preserves navbar height',
  );
  assert(
    await mobile
      .locator('.primary-nav img')
      .evaluateAll(
        (images) =>
          images.length === 3 && images.every((image) => image.complete && image.naturalWidth > 0),
      ),
  );
  if (screenshots)
    await mobile.screenshot({ path: `${screenshots}/quest-linked-phone-detail.png` });
  await mobile.goto(itemUrl('i:IC2:itemCellEmpty:0'), { waitUntil: 'domcontentloaded' });
  const mobileVending = mobile.locator('.special-tab[aria-label*="Vending"]').first();
  await mobileVending.waitFor({ timeout: 120000 });
  await mobileVending.tap();
  const mobileTrade = mobile.locator('.trade-layout').first();
  await mobileTrade.waitFor();
  const inputs = await mobileTrade.locator('.trade-side').first().boundingBox();
  const outputs = await mobileTrade.locator('.trade-side').last().boundingBox();
  assert(outputs.x > inputs.x + inputs.width, 'Phone vending grids remain side by side');
  assert(outputs.x + outputs.width <= 390, 'Phone vending grids fit the viewport');
  if (screenshots) await mobile.screenshot({ path: `${screenshots}/vending-phone.png` });
  await phone.close();
  console.log(
    'Quest reward/requirement tabs, vending quest ruler, shared hover/touch previews, native OR layout, compact IDs, Shift NBT and stable navbar passed.',
  );
} finally {
  await browser.close();
}
