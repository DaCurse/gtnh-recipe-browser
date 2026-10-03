import { createHash } from 'node:crypto';
import { expandRelations, type PackedRelationList } from '../../src/lib/packedRelations';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readLogicalAsset } from './recordPages';
import { decodeRecordPage, recordPageSelections, RECORD_PAGE_TARGET_BYTES } from '../../src/lib/recordPages';
import { decode } from '@msgpack/msgpack';
import sharp from 'sharp';
import { sharedIconPixelsEquivalent } from './sharedIcons';
import { decodeFormat5 } from './decoder';
import type {
  GeneratedPackManifest,
  ImmutableAsset
} from './manifest';
import { canonicalSpecialDataJson, parseBrowserNeiSpecial, type SpecialRecord } from './special';
import { repairSpecialServiceIcons } from './specialServiceIcons';
import { expandGtOreSpecialData } from './specialOreAliases';
import {
  sharedPrefixLayoutFingerprint,
  sharedRepository,
  validateSharedLayout,
  validateSharedPrefixLayout,
  type SharedPartitionLayout,
  type SharedPrefixLayout
} from './sharedLayout';

const SPRITE_SIZE = 32;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function localFilename(asset: ImmutableAsset): string {
  return basename(new URL(asset.url, 'https://local.invalid/').pathname);
}

function localAssetPath(
  packDirectory: string,
  asset: ImmutableAsset,
  assetDirectory?: string
): string {
  const root = assetDirectory ?? join(packDirectory, 'assets', 'sha256');
  return join(root, localFilename(asset));
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
  /** Global object-store directory for a published pack. */
  assetDirectory?: string;
  /** Optional processed source data for owner-aware sprite sampling. */
  dataPath?: string;
  /** Optional full persistent layout paired with dataPath. */
  layoutPath?: string;
  atlasPath?: string;
  /** Optional raw input sidecar for an explicit provenance check. */
  specialDataPath?: string;
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
  kind: 'recipeShard';
  logicalId: string;
  recipeTypeId: string;
  prefix: string;
  recipes: Array<{ id: string }>;
}

interface DecodedCatalog {
  schemaVersion: number;
  kind: 'core' | 'goods' | 'goodsSearch' | 'recipeTypes' | 'recipeRemaps' | 'specialMetadata';
  logicalId: string;
  prefix?: string;
  goods?: unknown[];
  tooltips?: Array<{ id: string; text: string }>;
  recipeTypes?: unknown[];
  oreDictionaries?: unknown[];
  ingredientGroups?: unknown[];
  obsoleteRecipeRemaps?: Record<string, string>;
  specialViewTypes?: unknown[];
  specialServiceIcons?: unknown[];
}

interface DecodedDetails {
  lists?: PackedRelationList[];
  schemaVersion: number;
  kind: 'goodsDetails';
  logicalId: string;
  prefix: string;
  goods: Array<{ id: string; productionShards: string[]; usageShards: string[] }>;
}

interface DecodedGroups {
  lists?: PackedRelationList[];
  schemaVersion: number;
  kind: 'ingredientGroups';
  logicalId: string;
  prefix: string;
  ingredientGroups: Array<{ id: string; itemIds: string[] }>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

interface DecodedSpecialShard {
  schemaVersion: number;
  kind: 'special';
  specialViewTypeId: string;
  logicalId: string;
  prefix: string;
  records: SpecialRecord[];
}

function verifyShardSize(
  asset: { id: string; bytes: number; oversizedSingleton?: boolean },
  recordCount: number,
  targetBytes: number,
  label: string
): void {
  if (asset.bytes <= targetBytes) {
    if (asset.oversizedSingleton === true) {
      throw new Error(`${asset.id}: ${label} is marked as an oversized singleton below its target`);
    }
    return;
  }
  if (recordCount !== 1) {
    throw new Error(`${asset.id}: ${asset.bytes} bytes exceeds ${label} cap ${targetBytes}`);
  }
  if (asset.oversizedSingleton !== true) {
    throw new Error(`${asset.id}: oversized singleton marker is missing`);
  }
}

export async function verifyPack(options: VerifyPackOptions): Promise<VerifyPackResult> {
  const manifestBytes = await readFile(join(options.packDirectory, 'pack-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as GeneratedPackManifest;
  const formatVersion = (manifest as { formatVersion: number }).formatVersion;
  if (formatVersion !== 7) {
    throw new Error(`Unsupported generated pack format ${formatVersion}; only format 7 is supported`);
  }
  if (manifest.assetStore !== 'global-sha256') {
    throw new Error('The manifest must use the global SHA-256 asset store');
  }
  const layout = manifest.sharedLayout;
  if (!layout || layout.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(layout.layoutSha256) || !layout.prefixes) {
    throw new Error('Manifest is missing a valid shared-layout fingerprint');
  }
  const prefixLayout: SharedPrefixLayout = {
    schemaVersion: layout.schemaVersion,
    targets: layout.targets,
    ...layout.prefixes
  };
  validateSharedPrefixLayout(prefixLayout);
  if (sharedPrefixLayoutFingerprint(prefixLayout) !== layout.layoutSha256) {
    throw new Error('Manifest shared-layout fingerprint does not match its prefix map');
  }
  const assets: ImmutableAsset[] = [
    ...manifest.recordPages,
    ...manifest.iconSheets
  ];
  const logicalFamilies = formatVersion === 7 ? [
    ...manifest.catalogAssets.map((asset) => [asset, 'bootstrap'] as const),
    ...(manifest.goodsDetailShards ?? []).map((asset) => [asset, 'goods-details'] as const),
    ...(manifest.ingredientGroupShards ?? []).map((asset) => [asset, 'ingredient-groups'] as const),
    ...manifest.recipeShards.map((asset) => [asset, 'recipes'] as const),
    ...manifest.specialDataShards.map((asset) => [asset, 'special'] as const)
  ] : [];
  for (const [logical, family] of logicalFamilies) {
    if (logical.family !== family || !logical.segments?.length) {
      throw new Error(`${logical.id}: invalid ${family} logical descriptor`);
    }
    for (const [page] of recordPageSelections(logical)) {
      if (manifest.recordPages[page]?.family !== family) {
        throw new Error(`${logical.id}: record page crosses load-family boundary`);
      }
    }
  }
  if (assets.length !== manifest.totals.assets) {
    throw new Error(`Manifest declares ${manifest.totals.assets} assets but lists ${assets.length}`);
  }
  const seenIds = new Set<string>();
  let verifiedBytes = 0;
  const verifiedHashes = new Set<string>();
  for (const asset of assets) {
    if (seenIds.has(asset.id)) throw new Error(`Duplicate asset ID ${asset.id}`);
    seenIds.add(asset.id);
    if (asset.encoding === 'gzip' && localFilename(asset).endsWith('.gz')) {
      throw new Error(`${asset.id}: gzip payload must not use a .gz suffix because HTTP servers may transparently decode it`);
    }
    const bytes = await readFile(localAssetPath(options.packDirectory, asset, options.assetDirectory));
    if (bytes.byteLength !== asset.bytes) {
      throw new Error(`${asset.id}: expected ${asset.bytes} bytes, read ${bytes.byteLength}`);
    }
    if (sha256(bytes) !== asset.sha256) throw new Error(`${asset.id}: SHA-256 mismatch`);
    if (manifest.recordPages.includes(asset)) {
      const records = decodeRecordPage(gunzipSync(bytes));
      const decodedBytes = records.reduce((total, record) => total + record.byteLength, 0);
      if ((decodedBytes > RECORD_PAGE_TARGET_BYTES) !== (asset.oversizedSingleton === true)) {
        throw new Error(`${asset.id}: invalid oversized record-page marker`);
      }
    }
    const filename = localFilename(asset);
    if (filename !== asset.sha256) {
      throw new Error(`${asset.id}: filename does not contain its digest prefix`);
    }
    if (!verifiedHashes.has(asset.sha256)) {
      verifiedHashes.add(asset.sha256);
      verifiedBytes += bytes.byteLength;
    }
  }
  if (verifiedBytes !== manifest.totals.offlineBytes) {
    throw new Error(`Manifest declares ${manifest.totals.offlineBytes} offline bytes, verified ${verifiedBytes}`);
  }

  if (manifest.source.specialDataSha256 && options.specialDataPath) {
    let sidecar: Buffer;
    try {
      sidecar = await readFile(options.specialDataPath);
    } catch (error) {
      throw new Error(`Special input is missing: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    let specialData = parseBrowserNeiSpecial(sidecar);
    if (options.dataPath) {
      const sourceBytes = await readFile(options.dataPath);
      if (sha256(sourceBytes) !== manifest.source.dataSha256) {
        throw new Error('Source data SHA-256 does not match manifest');
      }
      const source = decodeFormat5(sourceBytes);
      specialData = expandGtOreSpecialData(repairSpecialServiceIcons(specialData, source), source);
    }
    if (sha256(Buffer.from(canonicalSpecialDataJson(specialData))) !== manifest.source.specialDataSha256) {
      throw new Error('Special input SHA-256 does not match manifest; pass --data for source-dependent normalization');
    }
  }

  const sharedTargets = manifest.sharedLayout.targets;
  const sharedPrefixes = manifest.sharedLayout.prefixes;
  const requireSharedPrefix = (
    family: 'goods' | 'oreDictionaries' | 'recipeTypes' | 'specialViews',
    namespace: string,
    prefix: string | undefined,
    descriptorId: string
  ): void => {
    if (prefix === undefined) throw new Error(`${descriptorId}: descriptor is missing its prefix`);
    const prefixes = family === 'recipeTypes' || family === 'specialViews'
      ? sharedPrefixes?.[family]?.[namespace]
      : sharedPrefixes?.[family];
    if (!prefixes?.includes(prefix)) {
      throw new Error(`${descriptorId}: prefix ${prefix || 'root'} is not in the published ${family} layout`);
    }
  };
  const recipeIds = new Set<string>();
  for (const descriptor of manifest.recipeShards) {
    const raw = await readLogicalAsset(descriptor, manifest, options.assetDirectory ?? join(options.packDirectory, 'assets', 'sha256'));
    verifyShardSize(
      { ...descriptor, bytes: gzipSync(raw, { level: 9 }).length },
      descriptor.recipeCount,
      sharedTargets.recipes,
      'recipe shard'
    );
    const shard = decode(raw) as DecodedRecipeShard;
    const identityMismatch = shard.schemaVersion !== 5
      || shard.kind !== 'recipeShard'
      || shard.logicalId !== descriptor.id
      || shard.prefix !== descriptor.prefix;
    if (identityMismatch) {
      throw new Error(`${descriptor.id}: shard identity does not match its manifest`);
    }
    if (shard.recipeTypeId !== descriptor.recipeTypeId) {
      throw new Error(`${descriptor.id}: recipe type does not match its descriptor`);
    }
    requireSharedPrefix('recipeTypes', descriptor.recipeTypeId, descriptor.prefix, descriptor.id);
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
  for (const descriptor of manifest.specialDataShards) {
    if (
      descriptor.kind !== 'specialData'
      || descriptor.specialViewTypeId === undefined
      || descriptor.part === undefined
      || descriptor.recordCount === undefined
    ) {
      throw new Error(`${descriptor.id}: invalid special-data descriptor`);
    }
    const raw = await readLogicalAsset(descriptor, manifest, options.assetDirectory ?? join(options.packDirectory, 'assets', 'sha256'));
    verifyShardSize(
      { ...descriptor, bytes: gzipSync(raw, { level: 9 }).length },
      descriptor.recordCount,
      sharedTargets.special,
      'special shard'
    );
    const shard = decode(raw) as DecodedSpecialShard;
    const identityMismatch = shard.schemaVersion !== 5
      || shard.kind !== 'special'
      || shard.logicalId !== descriptor.id
      || shard.specialViewTypeId !== descriptor.specialViewTypeId
      || shard.prefix !== descriptor.prefix;
    if (identityMismatch) {
      throw new Error(`${descriptor.id}: special shard identity does not match its manifest`);
    }
    requireSharedPrefix('specialViews', descriptor.specialViewTypeId, descriptor.prefix, descriptor.id);
    if (!Array.isArray(shard.records) || shard.records.length !== descriptor.recordCount) {
      throw new Error(`${descriptor.id}: expected ${descriptor.recordCount} special records, decoded ${shard.records?.length ?? 0}`);
    }
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
  if (manifest.totals.specialRecords !== specialRecords.length) {
    throw new Error(`Manifest declares ${manifest.totals.specialRecords} special records, decoded ${specialRecords.length}`);
  }

  let goods = 0;
  const catalogGoodsIds = new Set<string>();
  const catalogItemIds = new Set<string>();
  const catalogSearchIds = new Set<string>();
  const decodedCatalogs = new Map<string, DecodedCatalog>();
  let coreAssets = 0;
  const catalogRoleCounts = new Map<string, number>();
  for (const descriptor of manifest.catalogAssets) {
    const raw = await readLogicalAsset(descriptor, manifest, options.assetDirectory ?? join(options.packDirectory, 'assets', 'sha256'));
    const sizeDescriptor = { ...descriptor, bytes: gzipSync(raw, { level: 9 }).length };
    const catalog = decode(raw) as DecodedCatalog;
    decodedCatalogs.set(descriptor.id, catalog);
    const identityMismatch = catalog.schemaVersion !== 6
      || catalog.logicalId !== descriptor.id
      || catalog.kind !== descriptor.role
      || (descriptor.prefix !== undefined && catalog.prefix !== descriptor.prefix);
    if (identityMismatch) {
      throw new Error(`${descriptor.id}: catalog identity does not match its manifest`);
    }
    catalogRoleCounts.set(descriptor.role, (catalogRoleCounts.get(descriptor.role) ?? 0) + 1);
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
    if (descriptor.role === 'goodsSearch') {
      if (!Array.isArray(catalog.tooltips) || descriptor.goodsCount !== 0) {
        throw new Error(`${descriptor.id}: invalid goods-search payload`);
      }
      requireSharedPrefix('goods', 'goods', descriptor.prefix, descriptor.id);
      for (const record of catalog.tooltips) {
        if (typeof record.id !== 'string'
          || typeof record.text !== 'string') {
          throw new Error(`${descriptor.id}: invalid or duplicate goods-search record`);
        }
        catalogSearchIds.add(record.id);
      }
      continue;
    }
    if (descriptor.role === 'recipeTypes') {
      if (!Array.isArray(catalog.recipeTypes) || catalog.goods !== undefined) {
        throw new Error(`${descriptor.id}: invalid recipe-type catalog payload`);
      }
      continue;
    }
    if (descriptor.role === 'recipeRemaps') {
      if (catalog.obsoleteRecipeRemaps === undefined
        || catalog.obsoleteRecipeRemaps === null
        || Array.isArray(catalog.obsoleteRecipeRemaps)
        || typeof catalog.obsoleteRecipeRemaps !== 'object'
        || !Object.entries(catalog.obsoleteRecipeRemaps).every(([key, value]) => typeof key === 'string' && typeof value === 'string')) {
        throw new Error(`${descriptor.id}: invalid recipe-remap catalog payload`);
      }
      continue;
    }
    if (descriptor.role === 'specialMetadata') {
      if (!Array.isArray(catalog.specialViewTypes)
        || !Array.isArray(catalog.specialServiceIcons)
        || catalog.goods !== undefined) {
        throw new Error(`${descriptor.id}: invalid special metadata catalog payload`);
      }
      continue;
    }
    if (descriptor.role === 'goods' && descriptor.goodsCount === undefined) {
      throw new Error(`${descriptor.id}: goods descriptor is missing goodsCount`);
    }
    if (descriptor.role === 'goods') {
      verifyShardSize(
        sizeDescriptor,
        descriptor.goodsCount,
        sharedTargets.goods,
        'catalog goods shard'
      );
    }
    if (descriptor.role === 'goods') {
      requireSharedPrefix('goods', 'goods', descriptor.prefix, descriptor.id);
    }
    if (descriptor.role === 'goods' && catalog.goods?.length !== descriptor.goodsCount) {
      throw new Error(`${descriptor.id}: expected ${descriptor.goodsCount} goods, decoded ${catalog.goods?.length ?? 0}`);
    }
    for (const value of catalog.goods ?? []) {
      if (value !== null && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
        const id = (value as { id: string }).id;
        catalogGoodsIds.add(id);
        catalogItemIds.add(id);
      }
    }
    goods += descriptor.goodsCount;
  }
  {
    if (catalogItemIds.size === 0) throw new Error('Bootstrap goods are empty');
    const requiredRoles = ['core', 'recipeTypes', 'recipeRemaps', 'specialMetadata'];
    for (const role of requiredRoles) {
      if (catalogRoleCounts.get(role) !== 1) {
        throw new Error(`Format-${formatVersion} pack requires exactly one ${role} catalog role`);
      }
    }
  }
  if (coreAssets !== 1 || catalogRoleCounts.get('goods') === undefined) {
    throw new Error('Pack requires one catalog core and at least one goods part');
  }
  for (const catalog of decodedCatalogs.values()) for (const goods of catalog.goods ?? []) {
    const record = goods as { id: string; tooltipId?: string | null };
    if (record.tooltipId && !catalogSearchIds.has(record.tooltipId)) throw new Error(`${record.id}: missing search tooltip`);
  }

  const detailIds = new Set<string>();
  for (const descriptor of manifest.goodsDetailShards ?? []) {
    const raw = await readLogicalAsset(descriptor, manifest, options.assetDirectory ?? join(options.packDirectory, 'assets', 'sha256'));
    const value = decode(raw) as DecodedDetails;
    if (value.schemaVersion !== 6 || value.kind !== 'goodsDetails'
      || value.logicalId !== descriptor.logicalId || value.prefix !== descriptor.prefix
      || value.goods.length !== descriptor.recordCount) {
      throw new Error(`${descriptor.id}: invalid goods-detail shard`);
    }
    requireSharedPrefix('goods', 'goods', descriptor.prefix, descriptor.id);
    for (const detail of expandRelations(value.goods, value.lists)) {
      if (!catalogItemIds.has(detail.id) || detailIds.has(detail.id)
        || !isStringArray(detail.productionShards) || !isStringArray(detail.usageShards)) {
        throw new Error(`${descriptor.id}: invalid or duplicate goods detail ${detail.id}`);
      }
      detailIds.add(detail.id);
    }
  }
  if (formatVersion === 7 && detailIds.size !== catalogItemIds.size) {
    throw new Error('Goods details do not cover exactly the bootstrap goods');
  }

  const groupIds = new Set<string>();
  for (const descriptor of manifest.ingredientGroupShards ?? []) {
    const raw = await readLogicalAsset(descriptor, manifest, options.assetDirectory ?? join(options.packDirectory, 'assets', 'sha256'));
    const value = decode(raw) as DecodedGroups;
    if (value.schemaVersion !== 6 || value.kind !== 'ingredientGroups'
      || value.logicalId !== descriptor.logicalId || value.prefix !== descriptor.prefix
      || value.ingredientGroups.length !== descriptor.recordCount) {
      throw new Error(`${descriptor.id}: invalid ingredient-group shard`);
    }
    requireSharedPrefix('oreDictionaries', 'oreDictionaries', descriptor.prefix, descriptor.id);
    for (const group of expandRelations(value.ingredientGroups, value.lists)) {
      if (groupIds.has(group.id) || !isStringArray(group.itemIds)
        || group.itemIds.some((id) => !catalogItemIds.has(id))) {
        throw new Error(`${descriptor.id}: invalid ingredient group ${group.id}`);
      }
      groupIds.add(group.id);
      catalogGoodsIds.add(group.id);
    }
  }

  if (specialRecords.length > 0) {
    const metadata = [...decodedCatalogs.values()].find((catalog) => catalog.kind === 'specialMetadata');
    const views = new Set(
      (metadata?.specialViewTypes ?? [])
        .filter((value): value is { id: string } => value !== null && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string')
        .map((value) => value.id)
    );
    const icons = new Set(
      (metadata?.specialServiceIcons ?? [])
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
    const metadata = await sharp(localAssetPath(options.packDirectory, descriptor, options.assetDirectory)).metadata();
    const expectedSize = descriptor.columns * descriptor.spriteSize;
    if (metadata.width !== expectedSize || metadata.height !== descriptor.rows * descriptor.spriteSize) {
      throw new Error(`${descriptor.id}: expected ${expectedSize}x${descriptor.rows * descriptor.spriteSize}, got ${metadata.width}x${metadata.height}`);
    }
  }

  const catalogIconSlots = new Map<string, { sheetId: string; index: number }>();
  const collectIcons = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(collectIcons); return; }
    if (value === null || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    if (object.icon !== null && typeof object.icon === 'object') {
      const icon = object.icon as { sheetId: string; index: number };
      const sheet = manifest.iconSheets.find((candidate) => candidate.id === icon.sheetId
        || candidate.sha256.startsWith(icon.sheetId));
      if (!sheet || !Number.isSafeInteger(icon.index) || icon.index < 0 || icon.index >= sheet.iconCount) {
        throw new Error(`${String(object.id)}: invalid catalog sprite reference`);
      }
      if (typeof object.id === 'string') catalogIconSlots.set(object.id, { ...icon, sheetId: sheet.id });
    }
    Object.values(object).forEach(collectIcons);
  };
  for (const catalog of decodedCatalogs.values()) collectIcons(catalog);

  let verifiedSpriteSamples = 0;
  if (options.atlasPath) {
    const atlasBytes = await readFile(options.atlasPath);
    if (sha256(atlasBytes) !== manifest.source.atlasSha256) {
      throw new Error('Source atlas SHA-256 does not match manifest');
    }
    if (options.dataPath || options.layoutPath) {
      if (!options.dataPath || !options.layoutPath) {
        throw new Error('Sprite sampling requires both --data and --layout');
      }
      const layout = JSON.parse(await readFile(options.layoutPath, 'utf8')) as SharedPartitionLayout;
      validateSharedLayout(layout);
      if (sharedPrefixLayoutFingerprint({
        schemaVersion: layout.schemaVersion,
        targets: layout.targets,
        recipeTypes: layout.recipeTypes,
        goods: layout.goods,
        oreDictionaries: layout.oreDictionaries,
        specialViews: layout.specialViews
      }) !== manifest.sharedLayout.layoutSha256) {
        throw new Error('Sprite sampling layout does not match the manifest');
      }
      const repository = sharedRepository(decodeFormat5(await readFile(options.dataPath)));
      const sourceIconByOwner = new Map<string, number>();
      for (const entry of [...repository.items, ...repository.fluids]) {
        sourceIconByOwner.set(entry.id, entry.iconId);
      }
      for (const type of repository.recipeTypes) {
        for (const crafter of [
          ...type.singleblocks,
          ...type.multiblocks,
          ...(type.defaultCrafter ? [type.defaultCrafter] : [])
        ]) {
          if (!sourceIconByOwner.has(crafter.id)) sourceIconByOwner.set(crafter.id, crafter.iconId);
        }
      }
      const { data: atlas, info: atlasInfo } = await sharp(atlasBytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const owners = [...sourceIconByOwner.keys()].filter((owner) => catalogIconSlots.has(owner)).sort();
      const totalIcons = owners.length;
      const sampleCount = Math.min(options.spriteSamples ?? 50, totalIcons);
      const decodedSheets = new Map<string, { data: Buffer; width: number }>();
      for (let sample = 0; sample < sampleCount; sample++) {
        const slot = sampleCount === 1 ? 0 : Math.floor(sample * (totalIcons - 1) / (sampleCount - 1));
        const ownerId = owners[slot];
        if (!ownerId) throw new Error(`No owner is assigned to sampled icon slot ${slot}`);
        const targetSlot = catalogIconSlots.get(ownerId);
        if (!targetSlot) throw new Error(`No sprite cell is assigned to ${ownerId}`);
        const sheet = manifest.iconSheets.find((candidate) =>
          candidate.id === targetSlot.sheetId
          && targetSlot.index < candidate.iconCount
        );
        if (!sheet) throw new Error(`No icon sheet contains sampled icon slot ${slot}`);
        let decodedSheet = decodedSheets.get(sheet.id);
        if (!decodedSheet) {
          const result = await sharp(localAssetPath(options.packDirectory, sheet, options.assetDirectory))
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          decodedSheet = { data: result.data, width: result.info.width };
          decodedSheets.set(sheet.id, decodedSheet);
        }
        const sourceIcon = sourceIconByOwner.get(ownerId);
        const sourceX = sourceIcon === undefined ? 0 : (sourceIcon % 256) * SPRITE_SIZE;
        const sourceY = sourceIcon === undefined ? 0 : Math.floor(sourceIcon / 256) * SPRITE_SIZE;
        const targetX = (targetSlot.index % sheet.columns) * sheet.spriteSize;
        const targetY = Math.floor(targetSlot.index / sheet.columns) * sheet.spriteSize;
        const sourceSprite = Buffer.alloc(sheet.spriteSize * sheet.spriteSize * 4);
        const targetSprite = Buffer.alloc(sheet.spriteSize * sheet.spriteSize * 4);
        for (let row = 0; row < sheet.spriteSize; row++) {
          const targetStart = ((targetY + row) * decodedSheet.width + targetX) * 4;
          decodedSheet.data.copy(targetSprite, row * sheet.spriteSize * 4, targetStart, targetStart + sheet.spriteSize * 4);
          if (sourceIcon !== undefined) {
            const sourceStart = ((sourceY + row) * atlasInfo.width + sourceX) * 4;
            atlas.copy(sourceSprite, row * sheet.spriteSize * 4, sourceStart, sourceStart + sheet.spriteSize * 4);
          }
        }
        if (!sharedIconPixelsEquivalent(sourceSprite, targetSprite)) {
          throw new Error(`Repacked sprite slot ${slot} is not equivalent to source owner ${ownerId}`);
        }
        verifiedSpriteSamples++;
      }
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
