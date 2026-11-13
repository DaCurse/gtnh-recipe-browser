import assert from 'node:assert/strict';
/* global document, window, requestAnimationFrame, MutationObserver */

const [base, playwrightModule] = process.argv.slice(2);
if (!playwrightModule)
  throw new Error(
    'Usage: node tools/test-startup-responsiveness.mjs <app-url> <playwright-module>',
  );
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    // Navigate at the exact download/preparation boundary, before automation
    // could miss a stalled main thread and click only after it recovers.
    const observer = new MutationObserver(() => {
      if (
        !(Number(document.querySelector('.landing-load-bar')?.getAttribute('aria-valuenow')) >= 70)
      )
        return;
      const link = document.querySelector('.actions a');
      if (!link) return;
      observer.disconnect();
      window.__navigationStart = performance.now();
      window.__largestGap = 0;
      let last = performance.now();
      const heartbeat = setInterval(() => {
        const now = performance.now();
        window.__largestGap = Math.max(window.__largestGap, now - last);
        last = now;
        if (document.querySelector('.item-tile')) clearInterval(heartbeat);
      }, 50);
      link.click();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          window.__navigationPaint = performance.now() - window.__navigationStart;
          window.__loadingVisible = Boolean(document.querySelector('.app-state .load-progress'));
        }),
      );
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true });
  });
  await page.goto(base);
  await page.waitForFunction(() => window.__navigationPaint !== undefined, undefined, {
    timeout: 120000,
  });
  const navigation = await page.evaluate(() => ({
    paint: window.__navigationPaint,
    loading: window.__loadingVisible,
  }));
  assert(navigation.loading, 'Catalogue loading feedback appears during preparation');
  assert(
    navigation.paint < 1000,
    `Loading feedback took ${navigation.paint}ms on a 6× throttled phone`,
  );
  await page.locator('.item-tile').first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(100);
  const largestGap = await page.evaluate(() => window.__largestGap);
  assert(largestGap < 1500, `Main-thread heartbeat paused for ${largestGap}ms after 70%`);
  assert.deepEqual(errors, []);
  console.log(
    `6× CPU phone: loading view painted in ${Math.round(navigation.paint)}ms at 70%; largest preparation/UI heartbeat gap ${Math.round(largestGap)}ms.`,
  );
} finally {
  await browser.close();
}
