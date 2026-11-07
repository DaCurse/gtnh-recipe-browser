import assert from 'node:assert/strict';
/* global document */
const [base, playwrightModule] = process.argv.slice(2);
if (!playwrightModule) throw new Error('Usage: node tools/test-machine-crafters.mjs <app-url> <playwright-module>');
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.route('**/*', route => new URL(route.request().url()).hostname.includes('posthog') ? route.abort() : route.continue());
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const [id, currentName, category] of [
    [262, 'Advanced Electric Furnace', 'Furnace'], [672, 'Advanced Electric Oven', 'Furnace'],
    [12699, 'Basic Bio Lab', 'Bio Lab'], [31033, 'Cold Trap I', 'Cold Trap']
  ]) {
    const url = new URL(base);
    url.searchParams.set('version', '2.9.0-v7-rbd0b48ae8ad7');
    url.searchParams.set('item', `i:gregtech:gt.blockmachines:${id}`);
    url.searchParams.set('view', 'machine-usages');
    await page.goto(url.href);
    const card = page.locator('.recipe-list article.card').first();
    await card.waitFor({ timeout: 120000 });
    await page.waitForFunction(() => !document.querySelector('.recipe-loading.recipe-progress'));
    assert.match(await page.locator('.view-tabs').innerText(), /Machine Usages\s+[1-9][0-9]*/);
    const crafter = card.locator('.machine-mark.interactive');
    assert.match(await crafter.getAttribute('aria-label'), new RegExp(`^${currentName}:`));
    await crafter.click();
    const modal = page.getByRole('dialog', { name: `Valid machines for ${category}` });
    await modal.waitFor();
    const current = modal.getByText(currentName, { exact: true });
    assert.equal(await current.count(), 1);
    assert.match(await current.locator('..').innerText(), /Single-block machine tier/);
    if (category === 'Furnace') {
      assert.match(await modal.innerText(), /Basic Microwave/);
      assert.match(await modal.innerText(), /Advanced Electric Oven/);
      assert.match(await modal.innerText(), /Advanced Electric Furnace/);
    }
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    await page.reload();
    await page.locator('.recipe-list article.card').first().waitFor({ timeout: 120000 });
    assert.match(await page.locator('.view-tabs').innerText(), /Machine Usages\s+[1-9][0-9]*/);
    await context.setOffline(false);
    console.log(`${currentName}: machine usages, complete tiered crafter list and offline reload passed.`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
