import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { decode } from '@msgpack/msgpack';
import sharp from 'sharp';
import { readLogicalAsset } from '../pack-builder/recordPages';
import type { GeneratedPackManifest } from '../pack-builder/manifest';
import type { PackedGoods } from '../../src/lib/datasetSchema';

const [packPath, sourcePath] = process.argv.slice(2);
if (!packPath || !sourcePath) throw new Error('Usage: tsx tools/high-resolution-icons/build.ts <published-pack> <recovered-sources>');
const root = resolve('.');
const store = join(root, 'public/assets/sha256');
const sources = JSON.parse(await readFile(join(sourcePath,'sources.json'),'utf8')) as {
  spriteSize:number; scriptSha256:string; imagesSha256:string; goods:Record<string,string>; unavailable:string[];
};
if (sources.spriteSize !== 64) throw new Error('Requires original 64px source renders');
const manifestBytes = await readFile(join(packPath,'pack-manifest.json'));
const manifest = JSON.parse(manifestBytes.toString()) as GeneratedPackManifest;
if (manifest.gtnhVersion !== '2.9.0') throw new Error('Source export is pinned to GTNH 2.9.0');
const sha = (bytes:Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sheets = new Map(manifest.iconSheets.flatMap(sheet => [[sheet.id,sheet.sha256],[sheet.sha256.slice(0,16),sheet.sha256]]));
const groups = new Map<string, Array<{id:string; index:number; source:string}>>();
const missing:string[] = [];
for (const descriptor of manifest.catalogAssets.filter(asset => asset.role === 'goods')) {
  const catalog = decode(await readLogicalAsset(descriptor,manifest,store)) as {goods:PackedGoods[]};
  for (const goods of catalog.goods) {
    if (!goods.icon) continue;
    const sheet = sheets.get(goods.icon.sheetId);
    const source = sources.goods[goods.id];
    if (!sheet || !source) { missing.push(goods.id); continue; }
    const rows = groups.get(sheet) ?? [];
    rows.push({id:goods.id,index:goods.icon.index,source}); groups.set(sheet,rows);
  }
}
const unexpected = missing.filter(id=>!sources.unavailable.includes(id));
if (unexpected.length) throw new Error(`Missing source identities (${unexpected.length}): ${unexpected.slice(0,20).join(', ')}`);
if (missing.length) console.log(`${missing.length} published goods have no original PNG; retaining their existing 32px fallback`);
console.log(`Matched ${[...groups.values()].reduce((n,rows)=>n+rows.length,0)} published goods to original PNG identities`);
type Descriptor = {sha256:string; bytes:number};
type Cell = [number,number];
const assets:Descriptor[] = [];
const writeAsset = async (bytes:Buffer):Promise<Descriptor> => {
  const hash = sha(bytes); const path = join(store,hash);
  try { await writeFile(path,bytes,{flag:'wx'}); }
  catch(error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || sha(await readFile(path)) !== hash) throw error;
  }
  const result = {sha256:hash,bytes:bytes.length}; assets.push(result); return result;
};
const pages:Descriptor[] = [];
const pending:Buffer[] = [];
const pixels = new Map<string,Cell>();
const originals = new Map<string,Cell>();
let unique = 0;
const flush = async () => {
  if (!pending.length) return;
  const rgba = Buffer.alloc(512*512*4);
  for (const [index,pixel] of pending.entries()) for (let row=0;row<64;row++) {
    pixel.copy(rgba,(((Math.floor(index/8)*64+row)*512)+(index%8)*64)*4,row*256,(row+1)*256);
  }
  const image = await sharp(rgba,{raw:{width:512,height:512,channels:4}}).webp({lossless:true,effort:4}).toBuffer();
  const restored = await sharp(image).ensureAlpha().raw().toBuffer();
  for (let i=0;i<restored.length;i+=4) if (restored[i+3]===0) restored.fill(0,i,i+3);
  if (!restored.equals(rgba)) {
    const first = rgba.findIndex((value,index)=>restored[index]!==value);
    const pixel = first-first%4;
    throw new Error(`High-resolution sheet changed RGBA at ${pixel}: ${[...rgba.subarray(pixel,pixel+4)]} -> ${[...restored.subarray(pixel,pixel+4)]}`);
  }
  pages.push(await writeAsset(image)); pending.length=0;
};
const lookups:Record<string,Descriptor> = {};
const deferred:Array<{low:string; cells:Record<string,Cell>; owners:Record<string,Cell>}> = [];
for (const low of [...groups.keys()].sort()) {
  const rows = groups.get(low)!.sort((a,b)=>a.index-b.index || (a.id<b.id?-1:a.id>b.id?1:0));
  const candidates = new Map<number,Array<{id:string; cell:Cell}>>();
  for (const row of rows) {
    let cell = originals.get(row.source);
    if (!cell) {
      const png = await readFile(join(sourcePath,'png',`${row.source}.png`));
      if (sha(png) !== row.source) throw new Error(`Corrupt original PNG: ${row.id}`);
      const decoded = await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      if (decoded.info.width!==64 || decoded.info.height!==64) throw new Error(`Unexpected source size: ${row.id}`);
      // Transparent RGB is invisible and WebP normalizes it; visible pixels stay exact.
      for (let i=0;i<decoded.data.length;i+=4) if (decoded.data[i+3]===0) decoded.data.fill(0,i,i+3);
      const hash = sha(decoded.data);
      cell = pixels.get(hash);
      if (!cell) {
        cell = [Math.floor(unique/64),unique%64]; unique++;
        pixels.set(hash,cell); pending.push(decoded.data);
        if (pending.length===64) await flush();
      }
      originals.set(row.source,cell);
    }
    const values = candidates.get(row.index) ?? [];
    values.push({id:row.id,cell}); candidates.set(row.index,values);
  }
  const cells:Record<string,Cell> = {}, owners:Record<string,Cell> = {};
  for (const [index,values] of candidates) {
    if (values.every(value=>value.cell===values[0]!.cell)) cells[index]=values[0]!.cell;
    else for (const value of values) owners[value.id]=value.cell;
  }
  deferred.push({low,cells,owners});
  if (deferred.length%10===0) console.log(`Processed ${deferred.length}/${groups.size} base sheets; ${unique} unique original sprites`);
}
await flush();
for (const {low,cells,owners} of deferred) {
  const used = [...new Set([...Object.values(cells),...Object.values(owners)].map(cell=>cell[0]))].sort((a,b)=>a-b);
  const local = new Map(used.map((id,index)=>[id,index]));
  const remap = (rows:Record<string,Cell>) => Object.fromEntries(Object.entries(rows).map(([key,[page,index]])=>[key,[local.get(page)!,index]]));
  const lookup = {schemaVersion:1,datasetId:manifest.datasetId,lowSheet:low,columns:8,spriteSize:64,
    pages:used.map(id=>pages[id]!),cells:remap(cells),owners:remap(owners)};
  lookups[low]=await writeAsset(gzipSync(JSON.stringify(lookup),{level:9}));
}
const descriptor = await writeAsset(gzipSync(JSON.stringify({schemaVersion:1,datasetId:manifest.datasetId,unavailable:missing,lookups}),{level:9}));
const registry = {schemaVersion:1,releases:{[manifest.datasetId]:descriptor}};
await mkdir(join(root,'src/lib/generated'),{recursive:true});
await writeFile(join(root,'src/lib/generated/high-resolution-icons.json'),JSON.stringify(registry)+'\n');
const provenance = {schemaVersion:1,datasetId:manifest.datasetId,baseManifestSha256:sha(manifestBytes),
  sourceImagesSha256:sources.imagesSha256,sourceDatabaseSha256:sources.scriptSha256,
  originalSpriteSize:64,columns:8,rows:8,uniqueSprites:unique,sheets:pages.length,
  goods:[...groups.values()].reduce((n,rows)=>n+rows.length,0),unavailableGoods:missing,assets,root:descriptor};
await mkdir(join(root,'assets/source/high-resolution-icons'),{recursive:true});
await writeFile(join(root,'assets/source/high-resolution-icons/provenance.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({sprites:unique,sheets:pages.length,assets:assets.length,bytes:assets.reduce((n,a)=>n+a.bytes,0),root:descriptor}));
