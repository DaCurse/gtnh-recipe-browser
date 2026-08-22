import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decode } from '@msgpack/msgpack';
import sharp from 'sharp';
import type {
  CatalogAsset,
  GeneratedPackManifest,
  ImmutableAsset,
  SpecialDataShardAsset
} from './manifest';
import type { SpecialRecord } from './special';

const DEFAULT_MAX_SHARD_BYTES = 2 * 1024 * 1024;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function localFilename(asset: ImmutableAsset): string {
  return basename(new URL(asset.url, 'https://local.invalid/').pathname);
}

function specialRecordGoodsIds(record: SpecialRecord): string[] {
  const result = new Set<string>([
    ...record.goodsIds,
    ...(Array.isArray(record.productionGoodsIds) ? record.productionGoodsIds : []),
    ...(Array.isArray(record.usageGoodsIds) ? record.usageGoodsIds : [])
  ]);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.endsWith('goodsid') && typeof child === 'string') result.add(child);
      if (normalizedKey.endsWith('goodsids') && Array.isArray(child)) {
        child.filter((entry): entry is string => typeof entry === 'string').forEach((entry) => result.add(entry));
      }
      visit(child);
    }
  };
  visit(record.payload);
  return [...result].sort();
}

export interface VerifyPackOptions {
  packDirectory: string;
  atlasPath?: string;
  maxShardBytes?: number;
  spriteSamples?: number;
}

export interface VerifyPackResult {
  assets: number;
  bytes: number;
  recipes: number;
  goods: number;
  spriteSamples: number;
}

interface DecodedRecipeShard {
  schemaVersion: number;
  datasetId: string;
  recipeTypeId: string;
  recipes: Array<{ id: string }>;
}

interface DecodedCatalog {
  schemaVersion: number;
  datasetId: string;
  kind?: 'core' | 'goods';
  part?: number;
  goods?: unknown[];
  oreDictionaries?: unknown[];
  ingredientGroups?: unknown[];
  specialViewTypes?: unknown[];
  specialServiceIcons?: unknown[];
}

interface DecodedSpecialShard {
  schemaVersion: number;
  datasetId: string;
  kind: 'special';
  specialViewTypeId: string;
  specialViewTypeOrder: number;
  part: number;
  records: SpecialRecord[];
}

type VerifiableManifest = Omit<GeneratedPackManifest, 'formatVersion' | 'catalogAssets' | 'specialDataShards' | 'totals'> & {
  formatVersion: number;
  catalogAssets: Array<ImmutableAsset & Partial<Pick<CatalogAsset, 'role' | 'part' | 'goodsCount'>>>;
  specialDataShards?: Array<ImmutableAsset & Partial<Pick<SpecialDataShardAsset, 'kind' | 'specialViewTypeId' | 'specialViewTypeOrder' | 'part' | 'recordCount'>>>;
  totals: GeneratedPackManifest['totals'] & { specialRecords?: number };
};

export async function verifyPack(options: VerifyPackOptions): Promise<VerifyPackResult> {
  const manifestBytes = await readFile(join(options.packDirectory, 'pack-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as VerifiableManifest;
  if (![1, 2, 3, 4].includes(manifest.formatVersion)) {
    throw new Error(`Unsupported generated pack format ${manifest.formatVersion}`);
  }
  const assets: ImmutableAsset[] = [
    ...manifest.catalogAssets,
    ...manifest.recipeShards,
    ...(manifest.specialDataShards ?? []),
    ...manifest.iconSheets
  ];
  if (assets.length !== manifest.totals.assets) {
    throw new Error(`Manifest declares ${manifest.totals.assets} assets but lists ${assets.length}`);
  }
  const seenIds = new Set<string>();
  let verifiedBytes = 0;
  for (const asset of assets) {
    if (seenIds.has(asset.id)) throw new Error(`Duplicate asset ID ${asset.id}`);
    seenIds.add(asset.id);
    if (asset.encoding === 'gzip' && localFilename(asset).endsWith('.gz')) {
      throw new Error(`${asset.id}: gzip payload must not use a .gz suffix because HTTP servers may transparently decode it`);
    }
    const bytes = await readFile(join(options.packDirectory, 'assets', localFilename(asset)));
    if (bytes.byteLength !== asset.bytes) {
      throw new Error(`${asset.id}: expected ${asset.bytes} bytes, read ${bytes.byteLength}`);
    }
    if (sha256(bytes) !== asset.sha256) throw new Error(`${asset.id}: SHA-256 mismatch`);
    if (!localFilename(asset).includes(asset.sha256.slice(0, 16))) {
      throw new Error(`${asset.id}: filename does not contain its digest prefix`);
    }
    verifiedBytes += bytes.byteLength;
  }
  if (verifiedBytes !== manifest.totals.offlineBytes) {
    throw new Error(`Manifest declares ${manifest.totals.offlineBytes} offline bytes, verified ${verifiedBytes}`);
  }

  if (manifest.source.specialDataSha256) {
    const sidecarPath = join(options.packDirectory, 'browser-nei-special.json');
    let sidecar: Buffer;
    try {
      sidecar = await readFile(sidecarPath);
    } catch (error) {
      throw new Error(`Special sidecar is missing: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (sha256(sidecar) !== manifest.source.specialDataSha256) {
      throw new Error('Special sidecar SHA-256 does not match manifest');
    }
  }

  const maxShardBytes = options.maxShardBytes ?? DEFAULT_MAX_SHARD_BYTES;
  const recipeIds = new Set<string>();
  for (const descriptor of manifest.recipeShards) {
    if (descriptor.bytes > maxShardBytes && descriptor.recipeCount !== 1) {
      throw new Error(`${descriptor.id}: ${descriptor.bytes} bytes exceeds shard cap ${maxShardBytes}`);
    }
    const compressed = await readFile(join(options.packDirectory, 'assets', localFilename(descriptor)));
    const shard = decode(gunzipSync(compressed)) as DecodedRecipeShard;
    if (shard.schemaVersion !== manifest.formatVersion || shard.datasetId !== manifest.datasetId) {
      throw new Error(`${descriptor.id}: shard identity does not match its manifest`);
    }
    if (shard.recipeTypeId !== descriptor.recipeTypeId) {
      throw new Error(`${descriptor.id}: recipe type does not match its descriptor`);
    }
    if (shard.recipes.length !== descriptor.recipeCount) {
      throw new Error(`${descriptor.id}: expected ${descriptor.recipeCount} recipes, decoded ${shard.recipes.length}`);
    }
    for (const recipe of shard.recipes) {
      if (recipeIds.has(recipe.id)) throw new Error(`${descriptor.id}: duplicate recipe ID ${recipe.id}`);
      recipeIds.add(recipe.id);
    }
  }
  if (recipeIds.size !== manifest.totals.recipes) {
    throw new Error(`Manifest declares ${manifest.totals.recipes} recipes, decoded ${recipeIds.size}`);
  }

  const specialRecords: SpecialRecord[] = [];
  const specialRecordIds = new Set<string>();
  const specialParts = new Map<string, number>();
  for (const descriptor of manifest.specialDataShards ?? []) {
    if (manifest.formatVersion !== 4) {
      throw new Error(`${descriptor.id}: special data is supported only by format 4 packs`);
    }
    if (
      descriptor.kind !== 'specialData'
      || descriptor.specialViewTypeId === undefined
      || descriptor.specialViewTypeOrder === undefined
      || descriptor.part === undefined
      || descriptor.recordCount === undefined
    ) {
      throw new Error(`${descriptor.id}: invalid special-data descriptor`);
    }
    if (descriptor.bytes > maxShardBytes && descriptor.recordCount !== 1) {
      throw new Error(`${descriptor.id}: ${descriptor.bytes} bytes exceeds special shard cap ${maxShardBytes}`);
    }
    const compressed = await readFile(join(options.packDirectory, 'assets', localFilename(descriptor)));
    const shard = decode(gunzipSync(compressed)) as DecodedSpecialShard;
    if (
      shard.schemaVersion !== manifest.formatVersion
      || shard.datasetId !== manifest.datasetId
      || shard.kind !== 'special'
      || shard.specialViewTypeId !== descriptor.specialViewTypeId
      || shard.specialViewTypeOrder !== descriptor.specialViewTypeOrder
      || shard.part !== descriptor.part
    ) {
      throw new Error(`${descriptor.id}: special shard identity does not match its manifest`);
    }
    if (!Array.isArray(shard.records) || shard.records.length !== descriptor.recordCount) {
      throw new Error(`${descriptor.id}: expected ${descriptor.recordCount} special records, decoded ${shard.records?.length ?? 0}`);
    }
    const previousPart = specialParts.get(descriptor.specialViewTypeId);
    if (previousPart !== undefined && descriptor.part !== previousPart + 1) {
      throw new Error(`${descriptor.id}: special data parts are not contiguous`);
    }
    if (previousPart === undefined && descriptor.part !== 0) {
      throw new Error(`${descriptor.id}: first special data part must be zero`);
    }
    specialParts.set(descriptor.specialViewTypeId, descriptor.part);
    let previousId: string | undefined;
    for (const record of shard.records) {
      if (
        !record
        || typeof record.id !== 'string'
        || typeof record.category !== 'string'
        || typeof record.title !== 'string'
        || typeof record.searchText !== 'string'
        || !Array.isArray(record.goodsIds)
        || !record.goodsIds.every((goodsId) => typeof goodsId === 'string')
        || (record.productionGoodsIds !== undefined
          && (!Array.isArray(record.productionGoodsIds)
            || !record.productionGoodsIds.every((goodsId) => typeof goodsId === 'string')))
        || (record.usageGoodsIds !== undefined
          && (!Array.isArray(record.usageGoodsIds)
            || !record.usageGoodsIds.every((goodsId) => typeof goodsId === 'string')))
        || typeof record.recipesLookupId !== 'string'
        || typeof record.usagesLookupId !== 'string'
        || typeof record.serviceIconId !== 'string'
        || record.payload === null
        || typeof record.payload !== 'object'
        || Array.isArray(record.payload)
      ) {
        throw new Error(`${descriptor.id}: invalid special record`);
      }
      if (record.category !== descriptor.specialViewTypeId) {
        throw new Error(`${descriptor.id}: record ${record.id} has the wrong special category`);
      }
      if (previousId !== undefined && record.id.localeCompare(previousId) < 0) {
        throw new Error(`${descriptor.id}: special record IDs are not sorted`);
      }
      previousId = record.id;
      if (specialRecordIds.has(record.id)) throw new Error(`${descriptor.id}: duplicate special record ID ${record.id}`);
      specialRecordIds.add(record.id);
      specialRecords.push(record);
    }
  }
  if (manifest.formatVersion === 4 && (manifest.totals.specialRecords ?? 0) !== specialRecords.length) {
    throw new Error(`Manifest declares ${manifest.totals.specialRecords ?? 0} special records, decoded ${specialRecords.length}`);
  }

  let goods = 0;
  const catalogGoodsIds = new Set<string>();
  let coreAssets = 0;
  let nextGoodsPart = 0;
  for (const descriptor of manifest.catalogAssets) {
    const compressed = await readFile(join(options.packDirectory, 'assets', localFilename(descriptor)));
    const catalog = decode(gunzipSync(compressed)) as DecodedCatalog;
    if (catalog.schemaVersion !== manifest.formatVersion || catalog.datasetId !== manifest.datasetId) {
      throw new Error(`${descriptor.id}: catalog identity does not match its manifest`);
    }
    if (manifest.formatVersion === 1) {
      for (const value of catalog.goods ?? []) {
        if (value !== null && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
          catalogGoodsIds.add((value as { id: string }).id);
        }
      }
      goods += catalog.goods?.length ?? 0;
      continue;
    }
    if (catalog.kind !== descriptor.role) {
      throw new Error(`${descriptor.id}: catalog role does not match its descriptor`);
    }
    // Semantic ore dictionaries and anonymous ingredient groups are stored
    // in the core catalog (not in goods shards), so include them when
    // validating special-record references before handling the core shape.
    for (const value of [
      ...(catalog.oreDictionaries ?? []),
      ...(catalog.ingredientGroups ?? [])
    ]) {
      if (value !== null && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
        catalogGoodsIds.add((value as { id: string }).id);
      }
    }
    if (descriptor.role === 'core') {
      coreAssets++;
      if (descriptor.goodsCount !== 0 || catalog.goods !== undefined) {
        throw new Error(`${descriptor.id}: core catalog must not contain goods`);
      }
      continue;
    }
    if (
      descriptor.role !== 'goods'
      || descriptor.part === undefined
      || descriptor.goodsCount === undefined
    ) {
      throw new Error(`${descriptor.id}: invalid format-2 catalog descriptor`);
    }
    if (descriptor.part !== nextGoodsPart || catalog.part !== descriptor.part) {
      throw new Error(`${descriptor.id}: catalog goods parts are not contiguous`);
    }
    if (descriptor.bytes > maxShardBytes && descriptor.goodsCount !== 1) {
      throw new Error(`${descriptor.id}: ${descriptor.bytes} bytes exceeds catalog shard cap ${maxShardBytes}`);
    }
    if (catalog.goods?.length !== descriptor.goodsCount) {
      throw new Error(`${descriptor.id}: expected ${descriptor.goodsCount} goods, decoded ${catalog.goods?.length ?? 0}`);
    }
    for (const value of catalog.goods ?? []) {
      if (value !== null && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
        catalogGoodsIds.add((value as { id: string }).id);
      }
    }
    goods += descriptor.goodsCount;
    nextGoodsPart++;
  }
  if (manifest.formatVersion >= 2 && (coreAssets !== 1 || nextGoodsPart === 0)) {
    throw new Error(`Format-${manifest.formatVersion} pack requires one catalog core and at least one goods part`);
  }

  if (manifest.formatVersion === 4 && specialRecords.length > 0) {
    const core = coreAssets === 1
      ? (await (async () => {
        const descriptor = manifest.catalogAssets.find((candidate) => candidate.role === 'core');
        if (!descriptor) return undefined;
        return decode(gunzipSync(await readFile(join(options.packDirectory, 'assets', localFilename(descriptor))))) as DecodedCatalog;
      })())
      : undefined;
    const views = new Set(
      (core?.specialViewTypes ?? [])
        .filter((value): value is { id: string } => value !== null && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string')
        .map((value) => value.id)
    );
    const icons = new Set(
      (core?.specialServiceIcons ?? [])
        .filter((value): value is { id: string } => value !== null && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string')
        .map((value) => value.id)
    );
    for (const record of specialRecords) {
      if (!views.has(record.category)) throw new Error(`Special record ${record.id} has no catalog view type`);
      if (!icons.has(record.serviceIconId)) throw new Error(`Special record ${record.id} has no catalog service icon`);
      if (!record.recipesLookupId || !record.usagesLookupId) {
        throw new Error(`Special record ${record.id} is missing Recipes/Usages lookup IDs`);
      }
      for (const goodsId of specialRecordGoodsIds(record)) {
        if (!catalogGoodsIds.has(goodsId)) {
          throw new Error(`Special record ${record.id} references unresolved goods ID ${goodsId}`);
        }
      }
    }
  }

  for (const descriptor of manifest.iconSheets) {
    const metadata = await sharp(join(options.packDirectory, 'assets', localFilename(descriptor))).metadata();
    const expectedSize = descriptor.columns * descriptor.spriteSize;
    if (metadata.width !== expectedSize || metadata.height !== descriptor.rows * descriptor.spriteSize) {
      throw new Error(`${descriptor.id}: expected ${expectedSize}x${descriptor.rows * descriptor.spriteSize}, got ${metadata.width}x${metadata.height}`);
    }
  }

  let verifiedSpriteSamples = 0;
  if (options.atlasPath && manifest.iconSheets.length > 0) {
    const atlasBytes = await readFile(options.atlasPath);
    if (sha256(atlasBytes) !== manifest.source.atlasSha256) throw new Error('Source atlas SHA-256 does not match manifest');
    const { data: atlas, info } = await sharp(atlasBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const totalIcons = manifest.iconSheets.reduce((maximum, sheet) => Math.max(maximum, sheet.firstIcon + sheet.iconCount), 0);
    const sampleCount = Math.min(options.spriteSamples ?? 50, totalIcons);
    const decodedSheets = new Map<string, { data: Buffer; width: number }>();
    for (let sample = 0; sample < sampleCount; sample++) {
      const iconId = sampleCount === 1 ? 0 : Math.floor(sample * (totalIcons - 1) / (sampleCount - 1));
      const sheet = manifest.iconSheets.find((candidate) =>
        iconId >= candidate.firstIcon && iconId < candidate.firstIcon + candidate.iconCount);
      if (!sheet) throw new Error(`No icon sheet contains sampled icon ${iconId}`);
      let decodedSheet = decodedSheets.get(sheet.id);
      if (!decodedSheet) {
        const result = await sharp(join(options.packDirectory, 'assets', localFilename(sheet)))
          .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        decodedSheet = { data: result.data, width: result.info.width };
        decodedSheets.set(sheet.id, decodedSheet);
      }
      const localIcon = iconId - sheet.firstIcon;
      const sourceX = (iconId % 256) * sheet.spriteSize;
      const sourceY = Math.floor(iconId / 256) * sheet.spriteSize;
      const targetX = (localIcon % sheet.columns) * sheet.spriteSize;
      const targetY = Math.floor(localIcon / sheet.columns) * sheet.spriteSize;
      for (let row = 0; row < sheet.spriteSize; row++) {
        const sourceStart = ((sourceY + row) * info.width + sourceX) * 4;
        const targetStart = ((targetY + row) * decodedSheet.width + targetX) * 4;
        const sourceRow = atlas.subarray(sourceStart, sourceStart + sheet.spriteSize * 4);
        const targetRow = decodedSheet.data.subarray(targetStart, targetStart + sheet.spriteSize * 4);
        for (let pixel = 0; pixel < sheet.spriteSize; pixel++) {
          const offset = pixel * 4;
          if (sourceRow[offset + 3] !== targetRow[offset + 3]) {
            throw new Error(`Repacked sprite ${iconId} has different alpha at row ${row}, column ${pixel}`);
          }
          // Lossless WebP is allowed to normalize invisible RGB values where alpha is zero.
          if (sourceRow[offset + 3] === 0) continue;
          for (let channel = 0; channel < 3; channel++) {
            if (sourceRow[offset + channel] !== targetRow[offset + channel]) {
              throw new Error(`Repacked sprite ${iconId} differs at row ${row}, column ${pixel}, channel ${channel}`);
            }
          }
        }
      }
      verifiedSpriteSamples++;
    }
  }

  return {
    assets: assets.length,
    bytes: verifiedBytes,
    recipes: recipeIds.size,
    goods,
    spriteSamples: verifiedSpriteSamples
  };
}
