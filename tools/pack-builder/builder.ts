import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { encode } from '@msgpack/msgpack';
import sharp from 'sharp';
import { decodeFormat5 } from './decoder';
import type { DecodedRecipe, DecodedRecipeType, DecodedRepository } from './model';
import type {
  CatalogAsset,
  GeneratedPackManifest,
  IconSheetAsset,
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
  type SpecialRecord,
  type SpecialViewType
} from './special';

const PACK_FORMAT_VERSION = 4;
const DEFAULT_MAX_SHARD_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const ICONS_PER_SHEET = 1024;
const SHEET_COLUMNS = 32;
const SPRITE_SIZE = 32;
const SHEET_SIZE = SHEET_COLUMNS * SPRITE_SIZE;

export interface BuildPackOptions {
  dataPath: string;
  atlasPath: string;
  gtnhVersion: string;
  revision: string;
  outputDirectory: string;
  datasetId?: string;
  displayName?: string;
  baseUrl?: string;
  maxShardBytes?: number;
  maxCatalogBytes?: number;
  /** Parsed sidecar value; useful to library callers and fixture tests. */
  specialData?: unknown;
  /** Path to browser-nei-special.json emitted by the special exporter. */
  specialDataPath?: string;
  maxSpecialShardBytes?: number;
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

function assetUrl(baseUrl: string, filename: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/assets/${filename}`;
}

async function writeImmutableAsset(
  assetsDirectory: string,
  baseUrl: string,
  id: string,
  extension: string,
  bytes: Buffer,
  details: Omit<ImmutableAsset, 'id' | 'url' | 'bytes' | 'sha256' | 'encoding' | 'mediaType'> & {
    encoding: ImmutableAsset['encoding'];
    mediaType: string;
  }
): Promise<ImmutableAsset> {
  const digest = sha256(bytes);
  const filename = `${sanitize(id)}.${digest.slice(0, 16)}.${extension}`;
  const path = join(assetsDirectory, filename);
  await writeFile(path, bytes, { flag: 'wx' });
  const verified = await readFile(path);
  const verifiedDigest = sha256(verified);
  if (verifiedDigest !== digest) throw new Error(`Digest mismatch after writing ${filename}`);
  return {
    id,
    url: assetUrl(baseUrl, filename),
    bytes: bytes.byteLength,
    sha256: digest,
    encoding: details.encoding,
    mediaType: details.mediaType
  };
}

interface EncodedRecipePart {
  recipes: DecodedRecipe[];
  bytes: Buffer;
}

function encodeRecipePart(
  datasetId: string,
  recipeType: DecodedRecipeType,
  recipes: DecodedRecipe[]
): Buffer {
  return gzipMessagePack({
    schemaVersion: PACK_FORMAT_VERSION,
    datasetId,
    recipeTypeId: recipeType.id,
    recipes
  });
}

function splitRecipeParts(
  datasetId: string,
  recipeType: DecodedRecipeType,
  recipes: DecodedRecipe[],
  maxBytes: number
): EncodedRecipePart[] {
  if (recipes.length === 0) return [];
  const bytes = encodeRecipePart(datasetId, recipeType, recipes);
  if (bytes.byteLength <= maxBytes || recipes.length === 1) return [{ recipes, bytes }];
  const middle = Math.ceil(recipes.length / 2);
  return [
    ...splitRecipeParts(datasetId, recipeType, recipes.slice(0, middle), maxBytes),
    ...splitRecipeParts(datasetId, recipeType, recipes.slice(middle), maxBytes)
  ];
}

async function buildRecipeShards(
  repository: DecodedRepository,
  datasetId: string,
  assetsDirectory: string,
  baseUrl: string,
  maxShardBytes: number
): Promise<{ assets: RecipeShardAsset[]; shardByRecipeId: Map<string, string> }> {
  const recipesByType = new Map<string, DecodedRecipe[]>();
  for (const recipeType of repository.recipeTypes) recipesByType.set(recipeType.id, []);
  for (const recipe of repository.recipes) {
    const typeRecipes = recipesByType.get(recipe.recipeTypeId);
    if (!typeRecipes) throw new Error(`Recipe ${recipe.id} references unknown type ${recipe.recipeTypeId}`);
    typeRecipes.push(recipe);
  }

  const assets: RecipeShardAsset[] = [];
  const shardByRecipeId = new Map<string, string>();
  for (const recipeType of repository.recipeTypes) {
    const parts = splitRecipeParts(datasetId, recipeType, recipesByType.get(recipeType.id)!, maxShardBytes);
    for (const [part, encodedPart] of parts.entries()) {
      const id = `recipes-${recipeType.order.toString().padStart(3, '0')}-${part.toString().padStart(3, '0')}`;
      const immutable = await writeImmutableAsset(
        assetsDirectory,
        baseUrl,
        id,
        'mpk',
        encodedPart.bytes,
        { encoding: 'gzip', mediaType: 'application/msgpack' }
      );
      const descriptor: RecipeShardAsset = {
        ...immutable,
        kind: 'recipeShard',
        recipeTypeId: recipeType.id,
        recipeTypeOrder: recipeType.order,
        part,
        recipeCount: encodedPart.recipes.length
      };
      assets.push(descriptor);
      for (const recipe of encodedPart.recipes) shardByRecipeId.set(recipe.id, id);
    }
  }
  return { assets, shardByRecipeId };
}

interface EncodedSpecialPart {
  records: SpecialRecord[];
  bytes: Buffer;
}

function encodeSpecialPart(
  datasetId: string,
  viewType: SpecialViewType,
  part: number,
  records: SpecialRecord[]
): Buffer {
  return gzipMessagePack({
    schemaVersion: PACK_FORMAT_VERSION,
    datasetId,
    kind: 'special',
    specialViewTypeId: viewType.id,
    specialViewTypeOrder: SPECIAL_CATEGORY_IDS.indexOf(viewType.id),
    part,
    records
  });
}

function splitSpecialPart(
  datasetId: string,
  viewType: SpecialViewType,
  records: SpecialRecord[],
  maxBytes: number
): EncodedSpecialPart[] {
  if (records.length === 0) return [];
  // Probe with a deliberately wide part number so the final (smaller) part
  // number cannot grow beyond the requested byte cap.
  const bytes = encodeSpecialPart(datasetId, viewType, 999_999, records);
  if (bytes.byteLength <= maxBytes || records.length === 1) return [{ records, bytes }];
  const middle = Math.ceil(records.length / 2);
  return [
    ...splitSpecialPart(datasetId, viewType, records.slice(0, middle), maxBytes),
    ...splitSpecialPart(datasetId, viewType, records.slice(middle), maxBytes)
  ];
}

/** Deterministically split special records without changing category/ID order. */
export function splitSpecialRecords(
  datasetId: string,
  viewType: SpecialViewType,
  records: SpecialRecord[],
  maxBytes: number
): SpecialRecord[][] {
  return splitSpecialPart(datasetId, viewType, records, maxBytes).map((part) => part.records);
}

async function buildSpecialDataShards(
  data: BrowserNeiSpecialData,
  datasetId: string,
  assetsDirectory: string,
  baseUrl: string,
  maxBytes: number
): Promise<{ assets: SpecialDataShardAsset[]; shardByRecordId: Map<string, string> }> {
  const assets: SpecialDataShardAsset[] = [];
  const shardByRecordId = new Map<string, string>();
  for (const viewType of buildSpecialViewTypes(data)) {
    const records = data.records.filter((record) => record.category === viewType.id);
    const parts = splitSpecialPart(datasetId, viewType, records, maxBytes);
    for (const [part, encodedPart] of parts.entries()) {
      const id = `special-${sanitize(viewType.id)}-${part.toString().padStart(3, '0')}`;
      const bytes = encodeSpecialPart(datasetId, viewType, part, encodedPart.records);
      // Re-encode with the actual part number before hashing.  The split probe
      // intentionally uses part zero, which keeps the recursive size decision
      // independent from the eventual number of shards.
      const immutable = await writeImmutableAsset(
        assetsDirectory,
        baseUrl,
        id,
        'mpk',
        bytes,
        { encoding: 'gzip', mediaType: 'application/msgpack' }
      );
      assets.push({
        ...immutable,
        kind: 'specialData',
        specialViewTypeId: viewType.id,
        specialViewTypeOrder: SPECIAL_CATEGORY_IDS.indexOf(viewType.id),
        part,
        recordCount: encodedPart.records.length
      });
      for (const record of encodedPart.records) shardByRecordId.set(record.id, id);
    }
  }
  return { assets, shardByRecordId };
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
  shardByRecordId: ReadonlyMap<string, string>
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
  return new Map(
    [...mutable.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([goodsId, entry]) => [
      goodsId,
      {
        recipes: finalizeSpecialDirectionIndex(entry.recipes),
        usages: finalizeSpecialDirectionIndex(entry.usages)
      }
    ])
  );
}

function buildCatalog(
  repository: DecodedRepository,
  shardByRecipeId: Map<string, string>,
  specialData: BrowserNeiSpecialData | undefined,
  specialShardByRecordId: Map<string, string>
) {
  const specialRecords = specialData?.records ?? [];
  const specialGoodsIndex = buildSpecialGoodsIndex(specialRecords, specialShardByRecordId);
  const allGoods = [...repository.items, ...repository.fluids];
  const goods = allGoods.map((entry) => {
    const { productionRecipeIds, usageRecipeIds, ...catalogEntry } = entry;
    const special = specialGoodsIndex.get(entry.id);
    const specialProduction = special?.recipes;
    const specialUsage = special?.usages;
    return {
      ...catalogEntry,
      icon: iconReference(entry.iconId),
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
    oreDictionaries: repository.oreDictionaries,
    ingredientGroups: repository.ingredientGroups,
    recipeTypes: repository.recipeTypes.map((recipeType) => ({
      ...recipeType,
      multiblocks: recipeType.multiblocks.map((crafter) => ({ ...crafter, icon: iconReference(crafter.iconId) })),
      singleblocks: recipeType.singleblocks.map((crafter) => ({ ...crafter, icon: iconReference(crafter.iconId) })),
      defaultCrafter: recipeType.defaultCrafter
        ? { ...recipeType.defaultCrafter, icon: iconReference(recipeType.defaultCrafter.iconId) }
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
        ? iconReference(allGoods.find((entry) => entry.id === serviceIcon.goodsId)?.iconId ?? -1)
        : null
    })) ?? []
  };
}

function encodeCatalogGoods(datasetId: string, part: number, goods: unknown[]): Buffer {
  return gzipMessagePack({
    schemaVersion: PACK_FORMAT_VERSION,
    datasetId,
    kind: 'goods',
    part,
    goods
  });
}

export function splitCatalogGoods(
  datasetId: string,
  goods: unknown[],
  maxBytes: number
): unknown[][] {
  if (goods.length === 0) return [[]];
  const bytes = encodeCatalogGoods(datasetId, 0, goods);
  if (bytes.byteLength <= maxBytes || goods.length === 1) return [goods];
  const middle = Math.ceil(goods.length / 2);
  return [
    ...splitCatalogGoods(datasetId, goods.slice(0, middle), maxBytes),
    ...splitCatalogGoods(datasetId, goods.slice(middle), maxBytes)
  ];
}

async function buildCatalogAssets(
  repository: DecodedRepository,
  datasetId: string,
  shardByRecipeId: Map<string, string>,
  specialData: BrowserNeiSpecialData | undefined,
  specialShardByRecordId: Map<string, string>,
  assetsDirectory: string,
  baseUrl: string,
  maxBytes: number
): Promise<CatalogAsset[]> {
  const catalog = buildCatalog(repository, shardByRecipeId, specialData, specialShardByRecordId);
  const { goods, ...core } = catalog;
  const coreBytes = gzipMessagePack({
    schemaVersion: PACK_FORMAT_VERSION,
    datasetId,
    kind: 'core',
    ...core
  });
  const coreAsset = await writeImmutableAsset(
    assetsDirectory,
    baseUrl,
    'catalog-core',
    'mpk',
    coreBytes,
    { encoding: 'gzip', mediaType: 'application/msgpack' }
  );
  const assets: CatalogAsset[] = [{
    ...coreAsset,
    kind: 'catalog',
    role: 'core',
    part: 0,
    goodsCount: 0
  }];
  const parts = splitCatalogGoods(datasetId, goods, maxBytes);
  for (const [part, partGoods] of parts.entries()) {
    const bytes = encodeCatalogGoods(datasetId, part, partGoods);
    if (bytes.byteLength > maxBytes && partGoods.length !== 1) {
      throw new Error(`Catalog goods part ${part} exceeds ${maxBytes} bytes`);
    }
    const id = `catalog-goods-${part.toString().padStart(3, '0')}`;
    const immutable = await writeImmutableAsset(
      assetsDirectory,
      baseUrl,
      id,
      'mpk',
      bytes,
      { encoding: 'gzip', mediaType: 'application/msgpack' }
    );
    assets.push({
      ...immutable,
      kind: 'catalog',
      role: 'goods',
      part,
      goodsCount: partGoods.length
    });
  }
  return assets;
}

async function buildIconSheets(
  atlasPath: string,
  iconCount: number,
  assetsDirectory: string,
  baseUrl: string
): Promise<IconSheetAsset[]> {
  const { data: source, info } = await sharp(atlasPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 8192) throw new Error(`Expected upstream atlas width 8192, got ${info.width}`);
  if (info.channels !== 4) throw new Error(`Expected RGBA atlas data, got ${info.channels} channels`);
  const requiredRows = Math.ceil(iconCount / 256);
  if (info.height < requiredRows * SPRITE_SIZE) {
    throw new Error(`Atlas height ${info.height} cannot contain ${iconCount} 32x32 icons`);
  }

  const sheets: IconSheetAsset[] = [];
  const sheetCount = Math.ceil(iconCount / ICONS_PER_SHEET);
  for (let sheet = 0; sheet < sheetCount; sheet++) {
    const firstIcon = sheet * ICONS_PER_SHEET;
    const sheetIconCount = Math.min(ICONS_PER_SHEET, iconCount - firstIcon);
    const output = Buffer.alloc(SHEET_SIZE * SHEET_SIZE * 4);
    for (let localIcon = 0; localIcon < sheetIconCount; localIcon++) {
      const sourceIcon = firstIcon + localIcon;
      const sourceX = (sourceIcon % 256) * SPRITE_SIZE;
      const sourceY = Math.floor(sourceIcon / 256) * SPRITE_SIZE;
      const targetX = (localIcon % SHEET_COLUMNS) * SPRITE_SIZE;
      const targetY = Math.floor(localIcon / SHEET_COLUMNS) * SPRITE_SIZE;
      for (let row = 0; row < SPRITE_SIZE; row++) {
        const sourceStart = ((sourceY + row) * info.width + sourceX) * 4;
        const targetStart = ((targetY + row) * SHEET_SIZE + targetX) * 4;
        source.copy(output, targetStart, sourceStart, sourceStart + SPRITE_SIZE * 4);
      }
    }
    const encoded = await sharp(output, {
      raw: { width: SHEET_SIZE, height: SHEET_SIZE, channels: 4 }
    }).webp({ lossless: true, effort: 6 }).toBuffer();
    const id = `icons-${sheet.toString().padStart(3, '0')}`;
    const immutable = await writeImmutableAsset(
      assetsDirectory,
      baseUrl,
      id,
      'webp',
      encoded,
      { encoding: 'identity', mediaType: 'image/webp' }
    );
    sheets.push({
      ...immutable,
      kind: 'iconSheet',
      firstIcon,
      iconCount: sheetIconCount,
      columns: SHEET_COLUMNS,
      rows: SHEET_COLUMNS,
      spriteSize: SPRITE_SIZE
    });
  }
  return sheets;
}

async function ensureNewOutput(outputDirectory: string): Promise<void> {
  try {
    await stat(outputDirectory);
    throw new Error(`Output directory already exists: ${outputDirectory}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function buildPack(options: BuildPackOptions): Promise<BuildPackResult> {
  const outputDirectory = resolve(options.outputDirectory);
  await ensureNewOutput(outputDirectory);
  const parent = dirname(outputDirectory);
  const staging = join(parent, `.${basename(outputDirectory)}.staging-${process.pid}`);
  const assetsDirectory = join(staging, 'assets');
  await mkdir(assetsDirectory, { recursive: true });

  const dataBytes = await readFile(options.dataPath);
  const atlasBytes = await readFile(options.atlasPath);
  const repository = decodeFormat5(dataBytes);
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
    const repositoryGoodsIds = new Set([
      ...repository.items.map((entry) => entry.id),
      ...repository.fluids.map((entry) => entry.id)
    ]);
    validateSpecialGoodsReferences(specialData, repositoryGoodsIds);
    validateSpecialOreDictionaries(specialData, repository);
    for (const serviceIcon of specialData.serviceIcons) {
      if (!serviceIcon.goodsId) continue;
      const goods = [...repository.items, ...repository.fluids].find((entry) => entry.id === serviceIcon.goodsId);
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
  const baseUrl = options.baseUrl ?? '.';

  const { assets: recipeShards, shardByRecipeId } = await buildRecipeShards(
    repository,
    datasetId,
    assetsDirectory,
    baseUrl,
    options.maxShardBytes ?? DEFAULT_MAX_SHARD_BYTES
  );

  const { assets: specialDataShards, shardByRecordId: specialShardByRecordId } = specialData
    ? await buildSpecialDataShards(
      specialData,
      datasetId,
      assetsDirectory,
      baseUrl,
      options.maxSpecialShardBytes ?? options.maxShardBytes ?? DEFAULT_MAX_SHARD_BYTES
    )
    : { assets: [], shardByRecordId: new Map<string, string>() };

  const catalogAssets = await buildCatalogAssets(
    repository,
    datasetId,
    shardByRecipeId,
    specialData,
    specialShardByRecordId,
    assetsDirectory,
    baseUrl,
    options.maxCatalogBytes ?? DEFAULT_MAX_CATALOG_BYTES
  );

  const iconIds = [
    ...repository.items.map((item) => item.iconId),
    ...repository.fluids.map((fluid) => fluid.iconId),
    ...repository.recipeTypes.flatMap((type) => [
      ...type.singleblocks.map((crafter) => crafter.iconId),
      ...type.multiblocks.map((crafter) => crafter.iconId),
      type.defaultCrafter?.iconId ?? -1
    ])
  ];
  const iconCount = Math.max(...iconIds) + 1;
  const iconSheets = await buildIconSheets(options.atlasPath, iconCount, assetsDirectory, baseUrl);

  const allAssets = [...catalogAssets, ...recipeShards, ...specialDataShards, ...iconSheets];
  const manifest: GeneratedPackManifest = {
    formatVersion: PACK_FORMAT_VERSION,
    datasetId,
    gtnhVersion: options.gtnhVersion,
    revision: effectiveRevision,
    displayName,
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
    totals: {
      searchableEntries: repository.items.filter((item) => item.searchable).length
        + repository.fluids.filter((fluid) => fluid.searchable).length,
      recipes: repository.recipes.length,
      specialRecords: specialData?.records.length ?? 0,
      assets: allAssets.length,
      offlineBytes: allAssets.reduce((total, asset) => total + asset.bytes, 0)
    }
  };
  if (specialDataBytes) {
    await writeFile(
      join(staging, 'browser-nei-special.json'),
      specialDataBytes,
      { flag: 'wx' }
    );
  }
  const manifestPath = join(staging, 'pack-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await rename(staging, outputDirectory);
  return { manifest, manifestPath: join(outputDirectory, 'pack-manifest.json') };
}
