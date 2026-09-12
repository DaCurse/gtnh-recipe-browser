#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { decode, encode } from '@msgpack/msgpack';
import sharp from 'sharp';
import { readLogicalAsset } from '../pack-builder/recordPages';
import type { GeneratedPackManifest, ImmutableAsset } from '../pack-builder/manifest';
import { sharedIconPixelHash } from '../pack-builder/sharedIcons';

type JsonObject = Record<string, unknown>;
type PackAsset = {
  id: string;
  url: string;
  bytes: number;
  sha256: string;
  encoding: 'gzip' | 'identity';
  [key: string]: unknown;
};
type PackManifest = {
  formatVersion: number;
  recordPages?: PackAsset[];
  datasetId: string;
  gtnhVersion: string;
  revision: string;
  catalogAssets: PackAsset[];
  recipeShards: PackAsset[];
  specialDataShards: PackAsset[];
  iconSheets: PackAsset[];
  totals: { offlineBytes: number; assets: number };
};

const RECIPE_TARGET_BYTES = 512 * 1024;
const GOODS_TARGET_BYTES = 512 * 1024;
const SPECIAL_TARGET_BYTES = 256 * 1024;
const MAX_PREFIX_NIBBLES = 8;
const U64_MASK = (1n << 64n) - 1n;

interface RecordValue {
  id: string;
  namespace: string;
  value: unknown;
  canonical: string;
}

interface RecordSet {
  name: string;
  records: Map<string, RecordValue>;
}

interface LoadedPack {
  name: string;
  directory: string;
  manifest: PackManifest;
  assets: PackAsset[];
  recordSets: RecordSet[];
  icons: Map<string, string>;
  canonicalCore: string;
}

interface BlobValue {
  logicalId: string;
  namespace: string;
  records: unknown[];
}

interface SimulatedChunk {
  logicalId: string;
  namespace: string;
  bytes: Buffer;
  recordCount: number;
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableValue(value: unknown, stripKeys = new Set<string>()): unknown {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry, stripKeys));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .filter(([key, child]) => !stripKeys.has(key) && child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child, stripKeys)])
  );
}

function stableJson(value: unknown, stripKeys = new Set<string>()): string {
  return JSON.stringify(stableValue(value, stripKeys));
}

function stableRecipeTypeId(value: JsonObject): string {
  const category = value.category;
  const name = value.name;
  if (typeof category !== 'string' || typeof name !== 'string') {
    throw new Error(`Recipe type ${String(value.id)} is missing typed category/name identity`);
  }
  return `recipeType:${encodeURIComponent(category)}:${encodeURIComponent(name)}`;
}

function localAssetFilename(asset: PackAsset): string {
  return basename(new URL(asset.url, 'https://analysis.invalid/').pathname);
}

function localAssetPath(directory: string, asset: PackAsset, assetDirectory?: string): string {
  return resolve(assetDirectory ?? resolve(directory, 'assets', 'sha256'), localAssetFilename(asset));
}

async function readDecodedAsset(directory: string, asset: PackAsset, assetDirectory?: string, manifest?: PackManifest): Promise<unknown> {
  if (manifest?.formatVersion === 6) {
    return decode(await readLogicalAsset(asset as unknown as ImmutableAsset, manifest as unknown as GeneratedPackManifest,
      assetDirectory ?? resolve(directory, 'assets', 'sha256')));
  }
  const bytes = await readFile(localAssetPath(directory, asset, assetDirectory));
  const decoded = asset.encoding === 'gzip' ? gunzipSync(bytes) : bytes;
  return decode(decoded);
}

function recordSet(
  name: string,
  records: Iterable<{ id: string; namespace?: string; value: unknown }>,
  stripKeys = new Set<string>(),
  normalize?: (value: unknown) => unknown
): RecordSet {
  const result = new Map<string, RecordValue>();
  for (const record of records) {
    const value = normalize ? normalize(record.value) : record.value;
    const canonical = stableJson(value, stripKeys);
    result.set(record.id, {
      id: record.id,
      namespace: record.namespace ?? '',
      value,
      canonical
    });
  }
  return { name, records: result };
}

function assetGroups(manifest: PackManifest): PackAsset[] {
  if (manifest.recordPages) return [...manifest.recordPages, ...manifest.iconSheets];
  return [
    ...manifest.catalogAssets,
    ...manifest.recipeShards,
    ...(manifest.specialDataShards ?? []),
    ...manifest.iconSheets
  ];
}

async function loadIcons(
  directory: string,
  descriptors: PackAsset[],
  assetDirectory?: string,
  ownerIcons?: Array<{ id: string; icon: { sheetId: string; index: number } | null }>
): Promise<Map<string, string>> {
  const icons = new Map<string, string>();
  const sheets = new Map<string, { descriptor: PackAsset; data: Buffer; width: number }>();
  for (const descriptor of descriptors) {
    const firstIcon = Number(descriptor.firstIcon ?? 0);
    const iconCount = Number(descriptor.iconCount ?? 0);
    const columns = Number(descriptor.columns ?? 32);
    const spriteSize = Number(descriptor.spriteSize ?? 32);
    const bytes = await readFile(localAssetPath(directory, descriptor, assetDirectory));
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    sheets.set(descriptor.id, { descriptor, data, width: info.width });
    if (ownerIcons) continue;
    for (let localIcon = 0; localIcon < iconCount; localIcon++) {
      const sprite = Buffer.alloc(spriteSize * spriteSize * 4);
      const x = (localIcon % columns) * spriteSize;
      const y = Math.floor(localIcon / columns) * spriteSize;
      for (let row = 0; row < spriteSize; row++) {
        const sourceStart = ((y + row) * info.width + x) * 4;
        data.copy(sprite, row * spriteSize * 4, sourceStart, sourceStart + spriteSize * 4);
      }
      icons.set(String(firstIcon + localIcon), sharedIconPixelHash(sprite));
    }
  }
  for (const { id, icon } of ownerIcons ?? []) {
    if (!icon) continue;
    const sheet = sheets.get(icon.sheetId);
    if (!sheet) throw new Error(`Missing icon sheet ${icon.sheetId} for ${id}`);
    const spriteSize = Number(sheet.descriptor.spriteSize ?? 32);
    const columns = Number(sheet.descriptor.columns ?? 32);
    const sprite = Buffer.alloc(spriteSize * spriteSize * 4);
    const x = icon.index % columns * spriteSize;
    const y = Math.floor(icon.index / columns) * spriteSize;
    for (let row = 0; row < spriteSize; row++) {
      const start = ((y + row) * sheet.width + x) * 4;
      sheet.data.copy(sprite, row * spriteSize * 4, start, start + spriteSize * 4);
    }
    icons.set(id, sharedIconPixelHash(sprite));
  }
  return icons;
}

async function loadPack(directoryArgument: string, name: string, assetDirectory?: string): Promise<LoadedPack> {
  const directory = resolve(directoryArgument);
  const manifest = JSON.parse(await readFile(resolve(directory, 'pack-manifest.json'), 'utf8')) as PackManifest;
  const assets = assetGroups(manifest);
  const catalogs = await Promise.all(manifest.catalogAssets.map(async (asset) => ({
    asset,
    value: await readDecodedAsset(directory, asset, assetDirectory, manifest) as JsonObject
  })));
  const core = catalogs.find(({ value }) => value.kind === 'core')?.value ?? {};
  const goods = catalogs
    .filter(({ value }) => value.kind === 'goods')
    .flatMap(({ value }) => Array.isArray(value.goods) ? value.goods : []);
  const goodsMetadata = catalogs
    .filter(({ value }) => value.kind === 'goodsMetadata')
    .flatMap(({ value }) => Array.isArray(value.goods) ? value.goods : []);
  const recipeTypes = catalogs.flatMap(({ value }) => Array.isArray(value.recipeTypes) ? value.recipeTypes : []);
  const oreDictionaries = catalogs.flatMap(({ value }) => Array.isArray(value.oreDictionaries) ? value.oreDictionaries : []);
  const ingredientGroups = catalogs.flatMap(({ value }) => Array.isArray(value.ingredientGroups) ? value.ingredientGroups : []);
  const serviceIcons = catalogs.flatMap(({ value }) => Array.isArray(value.specialServiceIcons) ? value.specialServiceIcons : []);
  const specialViews = catalogs.flatMap(({ value }) => Array.isArray(value.specialViewTypes) ? value.specialViewTypes : []);
  const ownerIcons = catalogs.flatMap(({ value }) => Array.isArray(value.icons)
    ? value.icons as Array<{ id: string; icon: { sheetId: string; index: number } | null }>
    : []);
  const recipeTypeIds = new Map<string, string>();
  for (const value of recipeTypes) {
    const sourceId = String((value as JsonObject).id);
    const stableId = stableRecipeTypeId(value as JsonObject);
    recipeTypeIds.set(sourceId, stableId);
    recipeTypeIds.set(stableId, stableId);
  }
  const obsoleteRecipeRemaps = catalogs
    .find(({ value }) => value.kind === 'recipeRemaps')?.value.obsoleteRecipeRemaps ?? core.obsoleteRecipeRemaps ?? {};
  const recipeShards = await Promise.all(manifest.recipeShards.map(async (asset) => ({
    asset,
    value: await readDecodedAsset(directory, asset, assetDirectory, manifest) as JsonObject
  })));
  const recipes = recipeShards.flatMap(({ asset, value }) =>
    (Array.isArray(value.recipes) ? value.recipes : []).map((recipe) => ({
      id: String((recipe as JsonObject).id),
      namespace: recipeTypeIds.get(String(asset.recipeTypeId ?? (recipe as JsonObject).recipeTypeId ?? ''))
        ?? String(asset.recipeTypeId ?? (recipe as JsonObject).recipeTypeId ?? ''),
      value: {
        ...(recipe as JsonObject),
        recipeTypeId: recipeTypeIds.get(String((recipe as JsonObject).recipeTypeId ?? asset.recipeTypeId ?? ''))
          ?? String((recipe as JsonObject).recipeTypeId ?? asset.recipeTypeId ?? '')
      }
    }))
  );
  const specialShards = await Promise.all((manifest.specialDataShards ?? []).map(async (asset) => ({
    asset,
    value: await readDecodedAsset(directory, asset, assetDirectory, manifest) as JsonObject
  })));
  const specialRecords = specialShards.flatMap(({ asset, value }) =>
    (Array.isArray(value.records) ? value.records : []).map((record) => ({
      id: String((record as JsonObject).id),
      namespace: String(asset.specialViewTypeId ?? (record as JsonObject).category ?? ''),
      value: record
    }))
  );
  const catalogGoods = recordSet(
    'goods',
    goods.map((value) => ({ id: String((value as JsonObject).id), value })),
    new Set([
      'productionShards',
      'usageShards',
      'productionCount',
      'usageCount',
      'specialProductionShards',
      'specialUsageShards',
      'specialProductionLookupIds',
      'specialUsageLookupIds',
      'specialProductionCount',
      'specialUsageCount',
      'icon'
    ])
  );
  const catalogGoodsMetadata = recordSet(
    'goods-metadata',
    goodsMetadata.map((value) => ({ id: String((value as JsonObject).id), value })),
  );
  const recipeSet = recordSet('recipes', recipes);
  const specialSet = recordSet('special', specialRecords);
  const typeSet = recordSet(
    'recipe-types',
    recipeTypes.map((value) => ({
      id: recipeTypeIds.get(String((value as JsonObject).id)) ?? stableRecipeTypeId(value as JsonObject),
      value: {
        ...(value as JsonObject),
        id: recipeTypeIds.get(String((value as JsonObject).id)) ?? stableRecipeTypeId(value as JsonObject)
      }
    })),
    new Set(['order'])
  );
  const oreSet = recordSet(
    'ore-dictionaries',
    oreDictionaries.map((value) => ({ id: String((value as JsonObject).id), value })),
    new Set([
      'specialProductionShards',
      'specialUsageShards',
      'specialProductionLookupIds',
      'specialUsageLookupIds',
      'specialProductionCount',
      'specialUsageCount'
    ])
  );
  const groupSet = recordSet(
    'ingredient-groups',
    ingredientGroups.map((value) => ({ id: String((value as JsonObject).id), value })),
    new Set([
      'specialProductionShards',
      'specialUsageShards',
      'specialProductionLookupIds',
      'specialUsageLookupIds',
      'specialProductionCount',
      'specialUsageCount'
    ])
  );
  const catalogValue = {
    recipeTypes: typeSet.records,
    oreDictionaries: oreSet.records,
    ingredientGroups: groupSet.records,
    serviceItemIds: core.serviceItemIds ?? [],
    obsoleteRecipeRemaps,
    specialViewTypes: specialViews,
    specialServiceIcons: serviceIcons
  };
  return {
    name,
    directory,
    manifest,
    assets,
    recordSets: [catalogGoods, catalogGoodsMetadata, recipeSet, specialSet, typeSet, oreSet, groupSet],
    icons: await loadIcons(directory, manifest.iconSheets, assetDirectory, manifest.formatVersion === 6 ? ownerIcons : undefined),
    canonicalCore: stableJson(catalogValue, new Set(['order', 'icon']))
  };
}

function diffRecords(left: RecordSet, right: RecordSet) {
  const ids = new Set([...left.records.keys(), ...right.records.keys()]);
  let identical = 0;
  let modified = 0;
  let added = 0;
  let removed = 0;
  let sharedCanonicalBytes = 0;
  let sharedCompressedBytes = 0;
  const common: unknown[] = [];
  for (const id of ids) {
    const a = left.records.get(id);
    const b = right.records.get(id);
    if (!a) {
      added++;
    } else if (!b) {
      removed++;
    } else if (a.canonical === b.canonical) {
      identical++;
      sharedCanonicalBytes += Buffer.byteLength(a.canonical);
      common.push(JSON.parse(a.canonical));
      sharedCompressedBytes += gzipSize(encode(JSON.parse(a.canonical)));
    } else {
      modified++;
    }
  }
  return {
    left: left.records.size,
    right: right.records.size,
    commonIds: identical + modified,
    identical,
    modified,
    added,
    removed,
    identicalPercentOfRight: percentage(identical, right.records.size),
    sharedCanonicalBytes,
    sharedCompressedBytes,
    sharedCollectionCompressedBytes: gzipSize(Buffer.from(stableJson(common), 'utf8'))
  };
}

function gzipSize(value: Uint8Array): number {
  return gzipSync(value).byteLength;
}

function percentage(value: number, total: number): number {
  return total === 0 ? 100 : Math.round(value / total * 10_000) / 100;
}

function compareHashes(left: Map<string, string>, right: Map<string, string>) {
  const ids = new Set([...left.keys(), ...right.keys()]);
  let identical = 0;
  let modified = 0;
  let added = 0;
  let removed = 0;
  for (const id of ids) {
    const a = left.get(id);
    const b = right.get(id);
    if (a === undefined) added++;
    else if (b === undefined) removed++;
    else if (a === b) identical++;
    else modified++;
  }
  return {
    left: left.size,
    right: right.size,
    identical,
    modified,
    added,
    removed,
    identicalPercentOfRight: percentage(identical, right.size)
  };
}

function contentAddressedAssetStats(left: LoadedPack, right: LoadedPack) {
  const leftHashes = new Map(left.assets.map((asset) => [asset.sha256, asset.bytes]));
  const rightHashes = new Map(right.assets.map((asset) => [asset.sha256, asset.bytes]));
  const sharedHashes = [...leftHashes.keys()].filter((hash) => rightHashes.has(hash));
  const union = new Map([...leftHashes, ...rightHashes]);
  const sharedBytes = sharedHashes.reduce((total, hash) => total + (rightHashes.get(hash) ?? 0), 0);
  const rightIncrementalBytes = [...rightHashes.entries()]
    .filter(([hash]) => !leftHashes.has(hash))
    .reduce((total, [, bytes]) => total + bytes, 0);
  return {
    leftLogicalBytes: left.manifest.totals.offlineBytes,
    rightLogicalBytes: right.manifest.totals.offlineBytes,
    separateLogicalBytes: left.manifest.totals.offlineBytes + right.manifest.totals.offlineBytes,
    currentUniqueBytesAcrossBoth: [...union.values()].reduce((total, bytes) => total + bytes, 0),
    currentDuplicateBytesAcrossBoth: left.manifest.totals.offlineBytes
      + right.manifest.totals.offlineBytes - [...union.values()].reduce((total, bytes) => total + bytes, 0),
    sharedBytes,
    rightIncrementalBytes,
    uniqueObjectCountAcrossBoth: union.size,
    sharedObjectCount: sharedHashes.length,
    rightAssetCount: right.assets.length,
    rightNewObjectCount: [...rightHashes.keys()].filter((hash) => !leftHashes.has(hash)).length
  };
}

function summarizeAssets(
  assets: readonly PackAsset[],
  recordPageHashes: ReadonlySet<string>
): Record<string, {
  count: number;
  bytes: number;
  minBytes: number;
  maxBytes: number;
}> {
  const result: Record<string, { count: number; bytes: number; minBytes: number; maxBytes: number }> = {};
  for (const asset of assets) {
    const kind = recordPageHashes.has(asset.sha256)
      ? 'recordPage'
      : asset.kind === 'catalog'
        ? String(asset.role ?? 'catalog')
        : String(asset.kind ?? 'unknown');
    const summary = result[kind] ??= { count: 0, bytes: 0, minBytes: Number.POSITIVE_INFINITY, maxBytes: 0 };
    summary.count++;
    summary.bytes += asset.bytes;
    summary.minBytes = Math.min(summary.minBytes, asset.bytes);
    summary.maxBytes = Math.max(summary.maxBytes, asset.bytes);
  }
  for (const summary of Object.values(result)) {
    if (!Number.isFinite(summary.minBytes)) summary.minBytes = 0;
  }
  return result;
}

function prefixFor(id: string, nibbles: number): string {
  return sha256(id).slice(0, nibbles);
}

function payloadBytes(logicalId: string, namespace: string, records: RecordValue[]): Buffer {
  const value: BlobValue = {
    logicalId,
    namespace,
    records: records
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((record) => JSON.parse(record.canonical))
  };
  return gzipSync(encode({ schemaVersion: 5, kind: 'records', ...value }));
}

function groupedRecords(records: Iterable<RecordValue>, nibbles: number): Map<string, RecordValue[]> {
  const result = new Map<string, RecordValue[]>();
  for (const record of records) {
    const prefix = prefixFor(`${record.namespace}\0${record.id}`, nibbles);
    const bucket = result.get(prefix) ?? [];
    bucket.push(record);
    result.set(prefix, bucket);
  }
  return result;
}

function choosePrefixDepth(records: RecordValue[], targetBytes: number): number {
  for (let nibbles = 0; nibbles <= MAX_PREFIX_NIBBLES; nibbles++) {
    const groups = groupedRecords(records, nibbles);
    const tooLarge = [...groups.entries()].some(([prefix, bucket]) =>
      payloadBytes(`probe/${prefix}`, bucket[0]?.namespace ?? '', bucket).byteLength > targetBytes
      && bucket.length > 1
    );
    if (!tooLarge) return nibbles;
  }
  return MAX_PREFIX_NIBBLES;
}

function combinedRecords(left: LoadedPack, right: LoadedPack, setName: string): RecordValue[] {
  const result = new Map<string, RecordValue>();
  for (const pack of [left, right]) {
    const set = pack.recordSets.find((candidate) => candidate.name === setName);
    for (const record of set?.records.values() ?? []) {
      result.set(`${record.namespace}\0${record.id}`, record);
    }
  }
  return [...result.values()];
}

function unionHashPrefixChunks(
  left: LoadedPack,
  right: LoadedPack,
  setName: string,
  targetBytes: number
) {
  const union = combinedRecords(left, right, setName);
  const byNamespace = new Map<string, RecordValue[]>();
  for (const record of union) {
    const bucket = byNamespace.get(record.namespace) ?? [];
    bucket.push(record);
    byNamespace.set(record.namespace, bucket);
  }
  const nibblesByNamespace: Record<string, number> = {};
  for (const [namespace, records] of byNamespace) {
    nibblesByNamespace[namespace] = choosePrefixDepth(records, targetBytes);
  }
  const make = (pack: LoadedPack): SimulatedChunk[] => {
    const set = pack.recordSets.find((candidate) => candidate.name === setName);
    const chunks: SimulatedChunk[] = [];
    const grouped = new Map<string, RecordValue[]>();
    for (const record of set?.records.values() ?? []) {
      const prefix = prefixFor(`${record.namespace}\0${record.id}`, nibblesByNamespace[record.namespace] ?? 0);
      const key = `${record.namespace}\0${prefix}`;
      const bucket = grouped.get(key) ?? [];
      bucket.push(record);
      grouped.set(key, bucket);
    }
    for (const [key, bucket] of grouped) {
      const [namespace, prefix] = key.split('\0');
      const logicalId = `${setName}/${namespace}/${prefix || 'root'}`;
      chunks.push({ logicalId, namespace, bytes: payloadBytes(logicalId, namespace, bucket), recordCount: bucket.length });
    }
    return chunks;
  };
  const leftChunks = make(left);
  const rightChunks = make(right);
  const leftHashes = new Map(leftChunks.map((chunk) => [chunk.logicalId, sha256(chunk.bytes)]));
  const rightHashes = new Map(rightChunks.map((chunk) => [chunk.logicalId, sha256(chunk.bytes)]));
  const shared = leftChunks.filter((chunk) => rightHashes.get(chunk.logicalId) === sha256(chunk.bytes));
  const rightIncremental = rightChunks.filter((chunk) => leftHashes.get(chunk.logicalId) !== sha256(chunk.bytes));
  const all = [...leftChunks, ...rightChunks];
  const max = Math.max(0, ...all.map((chunk) => chunk.bytes.byteLength));
  const min = all.length === 0 ? 0 : Math.min(...all.map((chunk) => chunk.bytes.byteLength));
  return {
    leftChunkCount: leftChunks.length,
    rightChunkCount: rightChunks.length,
    sharedChunkCount: shared.length,
    rightIncrementalChunkCount: rightIncremental.length,
    leftBytes: leftChunks.reduce((total, chunk) => total + chunk.bytes.byteLength, 0),
    rightBytes: rightChunks.reduce((total, chunk) => total + chunk.bytes.byteLength, 0),
    sharedBytes: shared.reduce((total, chunk) => total + chunk.bytes.byteLength, 0),
    rightIncrementalBytes: rightIncremental.reduce((total, chunk) => total + chunk.bytes.byteLength, 0),
    maxChunkBytes: max,
    minChunkBytes: min,
    nibblesByNamespace
  };
}

function cdcChunks(pack: LoadedPack, setName: string, targetBytes: number): SimulatedChunk[] {
  const set = pack.recordSets.find((candidate) => candidate.name === setName);
  if (!set) return [];
  const byNamespace = new Map<string, RecordValue[]>();
  for (const record of set.records.values()) {
    const bucket = byNamespace.get(record.namespace) ?? [];
    bucket.push(record);
    byNamespace.set(record.namespace, bucket);
  }
  const result: SimulatedChunk[] = [];
  for (const [namespace, records] of byNamespace) {
    records.sort((left, right) => left.id.localeCompare(right.id));
    const average = records.length === 0
      ? 1
      : records.reduce((total, record) => total + Buffer.byteLength(record.canonical), 0) / records.length;
    const maskBits = Math.max(1, Math.min(20, Math.round(Math.log2(Math.max(2, targetBytes / Math.max(1, average))))));
    const mask = (1n << BigInt(maskBits)) - 1n;
    let current: RecordValue[] = [];
    let currentBytes = 0;
    let rolling = 0n;
    for (const record of records) {
      current.push(record);
      currentBytes += Buffer.byteLength(record.canonical);
      const fingerprint = createHash('sha256').update(record.canonical).digest();
      for (let index = 0; index < 8; index++) {
        rolling = ((rolling << 8n) ^ BigInt(fingerprint[index]!)) & U64_MASK;
      }
      const minimum = targetBytes * 0.45;
      const boundary = current.length > 1
        && ((rolling & mask) === 0n && currentBytes >= minimum || currentBytes >= targetBytes);
      if (boundary) {
        const logicalId = `${setName}/${namespace}/cdc-${result.length}`;
        result.push({ logicalId, namespace, bytes: payloadBytes(logicalId, namespace, current), recordCount: current.length });
        current = [];
        currentBytes = 0;
        rolling = 0n;
      }
    }
    if (current.length > 0) {
      const logicalId = `${setName}/${namespace}/cdc-${result.length}`;
      result.push({ logicalId, namespace, bytes: payloadBytes(logicalId, namespace, current), recordCount: current.length });
    }
  }
  return result;
}

function cdcStats(left: LoadedPack, right: LoadedPack, setName: string, targetBytes: number) {
  const leftChunks = cdcChunks(left, setName, targetBytes);
  const rightChunks = cdcChunks(right, setName, targetBytes);
  const leftHashes = new Map(leftChunks.map((chunk) => [sha256(chunk.bytes), chunk]));
  const rightShared = rightChunks.filter((chunk) => leftHashes.has(sha256(chunk.bytes)));
  const rightNew = rightChunks.filter((chunk) => !leftHashes.has(sha256(chunk.bytes)));
  const all = [...leftChunks, ...rightChunks];
  return {
    leftChunkCount: leftChunks.length,
    rightChunkCount: rightChunks.length,
    sharedChunkCount: rightShared.length,
    rightIncrementalChunkCount: rightNew.length,
    leftBytes: leftChunks.reduce((total, chunk) => total + chunk.bytes.byteLength, 0),
    rightBytes: rightChunks.reduce((total, chunk) => total + chunk.bytes.byteLength, 0),
    sharedBytes: rightShared.reduce((total, chunk) => total + chunk.bytes.byteLength, 0),
    rightIncrementalBytes: rightNew.reduce((total, chunk) => total + chunk.bytes.byteLength, 0),
    maxChunkBytes: Math.max(0, ...all.map((chunk) => chunk.bytes.byteLength)),
    minChunkBytes: all.length === 0 ? 0 : Math.min(...all.map((chunk) => chunk.bytes.byteLength))
  };
}

function classStats(left: LoadedPack, right: LoadedPack, name: string) {
  const a = left.recordSets.find((set) => set.name === name);
  const b = right.recordSets.find((set) => set.name === name);
  return diffRecords(a ?? { name, records: new Map() }, b ?? { name, records: new Map() });
}

function changedFields(left: LoadedPack, right: LoadedPack, name: string): Record<string, number> {
  const a = left.recordSets.find((set) => set.name === name);
  const b = right.recordSets.find((set) => set.name === name);
  const changes = new Map<string, number>();
  for (const id of new Set([...a?.records.keys() ?? [], ...b?.records.keys() ?? []])) {
    const leftValue = a?.records.get(id)?.value;
    const rightValue = b?.records.get(id)?.value;
    if (leftValue === undefined || rightValue === undefined
      || leftValue === null || rightValue === null
      || typeof leftValue !== 'object' || typeof rightValue !== 'object'
      || Array.isArray(leftValue) || Array.isArray(rightValue)) continue;
    const keys = new Set([
      ...Object.keys(leftValue as JsonObject),
      ...Object.keys(rightValue as JsonObject)
    ]);
    for (const key of keys) {
      const leftField = (leftValue as JsonObject)[key];
      const rightField = (rightValue as JsonObject)[key];
      if (stableJson(leftField) !== stableJson(rightField)) {
        changes.set(key, (changes.get(key) ?? 0) + 1);
      }
    }
  }
  return Object.fromEntries([...changes.entries()].sort(([, leftCount], [, rightCount]) => rightCount - leftCount));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function markdown(report: JsonObject): string {
  const identity = report.identity as JsonObject;
  const current = report.currentContentAddressing as JsonObject;
  const records = report.records as Record<string, JsonObject>;
  const fieldChanges = (report.fieldChanges ?? {}) as Record<string, Record<string, number>>;
  const hashPrefix = ((report.proposals as JsonObject | undefined)?.hashPrefix ?? {}) as Record<string, JsonObject>;
  const cdc = ((report.proposals as JsonObject | undefined)?.recordAwareCdc ?? {}) as Record<string, JsonObject>;
  const lines = [
    '# Beta 2 / beta 3 shared-pack analysis',
    '',
    `Compared \`${String(identity.left)}\` and \`${String(identity.right)}\` (format ${String(identity.format)}).`,
    '',
    '## Current content-addressed reuse',
    '',
    `- Separate logical bytes: ${formatBytes(Number(current.separateLogicalBytes))}`,
    `- Unique bytes if exact asset hashes are shared: ${formatBytes(Number(current.currentUniqueBytesAcrossBoth))}`,
    `- Duplicate bytes in the current two private asset trees: ${formatBytes(Number(current.currentDuplicateBytesAcrossBoth))}`,
    `- Beta 3 incremental bytes after beta 2: ${formatBytes(Number(current.rightIncrementalBytes))}`,
    `- Shared objects: ${String(current.sharedObjectCount)} of ${String(current.uniqueObjectCountAcrossBoth)} unique objects`,
    '',
    '## Record-level differences',
    '',
    '| Class | Beta 2 | Beta 3 | Identical | Modified | Added | Removed |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(records).map(([name, rawStats]) => {
      const stats = rawStats as Record<string, number>;
      return `| ${name} | ${stats.left} | ${stats.right} | ${stats.identical} | ${stats.modified} | ${stats.added} | ${stats.removed} |`;
    }),
    '',
    '## Goods metadata field changes',
    '',
    '| Field | Records changed |',
    '| --- | ---: |',
    ...Object.entries(fieldChanges['goods-metadata'] ?? {}).map(([name, count]) => `| ${name} | ${count} |`),
    '',
    '## Proposed chunking simulations',
    '',
    '| Class | Scheme | B2 chunks | B3 chunks | Shared chunks | B3 incremental | Smallest chunk | Largest chunk |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(hashPrefix).map(([name, rawStats]) => {
      const stats = rawStats as Record<string, number>;
      return `| ${name} | hash-prefix | ${stats.leftChunkCount} | ${stats.rightChunkCount} | ${stats.sharedChunkCount} | ${formatBytes(Number(stats.rightIncrementalBytes))} | ${formatBytes(Number(stats.minChunkBytes))} | ${formatBytes(Number(stats.maxChunkBytes))} |`;
    }),
    ...Object.entries(cdc).map(([name, rawStats]) => {
      const stats = rawStats as Record<string, number>;
      return `| ${name} | record-aware CDC | ${stats.leftChunkCount} | ${stats.rightChunkCount} | ${stats.sharedChunkCount} | ${formatBytes(Number(stats.rightIncrementalBytes))} | ${formatBytes(Number(stats.minChunkBytes))} | ${formatBytes(Number(stats.maxChunkBytes))} |`;
    }),
    '',
    'The simulations use dataset-independent payloads without `datasetId` wrappers. Hash-prefix partitions use a union-derived layout; CDC boundaries are computed independently per dataset and always fall between complete records.',
    ''
  ];
  return `${lines.join('\n')}\n`;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const leftPath = argument('left');
const rightPath = argument('right');
if (!leftPath || !rightPath) {
  console.error('Usage: npm run analyze:pack-reuse -- --left <pack> --right <pack> [--asset-directory <global-store>] [--json <file>] [--markdown <file>]');
  process.exit(2);
}

const assetDirectory = argument('asset-directory');
const left = await loadPack(leftPath, 'beta-2', assetDirectory ? resolve(assetDirectory) : undefined);
const right = await loadPack(rightPath, 'beta-3', assetDirectory ? resolve(assetDirectory) : undefined);
const recordNames = [
  'goods',
  'goods-metadata',
  'recipes',
  'special',
  'recipe-types',
  'ore-dictionaries',
  'ingredient-groups'
];
const hashPrefix: Record<string, unknown> = {};
const recordAwareCdc: Record<string, unknown> = {};
const targets: Record<string, number> = {
  goods: GOODS_TARGET_BYTES,
  recipes: RECIPE_TARGET_BYTES,
  special: SPECIAL_TARGET_BYTES
};
for (const name of ['goods', 'recipes', 'special']) {
  hashPrefix[name] = unionHashPrefixChunks(left, right, name, targets[name]!);
  recordAwareCdc[name] = cdcStats(left, right, name, targets[name]!);
}

const report = {
  schemaVersion: 1,
  identity: {
    left: left.manifest.datasetId,
    right: right.manifest.datasetId,
    format: left.manifest.formatVersion
  },
  currentContentAddressing: contentAddressedAssetStats(left, right),
  currentAssets: {
    left: summarizeAssets(left.assets, new Set(left.manifest.recordPages?.map((asset) => asset.sha256))),
    right: summarizeAssets(right.assets, new Set(right.manifest.recordPages?.map((asset) => asset.sha256)))
  },
  records: Object.fromEntries(recordNames.map((name) => [name, classStats(left, right, name)])),
  fieldChanges: {
    'goods-metadata': changedFields(left, right, 'goods-metadata')
  },
  core: {
    identical: left.canonicalCore === right.canonicalCore,
    beta2CanonicalBytes: Buffer.byteLength(left.canonicalCore),
    beta3CanonicalBytes: Buffer.byteLength(right.canonicalCore),
    sharedCanonicalBytes: left.canonicalCore === right.canonicalCore
      ? Buffer.byteLength(left.canonicalCore)
      : 0
  },
  icons: compareHashes(left.icons, right.icons),
  proposals: {
    targetBytes: targets,
    hashPrefix,
    recordAwareCdc
  }
};

const jsonPath = argument('json');
if (jsonPath) await writeFile(resolve(jsonPath), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
const markdownPath = argument('markdown');
if (markdownPath) await writeFile(resolve(markdownPath), markdown(report), { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
