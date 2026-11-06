import assert from 'node:assert/strict';
/* global document, innerWidth, innerHeight */
const [base, playwrightModule] = process.argv.slice(2);
if (!playwrightModule) throw new Error('Usage: node tools/test-tooltip-hydration.mjs <app-url> <playwright-module>');
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(base);
  const tile = page.locator('.sequence a').first();
  await tile.waitFor({ timeout: 120000 });
  let release, requested;
  const gate = new Promise(resolve => { release = resolve; });
  const requestStarted = new Promise(resolve => { requested = resolve; });
  await context.route('**/assets/sha256/**', async route => {
    requested();
    await gate;
    await route.continue();
  });
  await tile.focus();
  await requestStarted;
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.floating-tooltip').count(), 0, 'Do not show an unformatted tooltip during detail loading');
  await page.getByRole('link', { name: /Open item catalogue/ }).focus();
  release();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.floating-tooltip').count(), 0, 'An abandoned hover must not open a late tooltip');
  await tile.focus();
  await page.locator('.floating-tooltip').waitFor({ timeout: 120000 });
  assert((await page.locator('.floating-tooltip').innerText()).includes(await tile.getAttribute('aria-label')));
  // Moving over the same icon must not tear down the already formatted tooltip.
  for (let step = 0; step < 8; step++) {
    await tile.dispatchEvent('pointermove', { pointerType: 'mouse', clientX: 200 + step, clientY: 500 });
    assert.equal(await page.locator('.floating-tooltip').count(), 1, 'Pointer movement must not restart tooltip hydration');
  }
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const point of [{ x: viewport.width - 2, y: viewport.height - 2 }, { x: 2, y: 2 }]) {
      await tile.dispatchEvent('pointermove', { pointerType: 'mouse', clientX: point.x, clientY: point.y });
      await page.waitForFunction(() => {
        const rect = document.querySelector('.floating-tooltip')?.getBoundingClientRect();
        return rect && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
      }, undefined, { timeout: 5000 });
      const rect = await page.locator('.floating-tooltip').boundingBox();
      if (point.x > viewport.width / 2) assert(rect.x + rect.width < point.x, 'Right-edge tooltip should flip left');
      if (point.y > viewport.height / 2) assert(rect.y + rect.height < point.y, 'Bottom-edge tooltip should flip up');
    }
  }
  console.log('Tooltip waits for details; cancelled hover stays hidden; cached details reopen; desktop/mobile edge positioning stays in bounds');
} finally { await browser.close(); }
