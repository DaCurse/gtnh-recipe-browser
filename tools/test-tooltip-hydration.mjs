import assert from 'node:assert/strict';
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
  console.log('Tooltip waits for details; cancelled hover stays hidden; cached details reopen successfully');
} finally { await browser.close(); }
