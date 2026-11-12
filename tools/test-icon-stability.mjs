import assert from 'node:assert/strict';
/* global window, HTMLImageElement, MutationObserver, Element, innerWidth, document */
const [base,modulePath]=process.argv.slice(2);
if(!modulePath)throw new Error('Usage: node tools/test-icon-stability.mjs <app-url> <playwright-module>');
const {chromium}=await import(modulePath);
const browser=await chromium.launch();
try {
  const context=await browser.newContext({viewport:{width:1280,height:960},serviceWorkers:'block'});
  await context.addInitScript(()=>{
    let release;
    const gate=new Promise(resolve=>release=resolve);
    window.iconStability={release,pending:0,skeletons:0,removed:0};
    const decode=HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode=async function(){
      await decode.call(this);
      if(this.naturalWidth===512){window.iconStability.pending++;await gate;}
    };
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const url=new URL(base);url.search='page=quests&chapter=q0';
  await page.goto(url.href);
  const low=page.locator('.quest-node[style*="width: 24px"] .atlas-sprite[data-sprite-resolution="32"]').first();
  await low.waitFor({timeout:120000});
  const id=await low.evaluate(el=>el.closest('.quest-node').dataset.quest);
  const node=page.locator(`.quest-node[data-quest="${id}"]`);
  await node.evaluate(el=>{
    new MutationObserver(records=>{for(const record of records){
      for(const added of record.addedNodes) if(added instanceof Element&&(added.matches('.icon-skeleton')||added.querySelector('.icon-skeleton'))) window.iconStability.skeletons++;
      for(const removed of record.removedNodes) if(removed instanceof Element&&removed.matches('.atlas-sprite')) window.iconStability.removed++;
    }}).observe(el,{childList:true,subtree:true});
  });
  await node.hover();await page.mouse.wheel(0,-2000);
  await page.waitForFunction(()=>window.iconStability.pending>0);
  await page.waitForTimeout(300);
  assert.equal(await node.locator('.atlas-sprite').getAttribute('data-sprite-resolution'),'32','Keep the base sprite visible while HD decoding is delayed');
  assert.equal(await node.locator('.icon-skeleton').count(),0);
  await page.evaluate(()=>window.iconStability.release());
  await node.locator('[data-sprite-resolution="64"]').waitFor({timeout:120000});
  for(const delta of [1500,-1500,1500,-1500]){await node.hover();await page.mouse.wheel(0,delta);await page.waitForTimeout(120);}
  const changes=await page.evaluate(()=>({skeletons:window.iconStability.skeletons,removed:window.iconStability.removed}));
  assert.deepEqual(changes,{skeletons:0,removed:0},'Zoom and resolution upgrades never remove a displayed sprite');
  await node.click();await page.locator('.quest-description').waitFor();
  await page.evaluate(id=>{
    window.iconStability.skeletons=0;
    new MutationObserver(records=>{for(const record of records)for(const added of record.addedNodes){
      if(!(added instanceof Element))continue;
      const target=added.closest(`.quest-node[data-quest="${id}"]`) ?? added.querySelector(`.quest-node[data-quest="${id}"]`);
      if(target?.querySelector('.icon-skeleton'))window.iconStability.skeletons++;
    }}).observe(document.body,{childList:true,subtree:true});
  },id);
  await page.getByRole('button',{name:'Back to quests',exact:true}).click();
  await node.locator('[data-sprite-resolution="64"]').waitFor();
  assert.equal(await page.evaluate(()=>window.iconStability.skeletons),0,'Warm navigation paints the cached sprite immediately');
  const landing=new URL(base);await page.goto(landing.href);
  await page.evaluate(()=>window.iconStability.release());
  await page.locator('.sequence .atlas-sprite').first().waitFor({timeout:120000});
  const row=page.locator('.row').first();await row.hover();
  const single=row.locator('.sequence a').filter({has:page.locator('.atlas-sprite')});
  const family=await single.evaluateAll(links=>links.find(link=>link.dataset.family===link.dataset.item&&link.getBoundingClientRect().left>=0&&link.getBoundingClientRect().right<=innerWidth)?.dataset.family);
  assert(family);
  const tile=row.locator(`.sequence a[data-family="${family}"]`).first();await tile.hover({force:true});
  await tile.evaluate(el=>new MutationObserver(records=>{for(const record of records)for(const added of record.addedNodes)if(added instanceof Element&&(added.matches('.icon-skeleton')||added.querySelector('.icon-skeleton')))window.iconStability.skeletons++;}).observe(el,{childList:true,subtree:true}));
  await page.waitForTimeout(2700);
  assert.equal(await page.evaluate(()=>window.iconStability.skeletons),0,'Stable landing icons stay painted across variant ticks and tooltip hydration');
  assert.deepEqual(errors,[]);
  console.log('Delayed HD decoding, shared ready sprites, zoom transitions and stable landing icons passed.');
} finally {await browser.close();}
