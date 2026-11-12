import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
/* global getComputedStyle, document, innerWidth */
const [base,modulePath,screenshots]=process.argv.slice(2);
const {chromium}=await import(modulePath);
const browser=await chromium.launch();
if(screenshots) await mkdir(screenshots,{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:960}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const [name,item,tab,card] of [
    ['lootbags','i:minecraft:apple:0',/LootBags/i,'.loot-card'],
    ['world-loot','i:minecraft:apple:0',/World.*Loot/i,'.worldgen-card'],
    ['small-ores','i:minecraft:diamond:0',/Small Ore/i,'.small-ore-card']
  ]) {
    const url=new URL(base);url.searchParams.set('item',item);url.searchParams.set('view','recipes');
    await page.goto(url.href);
    const button=page.locator('.special-tab').filter({has:page.locator('span')}).filter({hasText:tab});
    await button.first().waitFor({timeout:120000});await button.first().click();
    const section=page.locator(card).first();await section.waitFor({timeout:120000});
    for(const width of [1280,390]) {
      await page.setViewportSize({width,height:960});
      const grid=section.locator('.special-goods-grid.slotted').first();await grid.waitFor();
      const cells=grid.locator('.special-good');await cells.first().locator('.atlas-sprite').waitFor({timeout:120000});
      assert.equal(await grid.evaluate(el=>getComputedStyle(el).gap),'0px');
      assert.equal(await section.locator('.slotted .special-good-label').count(),0);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const next=section.locator('.special-goods-pages button').last();
      if(await next.count()) {
        assert.match(await next.evaluate(el=>getComputedStyle(el).borderImageSource),/button-/);
        await next.click();await section.locator('.special-goods-pages button').first().click();
      }
      await cells.first().hover();await page.locator('.minecraft-tooltip').last().waitFor();
      if(screenshots) await page.screenshot({path:`${screenshots}/${name}-${width}.png`});
    }
  }
  const veinUrl=new URL(base);veinUrl.searchParams.set('item','o:oreDiamond');veinUrl.searchParams.set('view','recipes');
  await page.goto(veinUrl.href);
  const veinTab=page.locator('.special-tab').filter({hasText:/Vein/i}).first();
  await veinTab.waitFor({timeout:120000});await veinTab.click();
  const vein=page.locator('.vein-card').first();await vein.waitFor({timeout:120000});
  assert.match(await vein.locator('.layer-copy span').first().evaluate(el=>getComputedStyle(el).fontFamily),/Minecraft/);
  assert.equal(await vein.locator('.dimension-caption').evaluate(el=>el.previousElementSibling.classList.contains('generated-world-label')),true);
  if(screenshots) await page.screenshot({path:`${screenshots}/ore-vein-phone.png`});
  assert.deepEqual(errors,[]);
  console.log('Joined loot/small-ore grids, responsive sizing, tooltips and Minecraft pagination passed.');
} finally {await browser.close();}
