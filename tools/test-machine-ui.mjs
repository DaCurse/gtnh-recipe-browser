import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
/* global document, getComputedStyle, innerWidth, Image */
const [base, playwrightModule, screenshots] = process.argv.slice(2);
if (!playwrightModule)
  throw new Error(
    'Usage: node tools/test-machine-ui.mjs <app-url> <playwright-module> [screenshots]',
  );
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch({ headless: true });
if (screenshots) await mkdir(screenshots, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [],
    uiImages = new Set();
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname.includes('posthog') ? route.abort() : route.continue(),
  );
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/assets/machine-ui/')) {
      assert.equal(response.status(), 200);
      assert.match(response.headers()['content-type'], /^image\/png/);
      if (!/\/button-(normal|hover|disabled)\.png$/.test(response.url()))
        uiImages.add(response.url());
    }
  });
  const examples = [
    {
      type: 'Distillation Tower',
      item: 'f:BuildCraft|Energy:oil',
      view: 'usages',
      map: 'gt.recipe.distillationtower',
    },
    {
      type: 'Assemblyline Process',
      item: 'i:gregtech:gt.metaitem.01:32619',
      view: 'recipes',
      map: 'gt.recipe.fakeAssemblylineProcess',
    },
    {
      type: 'Chemical Plant',
      item: 'i:miscutils:item.BasicAgrichemItem:25',
      view: 'recipes',
      map: 'gt.recipe.fluidchemicaleactor',
    },
  ];
  for (const example of examples) {
    const url = new URL(base);
    url.searchParams.set('item', example.item);
    url.searchParams.set('view', example.view);
    await page.goto(url.href);
    await page
      .getByRole('button', { name: example.type, exact: true })
      .waitFor({ timeout: 120000 });
    await page.getByRole('button', { name: example.type, exact: true }).click();
    const stage = page.locator(`[data-machine-map="${example.map}"]`).first();
    await stage.waitFor({ timeout: 120000 });
    assert((await stage.locator('.slot-surface').count()) > 0);
    assert.equal(
      await stage.locator('.ingredient .slot:not(.frameless)').count(),
      0,
      'Native layout ingredients must not paint individual frames',
    );
    if (example.type === 'Distillation Tower') {
      assert((await stage.locator('.non-consumable').count()) > 0);
      assert.equal(await stage.locator('.non-consumable').first().innerText(), 'NC');
      assert.equal(
        await stage
          .locator('.non-consumable')
          .first()
          .evaluate((element) => getComputedStyle(element).color),
        'rgb(253, 216, 53)',
      );
      const fluid = await stage
        .locator('.fluid-amount')
        .first()
        .evaluate((element) => ({
          left: getComputedStyle(element).left,
          right: getComputedStyle(element).right,
        }));
      assert.equal(fluid.left, '1px');
      assert.equal(await stage.locator('.amount').filter({ hasText: /^0L?$/ }).count(), 0);
      const voltage = page.locator('.voltage-label.fmt-6').first();
      await voltage.waitFor();
      assert.equal(
        await voltage.evaluate((element) => getComputedStyle(element).color),
        'rgb(255, 170, 0)',
      );
      assert.equal(await voltage.getAttribute('title'), 'Tier: Medium Voltage');
      const card = stage.locator('xpath=ancestor::article');
      assert.match(
        await card.evaluate((element) => getComputedStyle(element).borderImageSource),
        /nei-panel\.png/,
      );
      assert.match(await card.locator('.duration-line').getAttribute('title'), /^Processing time$/);
      assert.match(
        await card
          .locator('.recipe-stats [title]')
          .filter({ hasText: /EU\/t/ })
          .first()
          .getAttribute('title'),
        /^Energy per tick/,
      );
      assert.equal(
        await card.locator('.recipe-stats').evaluate((element) => getComputedStyle(element).color),
        'rgb(191, 191, 191)',
      );
      assert.equal(
        await stage
          .locator('.ingredient')
          .first()
          .evaluate((element) => element.getBoundingClientRect().width),
        48,
      );
      const progress = stage.locator('.recipe-progress').first();
      await page.waitForFunction(
        (element) => element.dataset.animationState === 'running',
        await progress.elementHandle(),
      );
      const fill = progress.locator('.filled');
      await fill.evaluate((element) => {
        element.getAnimations()[0].currentTime = 1000;
      });
      const initial = await fill.evaluate((element) => getComputedStyle(element).clipPath);
      await page.waitForTimeout(650);
      assert.notEqual(
        await fill.evaluate((element) => getComputedStyle(element).clipPath),
        initial,
        'Arrow must fill using native sprites',
      );
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(
        (element) => element.dataset.animationState === 'reduced-motion',
        await progress.elementHandle(),
      );
      assert.equal(
        await fill.evaluate((element) => element.getAnimations()[0].playState),
        'paused',
      );
      assert.equal(await fill.evaluate((element) => element.getAnimations()[0].currentTime), 5000);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page
        .locator('[data-machine-map="gt.recipe.distillationtower"]')
        .last()
        .scrollIntoViewIfNeeded();
      await page.waitForFunction(
        (element) => element.dataset.animationState === 'paused',
        await progress.elementHandle(),
      );
      await stage.scrollIntoViewIfNeeded();
      await page.waitForFunction(
        (element) => element.dataset.animationState === 'running',
        await progress.elementHandle(),
      );
    }
    if (example.type === 'Chemical Plant') {
      const amount = stage.locator('.amount:not(.fluid-amount)').first();
      if (await amount.count())
        assert.equal(await amount.evaluate((element) => getComputedStyle(element).right), '1px');
    }
    if (example.type === 'Assemblyline Process')
      assert.equal(await stage.locator('.widget').count(), 4);
    await page.waitForLoadState('networkidle');
    if (screenshots) await page.screenshot({ path: `${screenshots}/${example.map}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (example.type === 'Distillation Tower') {
      await page.mouse.move(0, 0);
      const rulerCoversLabel = await page.evaluate(() => {
        const detail = document.querySelector('.detail');
        const label = document.querySelector('.non-consumable');
        const ruler = document.querySelector('.type-row');
        const labelRect = label.getBoundingClientRect();
        const targetY =
          detail.getBoundingClientRect().top + 35 + ruler.getBoundingClientRect().height / 2;
        detail.scrollTop += labelRect.top + labelRect.height / 2 - targetY;
        const rect = label.getBoundingClientRect();
        return Boolean(
          document
            .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
            ?.closest('.type-row'),
        );
      });
      assert(
        rulerCoversLabel,
        'Mobile sticky machine ruler must cover recipe labels while scrolling',
      );
    }
    if (screenshots) await page.screenshot({ path: `${screenshots}/${example.map}-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  const tower = new URL(base);
  tower.searchParams.set('item', 'i:gregtech:gt.blockmachines:1126');
  tower.searchParams.set('view', 'machine-usages');
  await page.goto(tower.href);
  await page
    .locator('[data-machine-map="gt.recipe.distillationtower"]')
    .first()
    .waitFor({ timeout: 120000 });
  assert.match(await page.locator('.view-tabs').innerText(), /Machine Usages\s+[1-9]/);
  assert(
    await page
      .locator('.recipe-list article')
      .first()
      .evaluate((element) => element.getBoundingClientRect().width <= 550),
    'Small recipes stay in a bounded card',
  );
  const harmony = new URL(base);
  harmony.searchParams.set('item', 'i:gregtech:gt.blockmachines:15410');
  harmony.searchParams.set('view', 'machine-usages');
  await page.goto(harmony.href);
  const harmonyCard = page.locator('.recipe-list article').first();
  await harmonyCard.waitFor({ timeout: 120000 });
  assert(
    await harmonyCard.evaluate((element) => element.getBoundingClientRect().width > 550),
    'Large recipes can use the wider row',
  );
  await page.locator('.recipe-list').evaluate((element) => {
    element.style.width = '560px';
  });
  assert(
    await harmonyCard
      .locator('.recipe-stage')
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    'Almost-fitting grids must not create a tiny horizontal scroll',
  );
  const harmonyOutput = harmonyCard
    .locator('.recipe-flow > .io-side')
    .last()
    .locator('.ingredient')
    .first();
  await harmonyOutput.hover();
  await page.getByText('Count: 1,150,554,420', { exact: true }).waitFor();
  await page.getByText('Solid mass: 300%', { exact: true }).waitFor();
  assert(
    await harmonyCard
      .locator('.amount')
      .evaluateAll((elements) =>
        elements.every((element) => element.scrollWidth <= element.clientWidth),
      ),
    'Full quantity labels must fit inside slots',
  );
  await page.mouse.move(0, 0);
  const reactor = new URL(base);
  reactor.searchParams.set('item', 'i:gregtech:gt.blockmachines:12791');
  reactor.searchParams.set('view', 'machine-usages');
  await page.goto(reactor.href);
  const reactorCanvas = page
    .locator('[data-machine-map="kubatech.htgrrecipes"] .machine-canvas')
    .first();
  await reactorCanvas.waitFor({ timeout: 120000 });
  assert(
    await reactorCanvas.evaluate((element) => {
      const logo = element.querySelector('[data-ui-kind="Logo"]');
      return logo.getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom + 1;
    }),
    'KubaTech tea logo stays inside its diagram',
  );
  if (screenshots)
    await reactorCanvas
      .locator('xpath=ancestor::article')
      .screenshot({ path: `${screenshots}/kubatech-logo-contained.png` });
  const url = new URL(base);
  url.searchParams.set('item', 'i:minecraft:iron_ingot:0');
  url.searchParams.set('view', 'recipes');
  await page.goto(url.href);
  await page
    .getByRole('button', { name: 'Crafting (Shapeless)', exact: true })
    .waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: 'Crafting (Shapeless)', exact: true }).click();
  await page.locator('.recipe-flow .slot-grid').first().waitFor();
  assert.equal(
    await page
      .locator('.recipe-flow .slot-grid')
      .first()
      .evaluate((element) => getComputedStyle(element).gridAutoRows),
    '48px',
  );
  assert(
    (await page.locator('.recipe-flow .slot-surface pattern').count()) > 0,
    'Fallback grids use shared tiling surfaces',
  );
  await page.getByRole('button', { name: 'Furnace', exact: true }).click();
  const output = page.locator('[data-machine-map="gt.recipe.furnace"] .ingredient').last();
  await output.click({ button: 'right' });
  assert.equal(new URL(page.url()).searchParams.get('view'), 'usages');
  assert.equal(new URL(page.url()).searchParams.get('item'), 'i:minecraft:iron_ingot:0');
  assert(uiImages.size <= 4, 'Machine UI shares one atlas, two slot sprites and one NEI panel');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  const oil = new URL(base);
  oil.searchParams.set('item', examples[0].item);
  oil.searchParams.set('view', 'usages');
  await page.goto(oil.href);
  await page
    .getByRole('button', { name: 'Distillation Tower', exact: true })
    .waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: 'Distillation Tower', exact: true }).click();
  const native = page.locator('[data-machine-map="gt.recipe.distillationtower"]').first();
  await native.waitFor({ timeout: 120000 });
  const atlasUrl = new URL(await native.locator('.widget image').first().getAttribute('href'), base)
    .href;
  assert(
    await page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image.naturalWidth > 0;
    }, atlasUrl),
    'UI atlas must decode successfully offline',
  );
  await page.goto(harmony.href);
  const offlineOutput = page
    .locator('.recipe-list article')
    .first()
    .locator('.recipe-flow > .io-side')
    .last()
    .locator('.ingredient')
    .first();
  await offlineOutput.waitFor({ timeout: 120000 });
  await offlineOutput.hover();
  await page.getByText('Count: 1,150,554,420', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      nativeTower: true,
      nativeAssemblyLine: true,
      nativeChemicalPlant: true,
      tiledCraftingFallback: true,
      rightClickNavigation: true,
      responsive: true,
      offlineNativeUi: true,
      fullCustomCounts: true,
      offlineCustomCounts: true,
      teaLogoContained: true,
      smallCardsBounded: true,
      noTinyScroll: true,
      nativeAnimations: true,
      reducedMotion: true,
      offscreenPause: true,
      labelsFit: true,
      uiImages: uiImages.size,
      errors,
    }),
  );
} finally {
  await browser.close();
}
