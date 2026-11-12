import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decode } from '@msgpack/msgpack';
import { describe, expect, it } from 'vitest';
import { questNbtMatches } from '../src/lib/nbt';
import { vendingQuestId } from '../src/lib/questbook/vending';
import { questUuid } from '../src/lib/questbook/types';
import type { QuestLinksData, QuestLinksVersions, QuestItemRelations } from '../src/lib/questbook/linksTypes';
import { questItemRelations } from '../tools/questbook/links';
import type { CatalogEntry } from '../src/lib/types';
import type { Quest, QuestPack } from '../src/lib/questbook/types';

describe('native quest matching',()=>{
  it('indexes choices, ignored NBT and ingredient-group membership without confusing materials',()=>{
    const item=(id:string,material:string):CatalogEntry=>({id,name:'Hammer',mod:'gregtech',internalName:'gt.metatool.01',damage:12,kind:'item',nbt:`{GT.ToolStats:{PrimaryMaterial:"${material}"}}`,tooltip:[],color:'#aaa',glyph:''});
    const iron=item('iron','Iron'),steel=item('steel','Steel');
    const group:CatalogEntry={...iron,id:'o:hammers',kind:'oreDict',members:['iron','steel']};
    const good={goodsId:iron.id,amount:1};
    const make=(id:string,ignore:boolean):Quest=>({id,name:id,description:'',icon:good,main:false,secret:false,counted:true,logic:'AND',taskLogic:'AND',requirements:[],
      tasks:[{type:'retrieval',title:'Retrieval',items:[good],lines:[],quests:[],nbtMatch:ignore?'ignore':'exact'}],
      rewards:ignore?[]:[{type:'choice',title:'Choice reward',items:[good],lines:[],quests:[]}]});
    const pack={quests:[make('any',true),make('iron-only',false)]} as QuestPack;
    const entries=new Map([iron,steel,group].map(entry=>[entry.id,entry]));
    const relations=questItemRelations(pack,entries,new Map([[good,{item:'gregtech:gt.metatool.01',damage:12,count:1,ore:'',fluid:false,nbt:iron.nbt!}]]));
    expect(relations.get('steel')?.usages).toEqual(['any']);
    expect(relations.get('iron')?.usages).toEqual(['any','iron-only']);
    expect(relations.get('iron')?.recipes).toEqual(['iron-only']);
    expect(relations.get('steel')?.recipes).toEqual([]);
    expect(relations.get('o:hammers')?.recipes).toEqual(['iron-only']);
    expect(relations.get('iron')?.goods?.['iron-only'].recipes).toEqual([{...good,tooltipNotes:['Choice reward']}]);
    expect(relations.get('steel')?.goods?.any.usages).toEqual([{...good,goodsId:'steel'}]);
    expect(relations.get('o:hammers')?.goods?.['iron-only'].recipes).toEqual(relations.get('iron')?.goods?.['iron-only'].recipes);
  });
  it('uses named compound fields, unordered lists and compatible numeric tag widths',()=>{
    expect(questNbtMatches('{material:"Iron",ench:[0:{id:16s,lvl:1s}]}','{ench:[0:{lvl:1,id:16},1:{id:20s,lvl:1s}],material:"Iron",Mode:0b}',true)).toBe(true);
    expect(questNbtMatches('{material:"Iron"}','{material:"Steel"}',true)).toBe(false);
    expect(questNbtMatches('{ench:[0:{id:16s}]}','{ench:[0:{id:16s},1:{id:20s}]}',false)).toBe(false);
    expect(questNbtMatches(undefined,'{material:"Iron"}',true)).toBe(false);
    expect(questNbtMatches('{n:9223372036854775807L}','{n:9223372036854775806L}',true)).toBe(false);
  });
  it('reads complete signed BQ condition UUIDs without rounding',()=>{
    expect(vendingQuestId({type:'BQCondition',nbt:'{questIDLow:479L,questIDHigh:0L}'})).toBe(questUuid(0,479));
    expect(vendingQuestId({type:'com.cubefury.vendingmachine.integration.betterquesting.BqCondition',nbt:'{name:"betterquesting",quest:{questIDLow:1148L,questIDHigh:0L}}'})).toBe(questUuid(0,1148));
    expect(vendingQuestId({type:'BQCondition',nbt:'{questIDLow:-9223372036854775808L,questIDHigh:9223372036854775807L}'})).toBe(questUuid('9223372036854775807','-9223372036854775808'));
    expect(vendingQuestId({type:'OtherCondition',nbt:'{questIDLow:479L}'})).toBeUndefined();
  });
});

describe('generated quest companions',()=>{
  const versions=JSON.parse(readFileSync('public/quests/links-versions.json','utf8')) as QuestLinksVersions;
  const version=versions.versions[0];
  const read=(asset:{url:string;sha256:string;bytes:number})=>{
    const bytes=readFileSync(new URL(asset.url,new URL('../public/quests/links-versions.json',import.meta.url)));
    expect(bytes.length).toBe(asset.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    return decode(gunzipSync(bytes));
  };
  const root=read(version.root) as QuestLinksData;
  it('binds lightweight previews to the recipe release, with verified lazy relations',()=>{
    const recipes=JSON.parse(readFileSync('public/versions-v7.json','utf8'));
    expect(root.recipeDatasetId).toBe(recipes.versions.find((row:{gtnhVersion:string})=>row.gtnhVersion==='2.9.0').datasetId);
    expect(root.quests).toHaveLength(3814);
    expect(root.quests.every(quest=>quest.description===''&&quest.rewards.length===0)).toBe(true);
    const ids=new Set(root.quests.map(quest=>quest.id));
    const all=new Map<string,QuestItemRelations>();
    for(const asset of Object.values(root.buckets)) for(const [id,row] of Object.entries(read(asset) as Record<string,QuestItemRelations>)) {
      expect([...row.recipes,...row.usages].every(id=>ids.has(id))).toBe(true);all.set(id,row);
    }
    expect(all.get('i:minecraft:apple:0')?.recipes).toContain(questUuid(0,0));
    expect(all.get('i:gregtech:gt.metatool.01:12:303388477f39f6c9ee5460198b32269e81610dd3')?.usages).toContain(questUuid(0,36));
    expect(root.items.some(item=>item.id===root.bookId&&item.icon)).toBe(true);
  });
  it('keeps navigation icon pixels traceable to real exported sprites',()=>{
    const provenance=JSON.parse(readFileSync('assets/source/navigation-icons/provenance.json','utf8'));
    expect(provenance.icons.map((icon:{name:string})=>icon.name)).toEqual(['items','finder','quests']);
    for(const icon of provenance.icons) expect(createHash('sha256').update(readFileSync(`public/assets/navigation/${icon.name}.png`)).digest('hex')).toBe(icon.sha256);
  });
});
