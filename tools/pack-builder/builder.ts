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
  GoodsDetailShardAsset,
  IngredientGroupShardAsset,
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
import { fluidRecipeScope } from '../../src/lib/fluidContainers';
import { canonicalVariantNbt } from '../../src/lib/catalogVariants';
import { goodsIdentityFromId } from '../../src/lib/goodsIdentity';
import { compactRelations } from '../../src/lib/packedRelations';
import { specialLookupMatchesView } from '../../src/lib/specialData';
import { minecraftFormattingSpans, minecraftHtmlPlainText } from '../../src/lib/minecraftText';
import { productionFallbackDictionary } from '../../src/lib/oreDictionary';
import { propagateOreMachineCapabilities, recipeTypeMachineCapabilities } from '../../src/lib/recipePresentation';
import {
  groupSharedRecords,
  sharedLogicalId,
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
        family: 'recipes',
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
        family: 'special',
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
    schemaVersion: 6,
    kind: 'goods',
    logicalId,
    prefix,
    goods
  });
}

function sharedCatalogGoodsSearchPayload(logicalId: string, prefix: string, goods: readonly unknown[]): Buffer {
  const tooltips = new Map<string, string>();
  (goods as Array<{ id: string; tooltip: string | null }>).forEach(({ tooltip }) => {
    const tooltipId = tooltip ? sha256(Buffer.from(tooltip)).slice(0, 16) : null;
    if (tooltipId && tooltip) {
      const previous = tooltips.get(tooltipId);
      if (previous !== undefined && previous !== tooltip) throw new Error('Tooltip fingerprint collision');
      tooltips.set(tooltipId, tooltip);
    }
  });
  return gzipMessagePack({ schemaVersion: 6, kind: 'goodsSearch', logicalId, prefix,
    tooltips: [...tooltips].sort(([a], [b]) => a.localeCompare(b)).map(([id, text]) => ({ id, text })) });
}

function sharedCatalogMetadataPayload(
  kind: 'core' | 'recipeTypes' | 'recipeRemaps' | 'specialMetadata',
  logicalId: string,
  value: Record<string, unknown>
): Buffer {
  return gzipMessagePack({
    schemaVersion: 6,
    kind,
    logicalId,
    ...value
  });
}

function sharedGoodsDetailsPayload(logicalId: string, prefix: string, goods: readonly Record<string, unknown>[]): Buffer {
  const compact = compactRelations(goods.map((value) => Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'numericId' && key !== 'tooltip'))), logicalId);
  return gzipMessagePack({
    schemaVersion: 6,
    kind: 'goodsDetails',
    logicalId,
    prefix,
    goods: compact.records,
    lists: compact.lists,
    goodsTooltips: goods.map(({ id, tooltip }) => ({ id,
      formats: minecraftFormattingSpans(tooltip as string | null) })).filter((value) => value.formats.length > 0)
  });
}

function sharedIngredientGroupsPayload(
  logicalId: string,
  prefix: string,
  ingredientGroups: readonly Record<string, unknown>[]
): Buffer {
  const compact = compactRelations(ingredientGroups, logicalId);
  return gzipMessagePack({
    schemaVersion: 6,
    kind: 'ingredientGroups',
    logicalId,
    prefix,
    ingredientGroups: compact.records,
    lists: compact.lists
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
): Promise<{
  catalogAssets: CatalogAsset[];
  goodsDetailShards: GoodsDetailShardAsset[];
  ingredientGroupShards: IngredientGroupShardAsset[];
}> {
  const catalog = buildCatalog(
    repository,
    shardByRecipeId,
    specialData,
    specialShardByRecordId,
    (ownerId) => {
      const slot = iconSlots.get(ownerId);
      return slot ? { sheetId: slot.sheetId.slice(0, 16), index: slot.index } : null;
    }
  );
  const { goods } = catalog;
  const coreLogicalId = 'catalog-core';
  const allGroups = [...catalog.oreDictionaries, ...catalog.ingredientGroups];
  const coreBytes = sharedCatalogMetadataPayload('core', coreLogicalId, {
    serviceItemIds: catalog.serviceItemIds,
    ingredientGroups: allGroups.map((group) => ({
      id: group.id,
      itemIds: [],
      ...(group.id.startsWith('g:') ? { kind: 'itemGroup' as const } : {})
    })).sort((left, right) => left.id.localeCompare(right.id))
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
    family: 'bootstrap',
    kind: 'catalog',
    role: 'core',
    part: 0,
    goodsCount: 0,
    logicalId: coreLogicalId
  }];

  const fixedCatalogAssets: Array<{
    role: CatalogAsset['role'];
    kind: 'recipeTypes' | 'recipeRemaps' | 'specialMetadata';
    logicalId: string;
    value: Record<string, unknown>;
  }> = [
    {
      role: 'recipeTypes',
      kind: 'recipeTypes',
      logicalId: 'catalog-recipe-types',
      value: {
        recipeTypes: catalog.recipeTypes.slice().sort((left, right) => left.id.localeCompare(right.id))
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
      family: 'bootstrap',
      kind: 'catalog',
      role: fixed.role,
      part: 0,
      goodsCount: 0,
      logicalId: fixed.logicalId
    });
  }

  const searchTextById = new Map(goods.map((value) => [value.id, minecraftHtmlPlainText(value.tooltip) || null]));
  const records: SharedRecord[] = goods
    .map((value) => ({
      id: String((value as { id: string }).id),
      namespace: 'goods',
      value: { ...Object.fromEntries(Object.entries(value).filter(([key, field]) => ![
        'tooltip', 'unlocalizedName', 'searchMask', 'numericId',
        'productionShards', 'usageShards', 'productionCount', 'usageCount',
        'specialProductionShards', 'specialUsageShards',
        'specialProductionLookupIds', 'specialUsageLookupIds',
        'specialProductionCount', 'specialUsageCount', 'container', 'containerItemIds', 'stackSize', 'isGas'
      ].includes(key) && !(key in goodsIdentityFromId(value.id)
        && field === goodsIdentityFromId(value.id)[key as keyof ReturnType<typeof goodsIdentityFromId>]))),
        nbt: value.mod.toLocaleLowerCase() === 'cropsnh' ? value.nbt : null,
        tooltipId: searchTextById.get(value.id) ? sha256(Buffer.from(searchTextById.get(value.id)!)).slice(0, 16) : null,
        ...(value.nbt ? { variantNbtKey: sha256(Buffer.from(canonicalVariantNbt(value.nbt)!)).slice(0, 16) } : {})
      }
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const groups = [...groupSharedRecords(records, layout.goods)].sort(([left], [right]) => left.localeCompare(right));
  const searchGroups = new Map([...groupSharedRecords(goods.map((value) => ({
    id: value.id,
    namespace: 'goods',
    value: { id: value.id, tooltip: searchTextById.get(value.id) ?? null }
  })), layout.goods)]);
  const usedIds = new Set<string>([coreLogicalId]);
  let goodsPart = 0;
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
      family: 'bootstrap',
      kind: 'catalog',
      role: 'goods',
      part: goodsPart++,
      goodsCount: partGoods.length,
      prefix,
      logicalId,
      oversizedSingleton: bytes.byteLength > layout.targets.goods && partGoods.length === 1
    });
    const searchLogicalId = `catalog-goods-search-${prefix || 'root'}`;
    const searchValues = (searchGroups.get(prefix) ?? []).map((record) => record.value);
    const searchBytes = sharedCatalogGoodsSearchPayload(searchLogicalId, prefix, searchValues);
    const searchImmutable = await writeSharedAsset(assetsDirectory, baseUrl, searchLogicalId, searchBytes,
      { encoding: 'gzip', mediaType: 'application/msgpack' });
    assets.push({
      ...searchImmutable, family: 'bootstrap', kind: 'catalog', role: 'goodsSearch',
      part: goodsPart - 1, goodsCount: 0, prefix, logicalId: searchLogicalId,
      oversizedSingleton: searchBytes.byteLength > layout.targets.goodsMetadata && searchValues.length === 1
    });

  }

  const goodsById = new Map(goods.map((value) => [value.id, value]));
  const groupsById = new Map(allGroups.map((value) => [value.id, value]));
  const itemOres = new Map<string, typeof catalog.oreDictionaries>();
  for (const ore of catalog.oreDictionaries) for (const id of ore.itemIds) {
    const memberships = itemOres.get(id) ?? [];
    memberships.push(ore);
    itemOres.set(id, memberships);
  }
  const shardsByRecipeType = new Map<string, string[]>();
  for (const descriptor of repository.recipes) {
    const shard = shardByRecipeId.get(descriptor.id);
    if (!shard) continue;
    const values = shardsByRecipeType.get(descriptor.recipeTypeId) ?? [];
    if (!values.includes(shard)) values.push(shard);
    shardsByRecipeType.set(descriptor.recipeTypeId, values);
  }
  const directCapabilities = new Map<string, Array<{
    recipeTypeId: string; recipeTypeName: string; recipeShards: string[]; maxVoltageTier?: number;
  }>>();
  for (const type of catalog.recipeTypes) for (const machine of recipeTypeMachineCapabilities(type)) {
    const values = directCapabilities.get(machine.id) ?? [];
    values.push({
      recipeTypeId: type.id,
      recipeTypeName: type.name,
      recipeShards: [...(shardsByRecipeType.get(type.id) ?? [])].sort(),
      maxVoltageTier: machine.maxVoltageTier
    });
    directCapabilities.set(machine.id, values);
  }
  const capabilities = propagateOreMachineCapabilities(directCapabilities, allGroups);
  const cropMembers = new Map<string, string[]>();
  const lookupCounts = (lookupIds: string[]) => Object.fromEntries((catalog.specialViewTypes ?? [])
    .map((view) => [view.id, lookupIds.filter((id) => specialLookupMatchesView(id, view.id)).length])
    .filter(([, count]) => Number(count) > 0));
  for (const value of goods) {
    if (value.kind !== 'item' || value.mod.toLocaleLowerCase() !== 'cropsnh'
      || value.internalName !== 'genericSeed' || !value.nbt) continue;
    const crop = value.nbt.match(/(?:^|[,{}]\s*)crop\s*:\s*"([^"]+)"/i)?.[1]?.toLocaleLowerCase();
    if (crop) cropMembers.set(crop, [...(cropMembers.get(crop) ?? []), value.id]);
  }
  const details = goods.map((value) => {
    const fluidScope = fluidRecipeScope(value.id, goodsById);
    const fallback = value.kind === 'item' && value.productionCount === 0
      ? productionFallbackDictionary(value.id, itemOres.get(value.id) ?? [],
        (id) => (goodsById.get(id)?.productionCount ?? 0) > 0)
      : undefined;
    const productionMatchIds = [...(fluidScope?.memberIds ?? new Set(fallback?.itemIds ?? [value.id]))].sort();
    const usageMatchIds = [...(fluidScope?.memberIds ?? new Set([value.id]))].sort();
    const expandSpecialScope = (matches: string[]) => {
    const specialScope = new Set(matches);
    for (const id of [...specialScope]) {
      const item = goodsById.get(id);
      for (const ore of itemOres.get(id) ?? []) {
        const name = ore.id.slice(2).toLocaleLowerCase();
        const gtProduct = ['dust', 'dustpure', 'dustimpure', 'crushed', 'crushedpurified', 'crushedcentrifuged', 'rawore', 'gem']
          .some((prefix) => name.startsWith(prefix));
        const gtHost = name.startsWith('ore') && item?.kind === 'item'
          && item.mod.toLocaleLowerCase() === 'gregtech' && /^gt\.blockores\d*$/i.test(item.internalName);
        if (gtProduct || gtHost) specialScope.add(ore.id);
      }
    }
    if (value.kind === 'item' && value.mod.toLocaleLowerCase() === 'cropsnh' && value.nbt) {
      const crop = value.nbt.match(/(?:^|[,{}]\s*)crop\s*:\s*"([^"]+)"/i)?.[1]?.toLocaleLowerCase();
      for (const id of crop ? cropMembers.get(crop) ?? [] : []) specialScope.add(id);
    }
    return [...specialScope].sort();
    };
    const specialProductionMatchIds = expandSpecialScope(productionMatchIds);
    const specialUsageMatchIds = expandSpecialScope(usageMatchIds);
    const specialUnion = (scope: string[], field: 'specialProductionShards' | 'specialUsageShards'
      | 'specialProductionLookupIds' | 'specialUsageLookupIds') => [...new Set(scope.flatMap((id) =>
        (goodsById.get(id) ?? groupsById.get(id))?.[field] ?? []))].sort();
    const productionShards = [...new Set(productionMatchIds.flatMap((id) => goodsById.get(id)?.productionShards ?? []))].sort();
    const usageShards = [...new Set(usageMatchIds.flatMap((id) => goodsById.get(id)?.usageShards ?? []))].sort();
    return {
      id: value.id,
      tooltip: value.tooltip,
      productionShards: fallback ? [] : productionShards,
      usageShards,
      productionCount: value.productionCount,
      usageCount: value.usageCount,
      specialProductionShards: fallback ? value.specialProductionShards ?? []
        : specialUnion(specialProductionMatchIds, 'specialProductionShards'),
      specialUsageShards: specialUnion(specialUsageMatchIds, 'specialUsageShards'),
      specialProductionCounts: lookupCounts(specialUnion(specialProductionMatchIds, 'specialProductionLookupIds')),
      specialUsageCounts: lookupCounts(specialUnion(specialUsageMatchIds, 'specialUsageLookupIds')),
      specialProductionCount: value.specialProductionCount ?? 0,
      specialUsageCount: value.specialUsageCount ?? 0,
      productionMatchIds: fallback ? [value.id] : productionMatchIds,
      usageMatchIds,
      specialProductionMatchIds: fallback
        ? specialProductionMatchIds.filter((id) => !fallback.itemIds.includes(id)) : specialProductionMatchIds,
      specialUsageMatchIds,
      ...(fallback ? { productionOreDictionaryId: fallback.id } : {}),
      oreDictionaryIds: (itemOres.get(value.id) ?? []).map((ore) => ore.id).sort(),
      container: 'container' in value ? value.container : undefined,
      containerItemIds: 'containerItemIds' in value ? value.containerItemIds : undefined,
      machineCapabilities: capabilities.get(value.id)
    };
  });
  const detailRecords = details.map((value) => ({ id: value.id, namespace: 'goods', value }));
  const detailGroups = [...groupSharedRecords(detailRecords, layout.goods)].sort(([a], [b]) => a.localeCompare(b));
  const goodsDetailShards: GoodsDetailShardAsset[] = [];
  for (const [prefix, group] of detailGroups) {
    const logicalId = `goods-details-${prefix || 'root'}`;
    const values = group.map((record) => record.value as Record<string, unknown>);
    const bytes = sharedGoodsDetailsPayload(logicalId, prefix, values);
    const immutable = await writeSharedAsset(assetsDirectory, baseUrl, logicalId, bytes,
      { encoding: 'gzip', mediaType: 'application/msgpack' });
    goodsDetailShards.push({
      ...immutable, family: 'goods-details', kind: 'goodsDetails', part: goodsDetailShards.length,
      recordCount: values.length, prefix, logicalId,
      oversizedSingleton: bytes.byteLength > layout.targets.goodsMetadata && values.length === 1
    });
  }

  const detailById = new Map(details.map((detail) => [detail.id, detail]));
  const groupValues = allGroups.map((group) => {
    const members = group.itemIds.map((id) => detailById.get(id)).filter((value) => value !== undefined);
    const union = (field: 'productionShards' | 'usageShards' | 'specialProductionShards' | 'specialUsageShards'
      ) =>
      [...new Set([...(field in group ? group[field as keyof typeof group] as string[] ?? [] : []),
        ...group.itemIds.flatMap((id) => goodsById.get(id)?.[field] ?? [])])].sort();
    return {
      ...group,
      productionShards: union('productionShards'),
      usageShards: union('usageShards'),
      productionCount: members.reduce((total, member) => total + member.productionCount, 0),
      usageCount: members.reduce((total, member) => total + member.usageCount, 0),
      specialProductionShards: union('specialProductionShards'),
      specialUsageShards: union('specialUsageShards'),
      specialProductionLookupIds: undefined,
      specialUsageLookupIds: undefined,
      specialProductionCounts: lookupCounts([...new Set([...(group.specialProductionLookupIds ?? []),
        ...group.itemIds.flatMap((id) => goodsById.get(id)?.specialProductionLookupIds ?? [])])]),
      specialUsageCounts: lookupCounts([...new Set([...(group.specialUsageLookupIds ?? []),
        ...group.itemIds.flatMap((id) => goodsById.get(id)?.specialUsageLookupIds ?? [])])]),
      machineCapabilities: capabilities.get(group.id)
    };
  });
  const groupRecords = groupValues.map((value) => ({ id: value.id, namespace: 'oreDictionaries', value }));
  const ingredientGroupShards: IngredientGroupShardAsset[] = [];
  for (const [prefix, group] of [...groupSharedRecords(groupRecords, layout.oreDictionaries)].sort(([a], [b]) => a.localeCompare(b))) {
    const logicalId = `ingredient-groups-${prefix || 'root'}`;
    const values = group.map((record) => record.value);
    const bytes = sharedIngredientGroupsPayload(logicalId, prefix, values);
    const immutable = await writeSharedAsset(assetsDirectory, baseUrl, logicalId, bytes,
      { encoding: 'gzip', mediaType: 'application/msgpack' });
    ingredientGroupShards.push({
      ...immutable, family: 'ingredient-groups', kind: 'ingredientGroups', part: ingredientGroupShards.length,
      recordCount: values.length, prefix, logicalId,
      oversizedSingleton: bytes.byteLength > layout.targets.oreDictionaries && values.length === 1
    });
  }
  return { catalogAssets: assets, goodsDetailShards, ingredientGroupShards };
}


function uniqueAssetBytes(assets: readonly ImmutableAsset[]): number {
  return [...new Map(assets.map((asset) => [asset.sha256, asset.bytes])).values()]
    .reduce((total, bytes) => total + bytes, 0);
}

/** Build the independently selectable, dataset-independent pack. */
export async function buildPack(options: BuildPackOptions): Promise<BuildPackResult> {
  const outputDirectory = resolve(options.outputDirectory);
  await ensureNewOutput(outputDirectory);
  if (!options.layoutPath) throw new Error('Format-7 packs require --layout with a persistent shared layout');
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
  // Dataset URLs are immutable. Keep the browser-pack format in the generated
  // identity so a format migration cannot reuse an older manifest URL that a
  // browser or CDN has cached as immutable.
  const datasetId = options.datasetId
    ?? `${sanitize(options.gtnhVersion)}-v7-r${sanitize(effectiveRevision)}`;
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
      const ownerSlots = new Map<string, { sheetId: string; index: number }>();
      for (const descriptor of pack.manifest.catalogAssets.filter((asset) => asset.role === 'goods')) {
        const payload = decode(await readLogicalAsset(descriptor, pack.manifest, pack.assetsDirectory)) as {
          kind: string;
          goods: Array<{ id: string; icon: { sheetId: string; index: number } | null }>;
        };
        if (payload.kind !== 'goods' || !Array.isArray(payload.goods)) {
          throw new Error(`${pack.manifest.datasetId}: invalid reusable bootstrap goods asset`);
        }
        for (const goods of payload.goods) if (goods.icon) {
          const sheet = pack.manifest.iconSheets.find((sheet) => sheet.sha256.startsWith(goods.icon!.sheetId));
          if (!sheet) throw new Error(`Unknown reusable icon sheet ${goods.icon.sheetId}`);
          ownerSlots.set(goods.id, { ...goods.icon, sheetId: sheet.sha256 });
        }
      }
      return { manifest: pack.manifest, assetDirectory: pack.assetsDirectory, ownerSlots };
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
  const { catalogAssets, goodsDetailShards, ingredientGroupShards } = await buildSharedCatalogAssets(
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
    [...catalogAssets, ...goodsDetailShards, ...ingredientGroupShards, ...recipeShards, ...specialDataShards], assetsDirectory, baseUrl,
    reuse
  );
  const allAssets = [...recordPages, ...iconSheets];
  const retained = new Set(allAssets.map((asset) => asset.sha256));
  for (const filename of await readdir(assetsDirectory)) {
    if (!retained.has(filename)) await unlink(join(assetsDirectory, filename));
  }
  const prefixLayout = sharedPrefixLayout(layout);
  const manifest: GeneratedPackManifest = {
    formatVersion: 7,
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
    goodsDetailShards,
    ingredientGroupShards,
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
