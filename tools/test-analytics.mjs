import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
/* global document, location, history, dispatchEvent, PopStateEvent, window, getComputedStyle, Image */

const [appUrl, playwrightModule] = process.argv.slice(2);
if (!playwrightModule) throw new Error('Usage: node tools/test-analytics.mjs <app-url> <playwright-module>');
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch({ headless: true });
const production = 'https://dacurse.github.io/gtnh-recipe-browser';

async function serve(context) {
  await context.route(`${production}/**`, async (route) => {
    const requested = new URL(route.request().url());
    const response = await route.fetch({ url: new URL(requested.href.slice(`${production}/`.length), appUrl.endsWith('/') ? appUrl : `${appUrl}/`).href });
    if (requested.pathname.includes('/assets/index-') && requested.pathname.endsWith('.js')) {
      // PostHog intentionally filters automated browsers. Enable test capture
      // only in this intercepted local response; production bot filtering stays on.
      const body = (await response.text()).replace('respect_dnt:!0', 'opt_out_useragent_filter:!0,respect_dnt:!0');
      await route.fulfill({ response, body });
    } else await route.fulfill({ response });
  });
}

try {
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true, hasTouch:true });
  await serve(context);
  const events = [], paths = [], errors = [];
  await context.route('https://us.i.posthog.com/**', async (route) => {
    const request = route.request(); paths.push(new URL(request.url()).pathname);
    const bytes = request.postDataBuffer();
    if (bytes) {
      const body = bytes[0] === 31 && bytes[1] === 139 ? gunzipSync(bytes) : bytes;
      const payload = JSON.parse(body.toString());
      assert.match(payload.api_key, /^phc_/);
      events.push(...payload.batch);
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
  });
  const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
  const waitEvent = async (name, predicate = () => true) => {
    const deadline = Date.now() + 120000;
    while (!events.some((event) => event.event === name && predicate(event.properties))) {
      if (Date.now() > deadline) throw new Error(`Missing event: ${name}; received ${events.map((event) => event.event).join(', ')}`);
      await page.waitForTimeout(100);
    }
    console.log(`Verified analytics: ${name}`);
    return events.find((event) => event.event === name && predicate(event.properties));
  };
  await page.goto(`${production}/?search=IRon#private-route`, { waitUntil: 'domcontentloaded' });
  await page.locator('.item-tile').first().waitFor({ timeout: 120000 });
  await waitEvent('$pageview', (properties) => properties.screen === 'catalog');
  await waitEvent('catalog_search', (properties) => properties.query === 'iron');
  await page.getByRole('textbox', { name: 'Search catalog', exact: true }).fill('ir');
  await page.getByRole('textbox', { name: 'Search catalog', exact: true }).fill('iro');
  await page.getByRole('textbox', { name: 'Search catalog', exact: true }).fill('IRON');
  await page.waitForTimeout(1600);
  assert(!events.some((event) => event.event === 'catalog_search' && ['ir', 'iro'].includes(event.properties.query)));
  await page.evaluate(() => {
    const url = new URL(location.href); url.searchParams.set('item', 'i:minecraft:iron_ingot:0'); url.searchParams.set('view', 'recipes');
    history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.locator('.recipe-list article').first().waitFor({ timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector('.recipe-loading'), undefined, { timeout: 120000 });
  await waitEvent('item_viewed', (properties) => properties.item_name === 'Iron Ingot');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all recipes', exact: true }).click();
  await downloaded;
  await waitEvent('data_export_clicked', (properties) => properties.target === 'category');
  const exported = await waitEvent('data_export_completed', (properties) => properties.record_count > 20);
  assert.equal(exported.properties.choice, 'all');
  assert.equal(exported.properties.records, undefined);
  await page.evaluate(() => {
    window.originalExportUrl = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      if (blob.type.startsWith('application/json')) throw new Error('Synthetic export failure');
      return window.originalExportUrl(blob);
    };
  });
  await page.getByRole('button', { name: 'Export all recipes', exact: true }).click();
  await waitEvent('data_export_failed', (properties) => properties.target === 'category');
  await page.evaluate(() => { URL.createObjectURL = window.originalExportUrl; });
  await page.getByRole('link', { name: 'Recipe Finder', exact: true }).click();
  await page.getByRole('button', { name: '+ Add output', exact: true }).click();
  const picker = page.locator('dialog.finder-picker');
  await picker.getByRole('textbox', { name: 'Search catalog', exact: true }).fill('i:minecraft:iron_ingot:0');
  await picker.getByRole('button', { name: 'Iron Ingot', exact: true }).first().waitFor({ timeout: 120000 });
  await picker.getByRole('button', { name: 'Iron Ingot', exact: true }).first().click();
  await picker.waitFor({ state: 'detached' });
  await waitEvent('finder_ingredient_added', (properties) => properties.ingredient_name === 'Iron Ingot');
  await waitEvent('recipe_search_completed', (properties) => properties.output_names === 'Iron Ingot');
  await page.getByRole('button', { name: 'Recipe chain', exact: true }).click();
  await page.evaluate(() => {
    const url = new URL(location.href); url.searchParams.set('input', 'f:gregtech:molten.iron'); url.searchParams.set('output', 'i:gregtech:gt.metaitem.01:2032');
    history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.locator('.chain-steps > li').first().waitFor({ timeout: 120000 });
  await waitEvent('chain_search_completed', (properties) => properties.input_names === 'Molten Iron' && properties.output_names === 'Iron Dust');
  const choices = page.getByRole('navigation', { name: 'Alternative routes to Iron Dust', exact: true });
  await choices.getByRole('button', { name: 'Next route', exact: true }).click();
  await waitEvent('chain_route_viewed', (properties) => properties.route_number === 2);
  await choices.getByRole('button', { name: 'Search more routes', exact: true }).click();
  await page.getByRole('button', { name: 'Stop searching', exact: true }).click();
  await waitEvent('chain_more_requested'); await waitEvent('chain_more_stopped');
  await page.goto(`${production}/?page=quests&chapter=q0&quest=q0`);
  await page.locator('.quest-description').waitFor({timeout:120000});
  await waitEvent('questbook_loaded');
  await waitEvent('quest_viewed',properties=>properties.quest_name==='Your First Night');
  await page.getByRole('button',{name:'Back to quests',exact:true}).click();
  await waitEvent('quest_chapter_viewed');
  await page.locator('.quest-node').first().waitFor();
  await page.locator('.quest-node').evaluateAll(async nodes=>{
    for(const node of nodes) {
      const css=getComputedStyle(node,'::before').backgroundImage;
      const image=new Image();image.src=css.slice(5,-2);await image.decode();
      if(!image.naturalWidth) throw new Error('Production quest frame failed to decode');
    }
  });
  await page.locator('.desktop-search input').fill('hammer');
  await waitEvent('quest_search',properties=>properties.query==='hammer'&&properties.result_count>0);
  await page.goto(`${production}/?item=i:minecraft:apple:0&view=recipes`);
  const questTab=page.locator('.special-tab[aria-label="Quests"]');await questTab.waitFor({timeout:120000});await questTab.click();
  await waitEvent('special_viewed',properties=>properties.special_type==='quests');
  const questName=page.locator('.quest-name-link').first();await questName.waitFor();
  await questName.tap();await waitEvent('quest_touch_preview');
  await questName.tap();await waitEvent('quest_link_opened',properties=>properties.source==='item_recipes');
  await page.goto(`${production}/?item=i:minecraft:apple:0&view=recipes&special=quests`);
  const reward=page.locator('.quest-linked-goods .special-good').first();await reward.waitFor({timeout:120000});
  await reward.tap();await waitEvent('item_touch_interaction',properties=>properties.action==='preview');
  const box=await reward.boundingBox();
  await reward.dispatchEvent('pointerdown',{pointerId:77,pointerType:'touch',isPrimary:true,clientX:box.x+10,clientY:box.y+10});
  await page.locator('.item-action-dialog').waitFor();
  await page.dispatchEvent('body','pointerup',{pointerId:77,pointerType:'touch'});
  await waitEvent('item_touch_interaction',properties=>properties.action==='hold');
  await page.locator('.item-action-dialog').getByRole('button',{name:'Recipes',exact:true}).click();
  await waitEvent('item_action_selected',properties=>properties.view==='recipes');
  for (const event of events) {
    for (const [key, value] of Object.entries(event.properties)) {
      if (key.toLowerCase().includes('url') && typeof value === 'string') {
        assert.doesNotMatch(value, /[?&](search|item|input|output|version|recipe-filter|quest|chapter|quest-search|quest-version)=|private-route/);
      }
    }
  }
  assert(paths.every((path) => path === '/e/'));
  assert(!events.some((event) => ['$autocapture', '$snapshot', '$exception'].includes(event.event)));
  assert.deepEqual(errors, []);
  await context.close();

  for (const preference of ['blocked', 'dnt']) {
    const isolated = await browser.newContext({ serviceWorkers: 'block' });
    await serve(isolated);
    if (preference === 'dnt') await isolated.addInitScript(() => Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' }));
    let requests = 0;
    await isolated.route('https://us.i.posthog.com/**', (route) => { requests++; return route.abort(); });
    const tab = await isolated.newPage(); const pageErrors = [];
    tab.on('pageerror', (error) => pageErrors.push(error.message));
    await tab.goto(`${production}/`, { waitUntil: 'domcontentloaded' });
    await tab.getByRole('link',{name:'Open item catalogue',exact:true}).click();
    await tab.locator('.item-tile').first().waitFor({ timeout: 120000 });
    await tab.waitForTimeout(3500);
    if (preference === 'dnt') assert.equal(requests, 0); else assert(requests > 0);
    assert.deepEqual(pageErrors, []);
    await isolated.close();
  }
  console.log(JSON.stringify({ manualPageviews: true, popularSearchesAndIngredients: true, featureEvents: true,
    exportClickCompletionAndFailure: true, noPartialKeystrokes: true, urlsSanitized: true, noReplayOrAutocapture: true,
    blockedAnalyticsKeepsAppUsable: true, doNotTrack: true, events: [...new Set(events.map((event) => event.event))], errors }));
} finally { await browser.close(); }
