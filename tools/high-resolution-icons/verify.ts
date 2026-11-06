import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decode } from '@msgpack/msgpack';
import sharp from 'sharp';
import { readLogicalAsset } from '../pack-builder/recordPages';
import type { GeneratedPackManifest } from '../pack-builder/manifest';
import type { PackedGoods } from '../../src/lib/datasetSchema';

const [pack,source] = process.argv.slice(2);
if (!pack || !source) throw new Error('Usage: tsx tools/high-resolution-icons/verify.ts <published-pack> <recovered-sources>');
const store = 'public/assets/sha256';
interface Descriptor {sha256:string;bytes:number}
interface Lookup {datasetId:string;lowSheet:string;columns:number;spriteSize:number;pages:Descriptor[];cells:Record<string,[number,number]>;owners:Record<string,[number,number]>}
const provenance = JSON.parse(await readFile('assets/source/high-resolution-icons/provenance.json','utf8')) as {
  datasetId:string;baseManifestSha256:string;assets:Descriptor[];root:Descriptor;goods:number;unavailableGoods:string[];
};
const hash = (bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const assets = new Map<string,Buffer>();
for (const asset of provenance.assets) {
  const bytes = await readFile(join(store,asset.sha256));
  assert.equal(bytes.length,asset.bytes);assert.equal(hash(bytes),asset.sha256);assets.set(asset.sha256,bytes);
}
const manifestBytes = await readFile(join(pack,'pack-manifest.json'));
assert.equal(hash(manifestBytes),provenance.baseManifestSha256);
const manifest = JSON.parse(manifestBytes.toString()) as GeneratedPackManifest;
assert.equal(manifest.datasetId,provenance.datasetId);
const registry = JSON.parse(await readFile('src/lib/generated/high-resolution-icons.json','utf8'));
assert.deepEqual(registry.releases[manifest.datasetId],provenance.root);
const root = JSON.parse(gunzipSync(assets.get(provenance.root.sha256)!).toString()) as {datasetId:string;lookups:Record<string,Descriptor>;unavailable:string[]};
assert.equal(root.datasetId,manifest.datasetId);assert.deepEqual(root.unavailable,provenance.unavailableGoods);
const lookups = new Map<string,Lookup>();
for (const [low,descriptor] of Object.entries(root.lookups)) {
  const lookup = JSON.parse(gunzipSync(assets.get(descriptor.sha256)!).toString()) as Lookup;
  assert.equal(lookup.datasetId,manifest.datasetId);assert.equal(lookup.lowSheet,low);
  assert.equal(lookup.columns,8);assert.equal(lookup.spriteSize,64);
  for (const [page,index] of [...Object.values(lookup.cells),...Object.values(lookup.owners)]) {
    assert(Number.isSafeInteger(page)&&Number.isSafeInteger(index)&&index>=0&&index<64);
    assert(lookup.pages[page]&&assets.has(lookup.pages[page]!.sha256));
  }
  lookups.set(low,lookup);
}
const original = JSON.parse(await readFile(join(source,'sources.json'),'utf8')) as {goods:Record<string,string>};
const sheets = new Map(manifest.iconSheets.flatMap(sheet=>[[sheet.id,sheet.sha256],[sheet.sha256.slice(0,16),sheet.sha256]]));
const decoded = new Map<string,Buffer>();
const normalize = (pixels:Buffer) => {for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]===0)pixels.fill(0,i,i+3);return pixels;};
let owners=0,samples=0;
for (const descriptor of manifest.catalogAssets.filter(asset=>asset.role==='goods')) {
  const catalog = decode(await readLogicalAsset(descriptor,manifest,store)) as {goods:PackedGoods[]};
  for (const goods of catalog.goods) {
    if (!goods.icon || provenance.unavailableGoods.includes(goods.id)) continue;
    const lookup = lookups.get(sheets.get(goods.icon.sheetId)!)!;
    assert(lookup,goods.id);
    const cell = lookup.owners[goods.id]??lookup.cells[String(goods.icon.index)];assert(cell,goods.id);owners++;
    if (owners%1000!==0 && !['i:gregtech:gt.blockmachines:2729','i:gregtech:gt.blockmachines:1126'].includes(goods.id)
      && !goods.id.startsWith('i:TConstruct:BoltPart:1538:')) continue;
    const [page,index] = cell;
    const image = lookup.pages[page]!;
    let pixels = decoded.get(image.sha256);
    if (!pixels) {
      const result = await sharp(assets.get(image.sha256)!).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      assert.equal(result.info.width,512);assert.equal(result.info.height,512);
      pixels=normalize(result.data);decoded.set(image.sha256,pixels);
    }
    const actual = Buffer.alloc(64*64*4);
    for(let row=0;row<64;row++) {
      const offset=((Math.floor(index/8)*64+row)*512+(index%8)*64)*4;
      pixels.copy(actual,row*256,offset,offset+256);
    }
    const png = await readFile(join(source,'png',`${original.goods[goods.id]}.png`));
    assert.equal(hash(png),original.goods[goods.id]);
    const expected = normalize(await sharp(png).ensureAlpha().raw().toBuffer());
    assert(actual.equals(expected),`Original 64px pixels do not match published crop: ${goods.id}`);samples++;
  }
}
assert.equal(owners,provenance.goods);
console.log(JSON.stringify({assets:assets.size,owners,originalPixelSamples:samples,baseManifestUnchanged:true}));
