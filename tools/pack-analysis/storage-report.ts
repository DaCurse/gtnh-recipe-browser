#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decode } from '@msgpack/msgpack';
import type { GeneratedPackManifest } from '../pack-builder/manifest';
import { readLogicalAsset } from '../pack-builder/recordPages';
import { decodeRecordPage, recordPageSelections } from '../../src/lib/recordPages';
import { expandRelations, type PackedRelationList } from '../../src/lib/packedRelations';

const paths = process.argv.slice(2);
if (paths.length < 2) throw new Error('Usage: tsx tools/pack-analysis/storage-report.ts <pack-a> <pack-b> [...]');
const seen = new Map<string, number>();
let manifestBytes = 0;
const datasets = [];
let logicalReferencedBytes = 0;
for (const path of paths) {
  const bytes = await readFile(join(path, 'pack-manifest.json'));
  const manifest = JSON.parse(bytes.toString()) as GeneratedPackManifest;
  const assets = [...manifest.recordPages, ...manifest.iconSheets];
  const unique = new Map(assets.map((asset) => [asset.sha256, asset.bytes]));
  const incremental = [...unique].filter(([hash]) => !seen.has(hash));
  const fanout = manifest.recipeShards.map((shard) => new Set(recordPageSelections(shard).map(([hash]) => hash)).size).sort((a, b) => a - b);
  const bootstrapIndexes = new Set(manifest.catalogAssets.flatMap((asset) => recordPageSelections(asset).map(([index]) => index)));
  const detailFanout = manifest.goodsDetailShards.map((asset) => new Set(recordPageSelections(asset).map(([index]) => index)).size);
  const sizes = manifest.recordPages.map((page) => page.bytes).sort((a, b) => a - b);
  const decodedSizes = await Promise.all(manifest.recordPages.map(async (page) =>
    decodeRecordPage(gunzipSync(await readFile(join(path, 'assets', 'sha256', page.sha256))))
      .reduce((total, record) => total + record.byteLength, 0)
  ));
  const quantiles = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { min: sorted[0] ?? 0, median: sorted[Math.floor(sorted.length / 2)] ?? 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0, max: sorted.at(-1) ?? 0 };
  };
  const shardById = new Map(manifest.recipeShards.map((shard) => [shard.id, shard]));
  const groupProduction = new Map<string, string[]>();
  for (const descriptor of manifest.ingredientGroupShards) {
    const value = decode(await readLogicalAsset(descriptor, manifest, join(path, 'assets', 'sha256'))) as {
      ingredientGroups: Array<{ id: string; productionShards: string[] }>; lists?: PackedRelationList[];
    };
    for (const group of expandRelations(value.ingredientGroups, value.lists)) {
      groupProduction.set(group.id, group.productionShards);
    }
  }
  const lookupFanout = { recipes: [] as number[], usages: [] as number[] };
  for (const descriptor of manifest.goodsDetailShards) {
    const value = decode(await readLogicalAsset(descriptor, manifest, join(path, 'assets', 'sha256'))) as {
      goods: Array<{ id: string; productionShards: string[]; usageShards: string[];
        productionOreDictionaryId?: string }>; lists?: PackedRelationList[];
    };
    for (const goods of expandRelations(value.goods, value.lists)) {
      const production = goods.productionOreDictionaryId
        ? groupProduction.get(goods.productionOreDictionaryId) ?? [] : goods.productionShards;
      for (const [view, ids] of [['recipes', production], ['usages', goods.usageShards]] as const) {
        const pages = new Set(ids.flatMap((id) => {
          const shard = shardById.get(id);
          return shard ? recordPageSelections(shard).map(([index]) => index) : [];
        }));
        lookupFanout[view].push(pages.size);
      }
    }
  }
  const referencedAssetBytes = [...unique.values()].reduce((a, b) => a + b, 0);
  logicalReferencedBytes += referencedAssetBytes;
  datasets.push({ datasetId: manifest.datasetId, referencedAssetBytes,
    bootstrapBytes: [...bootstrapIndexes].reduce((sum, index) => sum + manifest.recordPages[index]!.bytes, 0),
    bootstrapPages: bootstrapIndexes.size, physicalPagesPerDetailPartition: quantiles(detailFanout),
    objects: unique.size, manifestBytes: bytes.length,
    incrementalObjects: incremental.length, incrementalAssetBytes: incremental.reduce((sum, [, size]) => sum + size, 0),
    incrementalStoredBytes: incremental.reduce((sum, [, size]) => sum + size, 0) + bytes.length,
    compressedPageBytes: quantiles(sizes), uncompressedPageBytes: quantiles(decodedSizes),
    oversizedSingletonPages: manifest.recordPages.filter((page) => page.oversizedSingleton).length,
    physicalPagesPerRecipeShard: quantiles(fanout), physicalPagesPerNonemptyGoodsLookup: {
      recipes: quantiles(lookupFanout.recipes.filter((value) => value > 0)),
      usages: quantiles(lookupFanout.usages.filter((value) => value > 0))
    },
    iconBytes: manifest.iconSheets.reduce((sum, asset) => sum + asset.bytes, 0), iconSheets: manifest.iconSheets.length });
  for (const [hash, size] of unique) seen.set(hash, size);
  manifestBytes += bytes.length;
}
const uniqueAssetBytes = [...seen.values()].reduce((a, b) => a + b, 0);
const referencedObjectCount = datasets.reduce((total, dataset) => total + dataset.objects, 0);
console.log(JSON.stringify({ datasets, uniqueObjects: seen.size,
  sharedObjectReferences: referencedObjectCount - seen.size,
  logicalReferencedBytes, uniqueAssetBytes,
  sharedAssetBytesSaved: logicalReferencedBytes - uniqueAssetBytes, manifestBytes,
  totalStoredBytes: uniqueAssetBytes + manifestBytes }, null, 2));
