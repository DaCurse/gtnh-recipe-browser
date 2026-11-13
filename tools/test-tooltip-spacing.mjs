import assert from 'node:assert/strict';
/* global getComputedStyle */
const [base, playwrightModule] = process.argv.slice(2);
if (!playwrightModule)
  throw new Error('Usage: node tools/test-tooltip-spacing.mjs <app-url> <playwright-module>');
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const url = new URL(base);
  url.searchParams.set(
    'item',
    'i:TConstruct:BoltPart:1538:f3c4b1e9c004a5510acdf2787d1c666bf2208208',
  );
  url.searchParams.set('view', 'recipes');
  await page.goto(url.href);
  const tooltip = page.locator('.item-head .minecraft-tooltip');
  await tooltip.waitFor({ timeout: 120000 });
  await tooltip.getByText('Parts can be replaced', { exact: true }).waitFor();
  const blank = tooltip.locator('.minecraft-line.empty');
  assert.equal(await blank.count(), 1, 'Keep the intentional separator');
  const dimensions = await blank.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      lineHeight: parseFloat(style.lineHeight),
      padding: style.padding,
    };
  });
  assert.equal(dimensions.padding, '0px');
  assert(
    dimensions.height <= dimensions.lineHeight * 1.1,
    'Blank separator must occupy one normal line',
  );
  assert((await tooltip.locator('.fmt-6').count()) > 0, 'Retain Minecraft formatting');
  await page.getByRole('link', { name: 'Items', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search catalog', exact: true })
    .fill('zzzz_no_matching_catalog_entry_zzzz');
  const empty = page.locator('.catalog-empty');
  await empty.getByText('No matches', { exact: true }).waitFor({ timeout: 120000 });
  assert.equal(
    await empty.evaluate((element) => getComputedStyle(element).paddingTop),
    '60px',
    'Catalogue empty panel retains its own spacing',
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ tooltipSeparator: dimensions, catalogueEmptyStatePreserved: true, errors }),
  );
} finally {
  await browser.close();
}
