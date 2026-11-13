import assert from 'node:assert/strict';
/* global document, innerWidth, innerHeight, window, MutationObserver */
const [base, playwrightModule] = process.argv.slice(2);
if (!playwrightModule)
  throw new Error('Usage: node tools/test-tooltip-hydration.mjs <app-url> <playwright-module>');
const { chromium } = await import(playwrightModule);
const versionsUrl = new URL('versions-v7.json', base);
const versions = await fetch(versionsUrl).then((response) => response.json());
const version =
  versions.versions.find((value) => value.datasetId === versions.rollout?.targetDatasetId) ??
  versions.versions[0];
const manifest = await fetch(new URL(version.packManifestUrl, versionsUrl)).then((response) =>
  response.json(),
);
const detailHashes = new Set(
  manifest.recordPages.filter((page) => page.family === 'goods-details').map((page) => page.sha256),
);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).hostname.includes('posthog') ? route.abort() : route.fallback(),
  );
  const page = await context.newPage();
  await page.goto(base);
  const tile = page.locator('.sequence a').first();
  await tile.waitFor({ timeout: 120000 });
  let release, requested;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const requestStarted = new Promise((resolve) => {
    requested = resolve;
  });
  await context.route('**/assets/sha256/**', async (route) => {
    requested();
    await gate;
    await route.continue();
  });
  await tile.focus();
  await requestStarted;
  await page.waitForTimeout(200);
  await page.locator('.floating-tooltip .tooltip-skeleton').waitFor();
  assert.equal(
    await page.locator('.floating-tooltip .minecraft-tooltip:not(.tooltip-skeleton)').count(),
    0,
    'Show a skeleton instead of an unformatted tooltip during detail loading',
  );
  await page.getByRole('link', { name: /Open item catalogue/ }).focus();
  release();
  await page.waitForTimeout(300);
  assert.equal(
    await page.locator('.floating-tooltip').count(),
    0,
    'An abandoned hover must not open a late tooltip',
  );
  await tile.focus();
  await page
    .locator('.floating-tooltip .minecraft-tooltip:not(.tooltip-skeleton)')
    .waitFor({ timeout: 120000 });
  assert(
    (await page.locator('.floating-tooltip').innerText()).includes(
      await tile.getAttribute('aria-label'),
    ),
  );
  // Moving over the same icon must not tear down the already formatted tooltip.
  for (let step = 0; step < 8; step++) {
    await tile.dispatchEvent('pointermove', {
      pointerType: 'mouse',
      clientX: 200 + step,
      clientY: 500,
    });
    assert.equal(
      await page.locator('.floating-tooltip').count(),
      1,
      'Pointer movement must not restart tooltip hydration',
    );
  }
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const point of [
      { x: viewport.width - 2, y: viewport.height - 2 },
      { x: 2, y: 2 },
    ]) {
      await tile.dispatchEvent('pointermove', {
        pointerType: 'mouse',
        clientX: point.x,
        clientY: point.y,
      });
      await page.waitForFunction(
        () => {
          const rect = document.querySelector('.floating-tooltip')?.getBoundingClientRect();
          return (
            rect &&
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight
          );
        },
        undefined,
        { timeout: 5000 },
      );
      const rect = await page.locator('.floating-tooltip').boundingBox();
      if (point.x > viewport.width / 2)
        assert(rect.x + rect.width < point.x, 'Right-edge tooltip should flip left');
      if (point.y > viewport.height / 2)
        assert(rect.y + rect.height < point.y, 'Bottom-edge tooltip should flip up');
    }
  }
  console.log(
    'Tooltip skeleton appears while loading; cancelled hover stays hidden; cached details reopen; desktop/mobile edge positioning stays in bounds',
  );
  await context.close();

  const itemId = 'i:gregtech:gt.blockmachines:262';
  for (const scenario of ['picker', 'result', 'inline']) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', (route) =>
      new URL(route.request().url()).hostname.includes('posthog')
        ? route.abort()
        : route.fallback(),
    );
    let release, requested;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      requested = resolve;
    });
    let gating = scenario !== 'result';
    await context.route('**/assets/sha256/*', async (route) => {
      if (gating && detailHashes.has(new URL(route.request().url()).pathname.split('/').at(-1))) {
        requested();
        await gate;
      }
      await route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const url = new URL(base);
    if (scenario === 'inline') {
      url.searchParams.set('item', itemId);
      url.searchParams.set('view', 'recipes');
    } else {
      url.searchParams.set('page', 'finder');
      if (scenario === 'result') url.searchParams.set('output', itemId);
    }
    await page.goto(url.href);
    let trigger;
    const selector =
      scenario === 'inline'
        ? '.item-head .minecraft-tooltip:not(.tooltip-skeleton)'
        : '.floating-tooltip .minecraft-tooltip:not(.tooltip-skeleton)';
    if (scenario === 'picker') {
      await page.getByRole('button', { name: '+ Add input', exact: true }).click();
      const dialog = page.locator('.finder-picker');
      await dialog.getByRole('textbox', { name: 'Search catalog', exact: true }).fill(itemId);
      trigger = dialog.getByRole('button', { name: 'Advanced Electric Furnace', exact: true });
      await trigger.waitFor({ timeout: 120000 });
    } else if (scenario === 'result') {
      trigger = page
        .locator('.finder-recipes')
        .getByRole('button', { name: 'MV Machine Hull', exact: true })
        .first();
      await trigger.waitFor({ timeout: 120000 });
      gating = true;
    }
    await page.evaluate((selector) => {
      window.tooltipPaints = [];
      new MutationObserver(() => {
        const tooltip = document.querySelector(selector);
        if (tooltip)
          window.tooltipPaints.push(Boolean(tooltip.querySelector('span[class*="fmt-"]')));
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
    }, selector);
    if (trigger) await trigger.focus();
    await started;
    await page.waitForTimeout(250);
    assert.equal(
      await page.locator(selector).count(),
      0,
      `${scenario}: no uncoloured intermediate tooltip`,
    );
    await page.getByRole('status', { name: 'Loading item information', exact: true }).waitFor();
    release();
    await page.locator(selector).waitFor({ timeout: 120000 });
    assert(
      (await page.locator(`${selector} span[class*="fmt-"]`).count()) > 0,
      `${scenario}: colours present on first appearance`,
    );
    assert(
      (await page.evaluate(() => window.tooltipPaints)).every(Boolean),
      `${scenario}: never paint plain text before formatting`,
    );
    if (scenario === 'picker') {
      await trigger.click();
      await page.locator('.finder-picker').waitFor({ state: 'detached' });
      await page.locator('.ingredient-chip').first().focus();
      await page.locator('.floating-tooltip').waitFor();
      assert(
        (await page.locator('.floating-tooltip span[class*="fmt-"]').count()) > 0,
        'Selected finder chips share formatted tooltips',
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      `${scenario}: loading uses the shared skeleton, first content render has colours, no plain-text flash`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
