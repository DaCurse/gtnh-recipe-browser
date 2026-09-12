import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile, readdir, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { decode, encode } from '@msgpack/msgpack';
import { buildSharedIcons } from './sharedIcons';
import { decodeFormat5 } from './decoder';
import { buildRecordPages, readLogicalAsset, readReusePacks } from './recordPages';
import type {
  DecodedAnonymousIngredientGroup,
  DecodedGoodsBase,
  DecodedItem,
  DecodedOreDictionary,
  DecodedRecipe,
  DecodedRepository
} from './model';
import type {
  CatalogAsset,
  GeneratedPackManifest,
  ImmutableAsset,
  RecipeShardAsset,
  SpecialDataShardAsset
} from './manifest';
import {
  SPECIAL_CATEGORY_IDS,
  buildSpecialViewTypes,
  canonicalSpecialDataJson,
  normalizeBrowserNeiSpecial,
  parseBrowserNeiSpecial,
  specialGoodsForDirection,
  validateSpecialGoodsReferences,
  type BrowserNeiSpecialData,
  type SpecialRecord
} from './special';
import { expandGtOreSpecialData } from './specialOreAliases';
import { repairSpecialServiceIcons } from './specialServiceIcons';
import {
  groupSharedRecords,
  sharedLogicalId,
  sharedGoodsMetadataValue,
  sharedGoodsStableValue,
  sharedLayoutFingerprint,
  sharedPrefixLayout,
  sharedRepository,
  validateSharedLayout,
  type SharedPartitionLayout,
  type SharedRecord
} from './sharedLayout';

const ICONS_PER_SHEET = 1024;

export interface BuildPackOptions {
  reusePacks?: string[];
  dataPath: string;
  atlasPath: string;
  gtnhVersion: string;
  revision: string;
  outputDirectory: string;
  datasetId?: string;
  displayName?: string;
  baseUrl?: string;
  /** Parsed sidecar value; useful to library callers and fixture tests. */
  specialData?: unknown;
  /** Path to browser-nei-special.json emitted by the special exporter. */
  specialDataPath?: string;
  /** Persistent append-only prefix layout required by the shared pack. */
  layoutPath?: string;
}

export interface BuildPackResult {
  manifest: GeneratedPackManifest;
  manifestPath: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function gzipMessagePack(value: unknown): Buffer {
  return gzipSync(encode(value), { level: 9 });
}

function uniqueShards(recipeIds: string[], shardByRecipeId: Map<string, string>, context: string): string[] {
  const ids = new Set<string>();
  for (const recipeId of recipeIds) {
    const shardId = shardByRecipeId.get(recipeId);
    if (!shardId) throw new Error(`${context}: recipe ${recipeId} was not assigned to a shard`);
    ids.add(shardId);
  }
  return Array.from(ids).sort();
}

function iconReference(iconId: number) {
  if (iconId < 0) return null;
  return {
    sheetId: `icons-${Math.floor(iconId / ICONS_PER_SHEET).toString().padStart(3, '0')}`,
    index: iconId % ICONS_PER_SHEET
  };
}

function specialOreDictionaryNames(data: BrowserNeiSpecialData): string[] {
  const result = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase();
      if (
        (normalizedKey === 'oredictionary' || normalizedKey.endsWith('oredictionaryid'))
        && typeof child === 'string'
      ) result.add(child);
      visit(child);
    }
  };
  data.records.forEach((record) => visit(record.payload));
  return [...result].sort();
}

function validateSpecialOreDictionaries(
  data: BrowserNeiSpecialData,
  repository: DecodedRepository
): void {
  const known = new Set([
    ...repository.oreDictionaries.map((entry) => entry.id),
    ...repository.ingredientGroups.map((entry) => entry.id)
  ]);
  for (const name of specialOreDictionaryNames(data)) {
    if (!known.has(name) && !known.has(`o:${name}`)) {
      throw new Error(`Special data references unresolved ore dictionary ${name}`);
    }
  }
}

interface SpecialGoodsDirectionIndex {
  shardIds: string[];
  lookupIds: string[];
  recordCount: number;
}

export interface SpecialGoodsIndexEntry {
  recipes: SpecialGoodsDirectionIndex;
  usages: SpecialGoodsDirectionIndex;
}

interface MutableSpecialGoodsDirectionIndex {
  shardIds: Set<string>;
  lookupIds: Set<string>;
  recordCount: number;
}

interface MutableSpecialGoodsIndexEntry {
  recipes: MutableSpecialGoodsDirectionIndex;
  usages: MutableSpecialGoodsDirectionIndex;
}

function mutableDirectionIndex(): MutableSpecialGoodsDirectionIndex {
  return { shardIds: new Set(), lookupIds: new Set(), recordCount: 0 };
}

function mutableGoodsIndexEntry(): MutableSpecialGoodsIndexEntry {
  return { recipes: mutableDirectionIndex(), usages: mutableDirectionIndex() };
}

function mergeSpecialDirectionIndex(
  left: SpecialGoodsDirectionIndex,
  right: SpecialGoodsDirectionIndex
): SpecialGoodsDirectionIndex {
  const lookupIds = [...new Set([...left.lookupIds, ...right.lookupIds])].sort();
  return {
    shardIds: [...new Set([...left.shardIds, ...right.shardIds])].sort(),
    lookupIds,
    // Every special record contributes one stable lookup ID per direction.
    // Counting the union avoids double-counting when two equivalent stacks
    // were retained by the runtime exporter.
    recordCount: lookupIds.length
  };
}

function mergeSpecialGoodsIndexEntry(
  left: SpecialGoodsIndexEntry,
  right: SpecialGoodsIndexEntry
): SpecialGoodsIndexEntry {
  return {
    recipes: mergeSpecialDirectionIndex(left.recipes, right.recipes),
    usages: mergeSpecialDirectionIndex(left.usages, right.usages)
  };
}

/**
 * CropsNH emits several exact genericSeed stacks for one crop.  Their NBT
 * stats are useful normal-item variants, but NEI resolves all of them to the
 * same crop, pool, and breeding pages.  The runtime sidecar intentionally
 * retains the DEFAULT_ANALYZED stack; project its special indexes to every
 * exact stack with the same crop key so selecting any literal seed is useful.
 */
function applyCropsNhVariantAliases(
  index: Map<string, SpecialGoodsIndexEntry>,
  goods: readonly DecodedGoodsBase[]
): void {
  const goodsById = new Map(goods.map((entry) => [entry.id, entry]));
  const cropKey = (entry: DecodedGoodsBase | undefined): string | undefined => {
    const item = entry as (DecodedItem & { kind?: string }) | undefined;
    if (!item || item.kind !== 'item' || item.mod.toLowerCase() !== 'cropsnh') return undefined;
    if (item.internalName !== 'genericSeed' || !item.nbt) return undefined;
    return item.nbt.match(/(?:^|[,{}]\s*)crop\s*:\s*"([^"]+)"/)?.[1]?.toLowerCase();
  };

  const byCrop = new Map<string, SpecialGoodsIndexEntry>();
  for (const [goodsId, projection] of index) {
    const crop = cropKey(goodsById.get(goodsId));
    if (!crop) continue;
    const existing = byCrop.get(crop);
    byCrop.set(crop, existing ? mergeSpecialGoodsIndexEntry(existing, projection) : projection);
  }

  for (const entry of goods) {
    const crop = cropKey(entry);
    const projection = crop ? byCrop.get(crop) : undefined;
    if (!projection || index.has(entry.id)) continue;
    index.set(entry.id, projection);
  }
}

/**
 * A special record can retain an ore-dictionary ID instead of every exact
 * stack registered under that dictionary.  Catalog groups are materialized
 * as separate entries, so project that explicit group projection to each of
 * its members as well.  This mirrors NEI's ore-prefix resolution for the
 * named groups actually emitted by the runtime adapter without guessing
 * aliases from an item's display name or internal ID.
 */
function applyIngredientGroupAliases(
  index: Map<string, SpecialGoodsIndexEntry>,
  groups: readonly (DecodedOreDictionary | DecodedAnonymousIngredientGroup)[],
  goods: readonly DecodedGoodsBase[]
): void {
  const goodsById = new Map(goods.map((entry) => [entry.id, entry]));
  const isGtHostOre = (goodsId: string): boolean => {
    const entry = goodsById.get(goodsId) as DecodedItem | undefined;
    return entry?.kind === 'item'
      && entry.mod.toLocaleLowerCase() === 'gregtech'
      && entry.internalName.toLocaleLowerCase().startsWith('gt.blockores');
  };

  for (const group of groups) {
    const projection = index.get(group.id);
    if (!projection) continue;
    // `o:ore<Material>` and its GT host-stone variants are intentionally
    // narrower than a normal processing dictionary: the Forge group can
    // contain vanilla/Galacticraft/TConstruct blocks that GTNEI does not
    // resolve as GT vein inputs.  Exact GT host blocks are already retained
    // separately by the runtime adapter; only those receive the vein index.
    const memberIds = group.id.startsWith('o:ore')
      ? group.itemIds.filter(isGtHostOre)
      : group.itemIds;
    for (const itemId of memberIds) {
      const existing = index.get(itemId);
      index.set(itemId, existing ? mergeSpecialGoodsIndexEntry(existing, projection) : projection);
    }
  }
}

function finalizeSpecialDirectionIndex(
  index: MutableSpecialGoodsDirectionIndex
): SpecialGoodsDirectionIndex {
  return {
    shardIds: [...index.shardIds].sort(),
    lookupIds: [...index.lookupIds].sort(),
    recordCount: index.recordCount
  };
}

/**
 * Build all special per-goods catalog projections once, before catalog goods
 * are mapped.  The old implementation rescanned every record (and its
 * payload) four times for every item/fluid, which made a large live catalog
 * needlessly quadratic in the number of special records.
 */
export function buildSpecialGoodsIndex(
  records: readonly SpecialRecord[],
  shardByRecordId: ReadonlyMap<string, string>,
  goods: readonly DecodedGoodsBase[] = [],
  groups: readonly (DecodedOreDictionary | DecodedAnonymousIngredientGroup)[] = []
): ReadonlyMap<string, SpecialGoodsIndexEntry> {
  const mutable = new Map<string, MutableSpecialGoodsIndexEntry>();
  for (const record of records) {
    const directions = [
      {
        name: 'recipes' as const,
        goodsIds: specialGoodsForDirection(record, 'recipes'),
        lookupId: record.recipesLookupId
      },
      {
        name: 'usages' as const,
        goodsIds: specialGoodsForDirection(record, 'usages'),
        lookupId: record.usagesLookupId
      }
    ];
    const shardId = shardByRecordId.get(record.id);
    for (const direction of directions) {
      for (const goodsId of direction.goodsIds) {
        let entry = mutable.get(goodsId);
        if (!entry) {
          entry = mutableGoodsIndexEntry();
          mutable.set(goodsId, entry);
        }
        const projection = entry[direction.name];
        projection.recordCount++;
        projection.lookupIds.add(direction.lookupId);
        if (shardId !== undefined) projection.shardIds.add(shardId);
      }
    }
  }
  const result = new Map(
    [...mutable.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([goodsId, entry]) => [
      goodsId,
      {
        recipes: finalizeSpecialDirectionIndex(entry.recipes),
        usages: finalizeSpecialDirectionIndex(entry.usages)
      }
    ])
  );
  applyCropsNhVariantAliases(result, goods);
  applyIngredientGroupAliases(result, groups, goods);
  return result;
}

function buildCatalog(
  repository: DecodedRepository,
  shardByRecipeId: Map<string, string>,
  specialData: BrowserNeiSpecialData | undefined,
  specialShardByRecordId: Map<string, string>,
  iconResolver: (ownerId: string, iconId: number) => { sheetId: string; index: number } | null = (
    _ownerId,
    iconId
  ) => iconReference(iconId)
) {
  const specialRecords = specialData?.records ?? [];
  const allGoods = [...repository.items, ...repository.fluids];
  const specialGoodsIndex = buildSpecialGoodsIndex(
    specialRecords,
    specialShardByRecordId,
    allGoods,
    [...repository.oreDictionaries, ...repository.ingredientGroups]
  );
  const specialGroupFields = (id: string) => {
    const special = specialGoodsIndex.get(id);
    return {
      specialProductionShards: special?.recipes.shardIds ?? [],
      specialUsageShards: special?.usages.shardIds ?? [],
      specialProductionLookupIds: special?.recipes.lookupIds ?? [],
      specialUsageLookupIds: special?.usages.lookupIds ?? [],
      specialProductionCount: special?.recipes.recordCount ?? 0,
      specialUsageCount: special?.usages.recordCount ?? 0
    };
  };
  const goods = allGoods.map((entry) => {
    const { productionRecipeIds, usageRecipeIds, ...catalogEntry } = entry;
    delete (catalogEntry as Partial<DecodedGoodsBase>).iconId;
    const special = specialGoodsIndex.get(entry.id);
    const specialProduction = special?.recipes;
    const specialUsage = special?.usages;
    return {
      ...catalogEntry,
      icon: iconResolver(entry.id, entry.iconId),
      productionShards: uniqueShards(productionRecipeIds, shardByRecipeId, `${entry.id} production`),
      usageShards: uniqueShards(usageRecipeIds, shardByRecipeId, `${entry.id} usage`),
      productionCount: productionRecipeIds.length,
      usageCount: usageRecipeIds.length,
      specialProductionShards: specialProduction?.shardIds ?? [],
      specialUsageShards: specialUsage?.shardIds ?? [],
      specialProductionLookupIds: specialProduction?.lookupIds ?? [],
      specialUsageLookupIds: specialUsage?.lookupIds ?? [],
      specialProductionCount: specialProduction?.recordCount ?? 0,
      specialUsageCount: specialUsage?.recordCount ?? 0
    };
  });
  return {
    goods,
    oreDictionaries: repository.oreDictionaries.map((group) => ({
      ...group,
      ...specialGroupFields(group.id)
    })),
    ingredientGroups: repository.ingredientGroups.map((group) => ({
      ...group,
      ...specialGroupFields(group.id)
    })),
    recipeTypes: repository.recipeTypes.map((recipeType) => ({
      ...recipeType,
      multiblocks: recipeType.multiblocks.map((crafter) => ({
        id: crafter.id,
        name: crafter.name,
        icon: iconResolver(crafter.id, crafter.iconId)
      })),
      singleblocks: recipeType.singleblocks.map((crafter) => ({
        id: crafter.id,
        name: crafter.name,
        icon: iconResolver(crafter.id, crafter.iconId)
      })),
      defaultCrafter: recipeType.defaultCrafter
        ? {
          id: recipeType.defaultCrafter.id,
          name: recipeType.defaultCrafter.name,
          icon: iconResolver(recipeType.defaultCrafter.id, recipeType.defaultCrafter.iconId)
        }
        : null
    })),
    serviceItemIds: repository.serviceItemIds,
    obsoleteRecipeRemaps: repository.obsoleteRecipeRemaps,
    specialViewTypes: specialData
      ? buildSpecialViewTypes(specialData).map((viewType) => ({
        ...viewType,
        recordCount: specialRecords.filter((record) => record.category === viewType.id).length
      }))
      : [],
    specialServiceIcons: specialData?.serviceIcons.map((serviceIcon) => ({
      ...serviceIcon,
      icon: serviceIcon.goodsId
        ? iconResolver(
          serviceIcon.goodsId,
          allGoods.find((entry) => entry.id === serviceIcon.goodsId)?.iconId ?? -1
        )
        : null
    })) ?? []
  };
}

async function ensureNewOutput(outputDirectory: string): Promise<void> {
  try {
    await stat(outputDirectory);
    throw new Error(`Output directory already exists: ${outputDirectory}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function sharedAssetUrl(baseUrl: string, filename: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/assets/sha256/${filename}`;
}

async function writeSharedAsset(
  assetsDirectory: string,
  baseUrl: string,
  id: string,
  bytes: Buffer,
  details: { encoding: ImmutableAsset['encoding']; mediaType: string }
): Promise<ImmutableAsset> {
  const digest = sha256(bytes);
  // The shared object store is keyed by the complete digest. The media type
  // lives in the manifest, so an extension would create duplicate physical
  // objects when two roles happen to contain identical bytes.
  const filename = digest;
  const path = join(assetsDirectory, filename);
  try {
    await writeFile(path, bytes, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readFile(path);
    if (sha256(existing) !== digest) {
      throw new Error(`Shared object collision at ${filename}`, { cause: error });
    }
  }
  return {
    id,
    url: sharedAssetUrl(baseUrl, filename),
    bytes: bytes.byteLength,
    sha256: digest,
    encoding: details.encoding,
    mediaType: details.mediaType
  };
}

function sharedRecipePayload(
  logicalId: string,
  recipeTypeId: string,
  prefix: string,
  recipes: readonly DecodedRecipe[]
): Buffer {
  return gzipMessagePack({
    schemaVersion: 5,
    kind: 'recipeShard',
    logicalId,
    recipeTypeId,
    prefix,
    recipes
  });
}

async function buildSharedRecipeShards(
  repository: DecodedRepository,
  layout: SharedPartitionLayout,
  assetsDirectory: string,
  baseUrl: string
): Promise<{ assets: RecipeShardAsset[]; shardByRecipeId: Map<string, string> }> {
  const recipesByType = new Map<string, SharedRecord[]>();
  for (const recipeType of repository.recipeTypes) recipesByType.set(recipeType.id, []);
  for (const recipe of repository.recipes) {
    const records = recipesByType.get(recipe.recipeTypeId);
    if (!records) throw new Error(`Recipe ${recipe.id} references unknown type ${recipe.recipeTypeId}`);
    records.push({ id: recipe.id, namespace: recipe.recipeTypeId, value: recipe });
  }

  const assets: RecipeShardAsset[] = [];
  const shardByRecipeId = new Map<string, string>();
  const usedIds = new Set<string>();
  for (const recipeType of repository.recipeTypes) {
    const records = recipesByType.get(recipeType.id)!;
    const prefixes = layout.recipeTypes[recipeType.id];
    if (prefixes === undefined) throw new Error(`Shared layout is missing recipe type ${recipeType.id}`);
    const groups = [...groupSharedRecords(records, prefixes)].sort(([left], [right]) => left.localeCompare(right));
    for (const [prefix, group] of groups) {
      const logicalId = sharedLogicalId('recipes', recipeType.id, prefix);
      if (usedIds.has(logicalId)) throw new Error(`Duplicate shared recipe shard ID ${logicalId}`);
      usedIds.add(logicalId);
      const recipeValues = group.map((record) => record.value as DecodedRecipe);
      const bytes = sharedRecipePayload(logicalId, recipeType.id, prefix, recipeValues);
      if (bytes.byteLength > layout.targets.recipes && recipeValues.length > 1) {
        throw new Error(`${logicalId}: shared recipe layout target ${layout.targets.recipes} is too small`);
      }
      const immutable = await writeSharedAsset(
        assetsDirectory,
        baseUrl,
        logicalId,
        bytes,
        { encoding: 'gzip', mediaType: 'application/msgpack' }
      );
      const part = assets.length;
      assets.push({
        ...immutable,
        kind: 'recipeShard',
        recipeTypeId: recipeType.id,
        recipeTypeOrder: recipeType.order,
        part,
        recipeCount: recipeValues.length,
        prefix,
        logicalId,
        oversizedSingleton: bytes.byteLength > layout.targets.recipes && recipeValues.length === 1
      });
      for (const record of group) shardByRecipeId.set(record.id, logicalId);
    }
  }
  return { assets, shardByRecipeId };
}

function sharedSpecialPayload(
  logicalId: string,
  viewTypeId: string,
  prefix: string,
  records: readonly SpecialRecord[]
): Buffer {
  return gzipMessagePack({
    schemaVersion: 5,
    kind: 'special',
    logicalId,
    specialViewTypeId: viewTypeId,
    prefix,
    records
  });
}

async function buildSharedSpecialDataShards(
  data: BrowserNeiSpecialData,
  layout: SharedPartitionLayout,
  assetsDirectory: string,
  baseUrl: string
): Promise<{ assets: SpecialDataShardAsset[]; shardByRecordId: Map<string, string> }> {
  const assets: SpecialDataShardAsset[] = [];
  const shardByRecordId = new Map<string, string>();
  const usedIds = new Set<string>();
  for (const viewType of buildSpecialViewTypes(data)) {
    const records: SharedRecord[] = data.records
      .filter((record) => record.category === viewType.id)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((record) => ({ id: record.id, namespace: viewType.id, value: record }));
    const prefixes = layout.specialViews[viewType.id];
    if (prefixes === undefined) throw new Error(`Shared layout is missing special view ${viewType.id}`);
    const groups = [...groupSharedRecords(records, prefixes)].sort(([left], [right]) => left.localeCompare(right));
    for (const [prefix, group] of groups) {
      const logicalId = sharedLogicalId('special', viewType.id, prefix);
      if (usedIds.has(logicalId)) throw new Error(`Duplicate shared special shard ID ${logicalId}`);
      usedIds.add(logicalId);
      const specialRecords = group.map((record) => record.value as SpecialRecord);
      const bytes = sharedSpecialPayload(logicalId, viewType.id, prefix, specialRecords);
      if (bytes.byteLength > layout.targets.special && specialRecords.length > 1) {
        throw new Error(`${logicalId}: shared special layout target ${layout.targets.special} is too small`);
      }
      const immutable = await writeSharedAsset(
        assetsDirectory,
        baseUrl,
        logicalId,
        bytes,
        { encoding: 'gzip', mediaType: 'application/msgpack' }
      );
      const part = assets.length;
      assets.push({
        ...immutable,
        kind: 'specialData',
        specialViewTypeId: viewType.id,
        specialViewTypeOrder: SPECIAL_CATEGORY_IDS.indexOf(viewType.id),
        part,
        recordCount: specialRecords.length,
        prefix,
        logicalId,
        oversizedSingleton: bytes.byteLength > layout.targets.special && specialRecords.length === 1
      });
      for (const record of group) shardByRecordId.set(record.id, logicalId);
    }
  }
  return { assets, shardByRecordId };
}

function sharedCatalogGoodsPayload(logicalId: string, prefix: string, goods: readonly unknown[]): Buffer {
  return gzipMessagePack({
    schemaVersion: 5,
    kind: 'goods',
    logicalId,
    prefix,
    goods
  });
}

function sharedCatalogMetadataPayload(
  kind: 'core' | 'recipeTypes' | 'ingredientGroups' | 'recipeRemaps' | 'specialMetadata' | 'icons',
  logicalId: string,
  value: Record<string, unknown>
): Buffer {
  return gzipMessagePack({
    schemaVersion: 5,
    kind,
    logicalId,
    ...value
  });
}

function sharedCatalogGoodsMetadataPayload(
  logicalId: string,
  prefix: string,
  goods: readonly Record<string, unknown>[]
): Buffer {
  return gzipMessagePack({
    schemaVersion: 5,
    kind: 'goodsMetadata',
    logicalId,
    prefix,
    goods
  });
}

function sharedCatalogOreDictionaryPayload(
  logicalId: string,
  prefix: string,
  oreDictionaries: readonly unknown[]
): Buffer {
  return gzipMessagePack({
    schemaVersion: 5,
    kind: 'oreDictionaries',
    logicalId,
    prefix,
    oreDictionaries
  });
}

async function buildSharedCatalogAssets(
  repository: DecodedRepository,
  layout: SharedPartitionLayout,
  specialData: BrowserNeiSpecialData | undefined,
  specialShardByRecordId: Map<string, string>,
  shardByRecipeId: Map<string, string>,
  assetsDirectory: string,
  baseUrl: string,
  iconSlots: ReadonlyMap<string, { sheetId: string; index: number }>
): Promise<CatalogAsset[]> {
  const catalog = buildCatalog(
    repository,
    shardByRecipeId,
    specialData,
    specialShardByRecordId,
    (ownerId) => {
      const slot = iconSlots.get(ownerId);
      return slot ? { sheetId: slot.sheetId, index: slot.index } : null;
    }
  );
  const { goods } = catalog;
  const coreLogicalId = 'catalog-core';
  const coreBytes = sharedCatalogMetadataPayload('core', coreLogicalId, {
    serviceItemIds: catalog.serviceItemIds
  });
  const coreImmutable = await writeSharedAsset(
    assetsDirectory,
    baseUrl,
    coreLogicalId,
    coreBytes,
    { encoding: 'gzip', mediaType: 'application/msgpack' }
  );
  const assets: CatalogAsset[] = [{
    ...coreImmutable,
    kind: 'catalog',
    role: 'core',
    part: 0,
    goodsCount: 0,
    logicalId: coreLogicalId
  }];

  const fixedCatalogAssets: Array<{
    role: CatalogAsset['role'];
    kind: 'recipeTypes' | 'ingredientGroups' | 'recipeRemaps' | 'specialMetadata' | 'icons';
    logicalId: string;
    value: Record<string, unknown>;
  }> = [
    {
      role: 'icons', kind: 'icons', logicalId: 'catalog-icons',
      value: { icons: goods.map(({ id, icon }) => ({ id, icon })).sort((a, b) => a.id.localeCompare(b.id)) }
    },
    {
      role: 'recipeTypes',
      kind: 'recipeTypes',
      logicalId: 'catalog-recipe-types',
      value: {
        recipeTypes: catalog.recipeTypes.slice().sort((left, right) => left.id.localeCompare(right.id))
      }
    },
    {
      role: 'ingredientGroups',
      kind: 'ingredientGroups',
      logicalId: 'catalog-ingredient-groups',
      value: {
        ingredientGroups: catalog.ingredientGroups.slice().sort((left, right) => left.id.localeCompare(right.id))
      }
    },
    {
      role: 'recipeRemaps',
      kind: 'recipeRemaps',
      logicalId: 'catalog-recipe-remaps',
      value: {
        obsoleteRecipeRemaps: Object.fromEntries(
          Object.entries(catalog.obsoleteRecipeRemaps ?? {}).sort(([left], [right]) => left.localeCompare(right))
        )
      }
    },
    {
      role: 'specialMetadata',
      kind: 'specialMetadata',
      logicalId: 'catalog-special-metadata',
      value: {
        specialViewTypes: catalog.specialViewTypes ?? [],
        specialServiceIcons: catalog.specialServiceIcons ?? []
      }
    }
  ];
  for (const fixed of fixedCatalogAssets) {
    const bytes = sharedCatalogMetadataPayload(fixed.kind, fixed.logicalId, fixed.value);
    const immutable = await writeSharedAsset(
      assetsDirectory,
      baseUrl,
      fixed.logicalId,
      bytes,
      { encoding: 'gzip', mediaType: 'application/msgpack' }
    );
    assets.push({
      ...immutable,
      kind: 'catalog',
      role: fixed.role,
      part: 0,
      goodsCount: 0,
      logicalId: fixed.logicalId
    });
  }

  const oreRecords: SharedRecord[] = catalog.oreDictionaries
    .map((value) => ({ id: value.id, namespace: 'oreDictionaries', value }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const oreGroups = [...groupSharedRecords(oreRecords, layout.oreDictionaries)]
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [prefix, group] of oreGroups) {
    const logicalId = `catalog-ore-dictionaries-${prefix || 'root'}`;
    const values = group.map((record) => record.value);
    const bytes = sharedCatalogOreDictionaryPayload(logicalId, prefix, values);
    if (bytes.byteLength > layout.targets.oreDictionaries && values.length > 1) {
      throw new Error(`${logicalId}: shared ore-dictionary layout target ${layout.targets.oreDictionaries} is too small`);
    }
    const immutable = await writeSharedAsset(
      assetsDirectory,
      baseUrl,
      logicalId,
      bytes,
      { encoding: 'gzip', mediaType: 'application/msgpack' }
    );
    assets.push({
      ...immutable,
      kind: 'catalog',
      role: 'oreDictionaries',
      part: 0,
      goodsCount: 0,
      recordCount: values.length,
      prefix,
      logicalId,
      oversizedSingleton: bytes.byteLength > layout.targets.oreDictionaries && values.length === 1
    });
  }

  const records: SharedRecord[] = goods
    .map((value) => ({
      id: String((value as { id: string }).id),
      namespace: 'goods',
      value: sharedGoodsStableValue(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'icon')))
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const metadataRecords = goods
    .map((value) => ({
      id: String((value as { id: string }).id),
      namespace: 'goods',
      value: sharedGoodsMetadataValue(value as Record<string, unknown>)
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const groups = [...groupSharedRecords(records, layout.goods)].sort(([left], [right]) => left.localeCompare(right));
  const metadataGroups = new Map([...groupSharedRecords(metadataRecords, layout.goods)]);
  const usedIds = new Set<string>([coreLogicalId]);
  let goodsPart = 0;
  let metadataPart = 0;
  for (const [prefix, group] of groups) {
    const logicalId = `catalog-goods-${prefix || 'root'}`;
    if (usedIds.has(logicalId)) throw new Error(`Duplicate shared catalog shard ID ${logicalId}`);
    usedIds.add(logicalId);
    const partGoods = group.map((record) => record.value);
    const bytes = sharedCatalogGoodsPayload(logicalId, prefix, partGoods);
    if (bytes.byteLength > layout.targets.goods && partGoods.length > 1) {
      throw new Error(`${logicalId}: shared goods layout target ${layout.targets.goods} is too small`);
    }
    const immutable = await writeSharedAsset(
      assetsDirectory,
      baseUrl,
      logicalId,
      bytes,
      { encoding: 'gzip', mediaType: 'application/msgpack' }
    );
    assets.push({
      ...immutable,
      kind: 'catalog',
      role: 'goods',
      part: goodsPart++,
      goodsCount: partGoods.length,
      prefix,
      logicalId,
      oversizedSingleton: bytes.byteLength > layout.targets.goods && partGoods.length === 1
    });

    const metadataLogicalId = `catalog-goods-metadata-${prefix || 'root'}`;
    const metadataGroup = metadataGroups.get(prefix);
    if (!metadataGroup || metadataGroup.length !== group.length) {
      throw new Error(`${metadataLogicalId}: shared goods metadata does not match the goods partition`);
    }
    const metadataValues = metadataGroup.map((record) => record.value as Record<string, unknown>);
    if (metadataValues.some((record) => (
      typeof record.id !== 'string'
      || !Number.isInteger(record.numericId)
    ))) {
      throw new Error(`${metadataLogicalId}: goods metadata contains an invalid identity record`);
    }
    const metadataBytes = sharedCatalogGoodsMetadataPayload(metadataLogicalId, prefix, metadataValues);
    if (metadataBytes.byteLength > layout.targets.goodsMetadata && metadataValues.length > 1) {
      throw new Error(`${metadataLogicalId}: shared goods metadata layout target ${layout.targets.goodsMetadata} is too small`);
    }
    const metadataImmutable = await writeSharedAsset(
      assetsDirectory,
      baseUrl,
      metadataLogicalId,
      metadataBytes,
      { encoding: 'gzip', mediaType: 'application/msgpack' }
    );
    assets.push({
      ...metadataImmutable,
      kind: 'catalog',
      role: 'goodsMetadata',
      part: metadataPart++,
      goodsCount: metadataValues.length,
      prefix,
      logicalId: metadataLogicalId,
      oversizedSingleton: metadataBytes.byteLength > layout.targets.goodsMetadata && metadataValues.length === 1
    });
  }
  return assets;
}


function uniqueAssetBytes(assets: readonly ImmutableAsset[]): number {
  return [...new Map(assets.map((asset) => [asset.sha256, asset.bytes])).values()]
    .reduce((total, bytes) => total + bytes, 0);
}

/** Build the independently selectable, dataset-independent pack. */
export async function buildPack(options: BuildPackOptions): Promise<BuildPackResult> {
  const outputDirectory = resolve(options.outputDirectory);
  await ensureNewOutput(outputDirectory);
  if (!options.layoutPath) throw new Error('Format-6 packs require --layout with a persistent shared layout');
  const layout = JSON.parse(await readFile(options.layoutPath, 'utf8')) as SharedPartitionLayout;
  validateSharedLayout(layout);
  const parent = dirname(outputDirectory);
  const staging = join(parent, `.${basename(outputDirectory)}.staging-${process.pid}`);
  const assetsDirectory = join(staging, 'assets', 'sha256');
  await mkdir(assetsDirectory, { recursive: true });

  const dataBytes = await readFile(options.dataPath);
  const atlasBytes = await readFile(options.atlasPath);
  const originalRepository = decodeFormat5(dataBytes);
  let specialData: BrowserNeiSpecialData | undefined;
  if (options.specialDataPath !== undefined && options.specialData !== undefined) {
    throw new Error('Specify only one of specialDataPath and specialData');
  }
  if (options.specialDataPath !== undefined) {
    specialData = parseBrowserNeiSpecial(await readFile(options.specialDataPath));
  } else if (options.specialData !== undefined) {
    specialData = normalizeBrowserNeiSpecial(options.specialData);
  }
  if (specialData) {
    specialData = repairSpecialServiceIcons(specialData, originalRepository);
    specialData = expandGtOreSpecialData(specialData, originalRepository);
    const repositoryGoodsIds = new Set([
      ...originalRepository.items.map((entry) => entry.id),
      ...originalRepository.fluids.map((entry) => entry.id),
      ...originalRepository.oreDictionaries.map((entry) => entry.id),
      ...originalRepository.ingredientGroups.map((entry) => entry.id)
    ]);
    validateSpecialGoodsReferences(specialData, repositoryGoodsIds);
    validateSpecialOreDictionaries(specialData, originalRepository);
    for (const serviceIcon of specialData.serviceIcons) {
      if (!serviceIcon.goodsId) continue;
      const goods = [...originalRepository.items, ...originalRepository.fluids]
        .find((entry) => entry.id === serviceIcon.goodsId);
      if (!goods) throw new Error(`Special service icon ${serviceIcon.id} references unresolved goods ID ${serviceIcon.goodsId}`);
    }
  }
  const specialDataBytes = specialData
    ? Buffer.from(canonicalSpecialDataJson(specialData), 'utf8')
    : undefined;
  const specialDataSha256 = specialDataBytes ? sha256(specialDataBytes) : undefined;
  const effectiveRevision = specialDataBytes
    ? createHash('sha256').update(options.revision).update('\0').update(specialDataBytes).digest('hex').slice(0, 12)
    : options.revision;
  const datasetId = options.datasetId ?? `${sanitize(options.gtnhVersion)}-r${sanitize(effectiveRevision)}`;
  const displayName = options.displayName ?? `GTNH ${options.gtnhVersion} (revision ${effectiveRevision})`;
  // The published manifest lives at public/data/<dataset>/pack-manifest.json,
  // so ../../assets/sha256 is the immutable global object store.  The local
  // verifier resolves the same object by filename without interpreting URLs.
  const baseUrl = options.baseUrl ?? '../..';
  const repository = sharedRepository(originalRepository);
  const reuse = await readReusePacks(options.reusePacks ?? []);
  const ownerIcons = new Map<string, number>();
  for (const entry of [...repository.items, ...repository.fluids]) ownerIcons.set(entry.id, entry.iconId);
  for (const type of repository.recipeTypes) {
    for (const crafter of [...type.singleblocks, ...type.multiblocks, ...(type.defaultCrafter ? [type.defaultCrafter] : [])]) {
      if (!ownerIcons.has(crafter.id)) ownerIcons.set(crafter.id, crafter.iconId);
    }
  }
  const icons = await buildSharedIcons({
    atlasPath: options.atlasPath,
    owners: [...ownerIcons].map(([id, iconId]) => ({ id, iconId })),
    previous: await Promise.all(reuse.map(async (pack) => {
      const descriptor = pack.manifest.catalogAssets.find((asset) => asset.role === 'icons');
      if (!descriptor) throw new Error(`${pack.manifest.datasetId}: reusable pack has no catalog-icons asset`);
      const payload = decode(await readLogicalAsset(descriptor, pack.manifest, pack.assetsDirectory)) as {
        kind: string;
        icons: Array<{ id: string; icon: { sheetId: string; index: number } | null }>;
      };
      if (payload.kind !== 'icons' || !Array.isArray(payload.icons)) {
        throw new Error(`${pack.manifest.datasetId}: invalid reusable catalog-icons asset`);
      }
      return {
        manifest: pack.manifest,
        assetDirectory: pack.assetsDirectory,
        ownerSlots: new Map(payload.icons.flatMap(({ id, icon }) => icon ? [[id, icon] as const] : []))
      };
    })),
    outputDirectory: staging,
    baseUrl
  });
  const { assets: recipeShards, shardByRecipeId } = await buildSharedRecipeShards(
    repository,
    layout,
    assetsDirectory,
    baseUrl
  );
  const { assets: specialDataShards, shardByRecordId: specialShardByRecordId } = specialData
    ? await buildSharedSpecialDataShards(specialData, layout, assetsDirectory, baseUrl)
    : { assets: [], shardByRecordId: new Map<string, string>() };
  const catalogAssets = await buildSharedCatalogAssets(
    repository,
    layout,
    specialData,
    specialShardByRecordId,
    shardByRecipeId,
    assetsDirectory,
    baseUrl,
    icons.slots
  );
  const iconSheets = icons.assets;
  const recordPages = await buildRecordPages(
    [...catalogAssets, ...recipeShards, ...specialDataShards], assetsDirectory, baseUrl,
    reuse
  );
  const allAssets = [...recordPages, ...iconSheets];
  const retained = new Set(allAssets.map((asset) => asset.sha256));
  for (const filename of await readdir(assetsDirectory)) {
    if (!retained.has(filename)) await unlink(join(assetsDirectory, filename));
  }
  const prefixLayout = sharedPrefixLayout(layout);
  const manifest: GeneratedPackManifest = {
    formatVersion: 6,
    datasetId,
    gtnhVersion: options.gtnhVersion,
    revision: effectiveRevision,
    displayName,
    assetStore: 'global-sha256',
    sharedLayout: {
      schemaVersion: layout.schemaVersion,
      layoutSha256: sharedLayoutFingerprint(layout),
      targets: layout.targets,
      prefixes: {
        recipeTypes: prefixLayout.recipeTypes,
        goods: prefixLayout.goods,
        oreDictionaries: prefixLayout.oreDictionaries,
        specialViews: prefixLayout.specialViews
      }
    },
    source: {
      formatVersion: repository.formatVersion,
      dataSha256: sha256(dataBytes),
      atlasSha256: sha256(atlasBytes),
      ...(specialDataSha256 ? { specialDataSha256 } : {})
    },
    catalogAssets,
    recipeShards,
    iconSheets,
    specialDataShards,
    recordPages,
    totals: {
      searchableEntries: repository.items.filter((item) => item.searchable).length
        + repository.fluids.filter((fluid) => fluid.searchable).length,
      recipes: repository.recipes.length,
      specialRecords: specialData?.records.length ?? 0,
      assets: allAssets.length,
      offlineBytes: uniqueAssetBytes(allAssets)
    }
  };
  // The raw sidecar is an input/provenance artifact, not a browser asset. Its
  // records are already materialized into the content-addressed special
  // shards above; publishing it here would duplicate tens of MiB per
  // dataset and would not be read by the runtime.
  const manifestPath = join(staging, 'pack-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, { flag: 'wx' });
  await rename(staging, outputDirectory);
  return { manifest, manifestPath: join(outputDirectory, 'pack-manifest.json') };
}
