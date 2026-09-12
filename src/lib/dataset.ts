import { decode } from '@msgpack/msgpack';
import {
  materializeCatalog,
  type MaterializedCatalog
} from './catalogMaterialization';
import { buildCatalogBrowseEntries } from './catalogVariants';
import {
  decompress,
  fetchJsonNetworkFirst,
  fetchVerified,
  yieldToBrowser
} from './datasetAssets';
import type {
  DatasetAsset,
  DatasetManifest,
  PackedCatalog,
  PackedCatalogCore,
  PackedCatalogGoods,
  PackedCatalogIcons,
  PackedCatalogGoodsMetadata,
  PackedCatalogIngredientGroups,
  PackedCatalogOreDictionaries,
  PackedCatalogRecipeRemaps,
  PackedCatalogRecipeTypes,
  PackedCatalogSpecialMetadata,
  PackedGoods,
  PackedGoodsMetadata,
  PackedIngredientGroup,
  PackedOreDictionary,
  PackedRecipe,
  PackedRecipeType,
  PackedShard,
  PackedSpecialRecord,
  PackedSpecialShard,
  VersionsIndex
} from './datasetSchema';
import { ingredientMatchesEntry } from './oreDictionary';
import { fluidRecipeScope } from './fluidContainers';
import { installOfflineAssets } from './offline';
import { materializeRecipe } from './recipeMaterialization';
import { machineCanProcessVoltage } from './recipePresentation';
import { mapProgressively } from './progressive';
import {
  buildCatalogSearchDocuments,
  type CatalogSearchDocument
} from './catalogSearch';
import {
  activateDataset,
  cachedAssetSizes,
  getDataset,
  listDatasets,
  migrateObsoleteDatasetStates,
  recordDatasetAsset,
  saveDataset
} from './storage';
import type {
  AssetDescriptor,
  CatalogBrowseEntry,
  CatalogEntry,
  DatasetState,
  DatasetVersion,
  OfflineInstallProgress,
  Recipe,
  RecipeView
} from './types';
import type { SpecialRecord, SpecialViewType } from './specialData';
import {
  CURRENT_DATASET_CACHE_VERSION,
  isLegacyDatasetState,
  preferredDatasetId,
  replacementDatasetActive
} from './datasetVersions';

function specialRecordGoodsIds(record: PackedSpecialRecord): string[] {
  const result = new Set<string>([
    ...record.goodsIds,
    ...(record.productionGoodsIds ?? []),
    ...(record.usageGoodsIds ?? [])
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
        child.filter((candidate): candidate is string => typeof candidate === 'string')
          .forEach((candidate) => result.add(candidate));
      }
      visit(child);
    }
  };
  visit(record.payload);
  return [...result].sort();
}

function specialRecordGoodsForDirection(
  record: PackedSpecialRecord,
  view: RecipeView
): string[] {
  const extension = view === 'recipes' ? record.productionGoodsIds : record.usageGoodsIds;
  const result = new Set<string>(
    Array.isArray(extension) ? extension : record.goodsIds
  );
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
        child.filter((candidate): candidate is string => typeof candidate === 'string')
          .forEach((candidate) => result.add(candidate));
      }
      visit(child);
    }
  };
  visit(record.payload);
  return [...result];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function isPackedGoodsMetadata(value: unknown): value is PackedGoodsMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && (record.tooltip === null || typeof record.tooltip === 'string')
    && typeof record.unlocalizedName === 'string'
    && isNumberArray(record.searchMask)
    && typeof record.searchable === 'boolean'
    && Number.isInteger(record.numericId)
    && isStringArray(record.productionShards)
    && isStringArray(record.usageShards)
    && Number.isInteger(record.productionCount)
    && Number.isInteger(record.usageCount)
    && isStringArray(record.specialProductionShards)
    && isStringArray(record.specialUsageShards)
    && isStringArray(record.specialProductionLookupIds)
    && isStringArray(record.specialUsageLookupIds)
    && Number.isInteger(record.specialProductionCount)
    && Number.isInteger(record.specialUsageCount);
}

type SharedPrefixFamily = 'goods' | 'oreDictionaries' | 'recipeTypes' | 'specialViews';

function sharedPrefixIsPublished(
  manifest: DatasetManifest,
  family: SharedPrefixFamily,
  namespace: string,
  prefix: unknown
): boolean {
  if (manifest.formatVersion !== 6 || typeof prefix !== 'string') return false;
  const prefixes = manifest.sharedLayout?.prefixes;
  if (!prefixes) return false;
  const list = family === 'recipeTypes' || family === 'specialViews'
    ? prefixes[family]?.[namespace]
    : prefixes[family];
  return Array.isArray(list) && list.includes(prefix);
}

function validSharedPrefixMap(value: unknown): value is Record<string, string[]> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.entries(value as Record<string, unknown>).every(([namespace, prefixes]) => (
      namespace.length > 0
      && Array.isArray(prefixes)
      && prefixes.length > 0
      && prefixes.every((prefix) => typeof prefix === 'string' && /^[0-9a-f]{0,8}$/.test(prefix))
      && new Set(prefixes).size === prefixes.length
    ));
}

function validSharedPrefixList(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((prefix) => typeof prefix === 'string' && /^[0-9a-f]{0,8}$/.test(prefix))
    && new Set(value).size === value.length;
}

function uniqueAssetBytes(assets: readonly DatasetAsset[], hashes?: ReadonlySet<string>): number {
  const bytes = new Map<string, number>();
  for (const asset of assets) {
    if (hashes && !hashes.has(asset.sha256)) continue;
    const previous = bytes.get(asset.sha256);
    if (previous !== undefined && previous !== asset.bytes) {
      throw new Error(`Conflicting asset sizes share hash ${asset.sha256}`);
    }
    bytes.set(asset.sha256, asset.bytes);
  }
  return [...bytes.values()].reduce((total, value) => total + value, 0);
}

function uniqueAssetHashes(assets: readonly DatasetAsset[]): Set<string> {
  return new Set(assets.map((asset) => asset.sha256));
}

function physicalHashesForLogicalAssets(
  assets: readonly DatasetAsset[],
  recordPages: readonly DatasetAsset[]
): Set<string> {
  const physicalPages = new Map(recordPages.map((asset, index) => [index, asset]));
  const result = new Set<string>();
  for (const asset of assets) {
    if (asset.segments) {
      for (const [pageIndex] of asset.segments) {
        const page = physicalPages.get(pageIndex);
        if (!page) {
          throw new Error(`${asset.id}: record page index ${String(pageIndex)} is absent from the manifest`);
        }
        result.add(page.sha256);
      }
    }
  }
  return result;
}

function isLogicalRecordAsset(asset: DatasetAsset): boolean {
  return asset.segments !== undefined;
}

function physicalDescriptorsFor(
  asset: DatasetAsset,
  recordPages: readonly DatasetAsset[]
): DatasetAsset[] {
  if (!asset.segments) return [asset];
  const pages = new Map(recordPages.map((page, index) => [index, page]));
  const result: DatasetAsset[] = [];
  const seen = new Set<string>();
  for (const [pageIndex] of asset.segments) {
    const page = pages.get(pageIndex);
    if (!page) throw new Error(`${asset.id}: record page index ${String(pageIndex)} is absent from the manifest`);
    if (seen.has(page.sha256)) continue;
    result.push(page);
    seen.add(page.sha256);
  }
  return result;
}

async function decodeAssetPayload(asset: DatasetAsset, bytes: Uint8Array): Promise<unknown> {
  return decode(asset.encoding === 'gzip' ? await decompress(bytes) : bytes);
}

function cropsNhSeedKey(goods: PackedGoods | undefined): string | undefined {
  if (
    !goods
    || goods.kind !== 'item'
    || goods.mod.toLocaleLowerCase() !== 'cropsnh'
    || goods.internalName !== 'genericSeed'
    || !goods.nbt
  ) return undefined;
  return goods.nbt.match(/(?:^|[,{}]\s*)crop\s*:\s*"([^"]+)"/i)?.[1]?.toLocaleLowerCase();
}

const GT_ORE_PRODUCT_GROUP_PREFIXES = [
  'dust',
  'dustpure',
  'dustimpure',
  'crushed',
  'crushedpurified',
  'crushedcentrifuged',
  'rawore',
  'gem',
  'gemchipped',
  'gemflawed',
  'gemflawless',
  'gemexquisite'
];

function isGtHostOreGoods(goods: PackedGoods | undefined): boolean {
  return goods?.kind === 'item'
    && goods.mod.toLocaleLowerCase() === 'gregtech'
    && /^gt\.blockores\d*$/i.test(goods.internalName);
}

function isGtOreSpecialGroup(groupId: string, goods: PackedGoods | undefined): boolean {
  const name = groupId.slice(2).toLocaleLowerCase();
  if (name.startsWith('ore')) return isGtHostOreGoods(goods);
  return GT_ORE_PRODUCT_GROUP_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export interface DatasetLoadProgress {
  percent: number;
  stage: string;
  gtnhVersion?: string;
}

export interface RecipeLoadProgress {
  loadedShards: number;
  totalShards: number;
  batch: Recipe[];
}

type DecodedCatalogAsset = PackedCatalogCore
  | PackedCatalogGoods
  | PackedCatalogIcons
  | PackedCatalogGoodsMetadata
  | PackedCatalogRecipeTypes
  | PackedCatalogOreDictionaries
  | PackedCatalogIngredientGroups
  | PackedCatalogRecipeRemaps
  | PackedCatalogSpecialMetadata;

type CatalogAssetDescriptor = DatasetManifest['catalogAssets'][number];
type RecipeShardDescriptor = DatasetManifest['recipeShards'][number];
type SpecialShardDescriptor = DatasetManifest['specialDataShards'][number];

function validateCatalogAsset(
  manifest: DatasetManifest,
  asset: CatalogAssetDescriptor,
  value: DecodedCatalogAsset
): void {
  if (value.schemaVersion !== 5) {
    throw new Error(`${asset.id}: catalog identity mismatch`);
  }
  if (value.kind !== asset.role || value.logicalId !== asset.logicalId) {
    throw new Error(`${asset.id}: shared catalog logical identity mismatch`);
  }
  if (asset.role === 'goods' || asset.role === 'goodsMetadata' || asset.role === 'oreDictionaries') {
    const valuePrefix = 'prefix' in value ? value.prefix : undefined;
    if (valuePrefix !== asset.prefix) {
      throw new Error(`${asset.id}: shared catalog partition identity mismatch`);
    }
    if (!sharedPrefixIsPublished(
      manifest,
      asset.role === 'oreDictionaries' ? 'oreDictionaries' : 'goods',
      'goods',
      asset.prefix
    )) {
      throw new Error(`${asset.id}: shared catalog prefix is not in the published layout`);
    }
  }
}

async function loadCatalog(
  manifest: DatasetManifest,
  manifestUrl: string,
  report: (percent: number, stage: string) => void,
  reusableAssets?: ReadonlyMap<string, DecodedCatalogAsset>
): Promise<{
  catalog: PackedCatalog;
  decodedByHash: Map<string, DecodedCatalogAsset>;
}> {
  if (manifest.catalogAssets.length === 0) throw new Error('Pack manifest has no catalog assets');
  if (manifest.catalogAssets.some((asset) => !isLogicalRecordAsset(asset))) {
    throw new Error('Format-6 catalog assets must use record-page segments');
  }

  const assetsToDecode = manifest.catalogAssets.filter((asset) => !reusableAssets?.has(asset.sha256));
  const catalogPages = [...new Map(
    assetsToDecode.flatMap((asset) => physicalDescriptorsFor(asset, manifest.recordPages))
      .map((page) => [page.sha256, page] as const)
  ).values()];
  const loaded = new Array(catalogPages.length).fill(0) as number[];
  const totalBytes = catalogPages.reduce((total, asset) => total + asset.bytes, 0);
  await mapProgressively(
    catalogPages,
    3,
    async (page, index) => fetchVerified(page, manifestUrl, ({ loaded: assetLoaded, cached }) => {
      loaded[index] = Math.max(loaded[index]!, Math.min(page.bytes, assetLoaded));
      const ratio = loaded.reduce((total, value) => total + value, 0) / Math.max(1, totalBytes);
      report(12 + Math.round(ratio * 52), cached ? 'Reading shared catalog data' : 'Downloading changed catalog data');
    }),
    ({ completed, total }) => report(
      12 + Math.round(completed / Math.max(1, total) * 52),
      `Loading shared catalog page ${completed.toLocaleString()} of ${total.toLocaleString()}`
    )
  );
  const decoded = await mapProgressively(
    manifest.catalogAssets,
    3,
    async (asset) => {
      const reusable = reusableAssets?.get(asset.sha256);
      if (reusable) {
        validateCatalogAsset(manifest, asset, reusable);
        return reusable;
      }
      const bytes = await fetchVerified(asset, manifestUrl, undefined, undefined, manifest);
      const value = await decodeAssetPayload(asset, bytes) as DecodedCatalogAsset;
      validateCatalogAsset(manifest, asset, value);
      return value;
    },
    ({ completed, total }) => report(
      65 + Math.round(completed / total * 22),
      `Decoding catalog chunk ${completed.toLocaleString()} of ${total.toLocaleString()}`
    )
  );
  const coreAssets = decoded.filter((asset): asset is PackedCatalogCore => asset.kind === 'core');
  const goodsAssets = decoded
    .filter((asset): asset is PackedCatalogGoods => asset.kind === 'goods');
  if (coreAssets.length !== 1 || goodsAssets.length === 0) {
    throw new Error('Catalog requires one core and at least one goods chunk');
  }
  const core = coreAssets[0]!;
  const catalogRoleCounts = new Map<string, number>();
  for (const asset of decoded) catalogRoleCounts.set(asset.kind, (catalogRoleCounts.get(asset.kind) ?? 0) + 1);
  for (const role of ['core', 'recipeTypes', 'ingredientGroups', 'recipeRemaps', 'specialMetadata', 'icons']) {
    if (catalogRoleCounts.get(role) !== 1) {
      throw new Error(`Catalog requires exactly one ${role} asset`);
    }
  }
  const oreAssets = decoded
    .filter((asset): asset is PackedCatalogOreDictionaries => asset.kind === 'oreDictionaries');
  if (oreAssets.length === 0) throw new Error('Catalog requires at least one ore-dictionary asset');
  if ((catalogRoleCounts.get('goodsMetadata') ?? 0) === 0) {
    throw new Error('Catalog requires at least one goodsMetadata asset');
  }
  const typeAsset = decoded.find((asset): asset is PackedCatalogRecipeTypes => asset.kind === 'recipeTypes')!;
  const ingredientAsset = decoded.find((asset): asset is PackedCatalogIngredientGroups => asset.kind === 'ingredientGroups')!;
  const remapAsset = decoded.find((asset): asset is PackedCatalogRecipeRemaps => asset.kind === 'recipeRemaps')!;
  const specialAsset = decoded.find((asset): asset is PackedCatalogSpecialMetadata => asset.kind === 'specialMetadata')!;
  const iconAsset = decoded.find((asset): asset is PackedCatalogIcons => asset.kind === 'icons')!;
  const oreDictionaries = oreAssets.flatMap((asset) => asset.oreDictionaries);
  const goodsMetadata = new Map<string, PackedGoodsMetadata>();
  for (const asset of decoded.filter((candidate): candidate is PackedCatalogGoodsMetadata => candidate.kind === 'goodsMetadata')) {
    if (!sharedPrefixIsPublished(manifest, 'goods', 'goods', asset.prefix)) {
      throw new Error('Goods metadata prefix is not in the published layout');
    }
    for (const goods of asset.goods) {
      if (!isPackedGoodsMetadata(goods)) {
        throw new Error(`Invalid goods metadata record ${String((goods as { id?: unknown }).id)}`);
      }
      if (goodsMetadata.has(goods.id)) throw new Error(`Duplicate goods metadata ID ${goods.id}`);
      goodsMetadata.set(goods.id, goods);
    }
  }
  const icons = new Map(iconAsset.icons.map((record) => [record.id, record.icon]));
  const goodsValues = goodsAssets.flatMap((asset) => asset.goods.map((goods): PackedGoods => ({
    ...goods,
    ...goodsMetadata.get(goods.id),
    icon: icons.get(goods.id) ?? null
  })));
  {
    const goodsIds = new Set(goodsValues.map((goods) => goods.id));
    if (goodsMetadata.size !== goodsIds.size || [...goodsMetadata.keys()].some((id) => !goodsIds.has(id))) {
      throw new Error('Goods metadata does not cover exactly the goods catalog');
    }
    if (icons.size !== goodsIds.size || [...icons.keys()].some((id) => !goodsIds.has(id))) {
      throw new Error('Icon references do not cover exactly the goods catalog');
    }
    const goodsIdsByPrefix = new Map<string, Set<string>>();
    for (const asset of goodsAssets) {
      if (typeof asset.prefix !== 'string' || typeof asset.logicalId !== 'string') {
        throw new Error('Goods catalog asset is missing its persistent partition identity');
      }
      goodsIdsByPrefix.set(asset.prefix, new Set(asset.goods.map((goods) => goods.id)));
    }
    const metadataIdsByPrefix = new Map<string, Set<string>>();
    for (const asset of decoded.filter((candidate): candidate is PackedCatalogGoodsMetadata => candidate.kind === 'goodsMetadata')) {
      metadataIdsByPrefix.set(asset.prefix, new Set(asset.goods.map((goods) => goods.id)));
    }
    if (goodsIdsByPrefix.size !== metadataIdsByPrefix.size
      || [...goodsIdsByPrefix.entries()].some(([prefix, ids]) => {
        const metadataIds = metadataIdsByPrefix.get(prefix);
        return metadataIds === undefined
          || ids.size !== metadataIds.size
          || [...ids].some((id) => !metadataIds.has(id));
      })) {
      throw new Error('Goods metadata partitions do not match goods partitions');
    }
  }
  return {
    catalog: {
      datasetId: manifest.datasetId,
      goods: goodsValues,
      recipeTypes: typeAsset?.recipeTypes ?? core.recipeTypes,
      oreDictionaries,
      ingredientGroups: ingredientAsset?.ingredientGroups ?? core.ingredientGroups ?? [],
      serviceItemIds: core.serviceItemIds,
      obsoleteRecipeRemaps: remapAsset?.obsoleteRecipeRemaps ?? core.obsoleteRecipeRemaps,
      specialViewTypes: specialAsset?.specialViewTypes ?? core.specialViewTypes,
      specialServiceIcons: specialAsset?.specialServiceIcons ?? core.specialServiceIcons
    },
    decodedByHash: new Map(manifest.catalogAssets.map((asset, index) => [asset.sha256, decoded[index]!] as const))
  };
}

export class DatasetRepository {
  readonly entries: CatalogEntry[];
  readonly browseEntries: CatalogBrowseEntry[];
  readonly searchDocuments: CatalogSearchDocument[];
  readonly datasetId: string;
  readonly gtnhVersion: string;
  readonly revision: string;
  /** NEI special tabs supplied by the canonical pack. */
  readonly specialViewTypes: readonly SpecialViewType[];
  /** Service icons are deliberately not searchable catalog goods. */
  readonly specialServiceIcons: ReadonlyArray<{
    id: string;
    label: string;
    goodsId?: string;
    searchable: false;
    icon: CatalogEntry['icon'] | null;
  }>;
  private readonly manifest: DatasetManifest;
  private readonly manifestUrl: string;
  private readonly packedGoods: Map<string, PackedGoods>;
  private readonly types: Map<string, PackedRecipeType>;
  private readonly ingredientGroups: Map<string, PackedOreDictionary | PackedIngredientGroup>;
  private readonly productionFallbacks: Map<string, PackedOreDictionary>;
  /** Decoded raw catalog chunks retained only for the next version switch. */
  private readonly catalogAssetsByHash: Map<string, DecodedCatalogAsset>;
  private readonly shards = new Map<string, Promise<PackedRecipe[]>>();
  private readonly specialShards = new Map<string, Promise<PackedSpecialRecord[]>>();
  /** Loaded shard promises borrowed from the repository being replaced. */
  private readonly reusableRecipeShards = new Map<string, Promise<PackedRecipe[]>>();
  private readonly reusableSpecialShards = new Map<string, Promise<PackedSpecialRecord[]>>();

  private get assets(): DatasetAsset[] {
    return [
      ...this.manifest.recordPages,
      ...this.manifest.iconSheets
    ];
  }

  get displayName(): string {
    return this.manifest.displayName;
  }

  get offlineBytes(): number {
    return uniqueAssetBytes(this.assets);
  }

  /** Physical bytes this dataset would add to the existing browser cache. */
  async uncachedOfflineBytes(): Promise<number> {
    const unique = new Map<string, DatasetAsset>();
    for (const asset of this.assets) {
      const previous = unique.get(asset.sha256);
      if (previous && previous.bytes !== asset.bytes) {
        throw new Error(`Conflicting asset sizes share hash ${asset.sha256}`);
      }
      if (!previous) unique.set(asset.sha256, asset);
    }
    let total = 0;
    const cachedSizes = await cachedAssetSizes();
    for (const asset of unique.values()) {
      if (cachedSizes.get(asset.sha256) !== asset.bytes) total += asset.bytes;
    }
    return total;
  }

  private constructor(
    manifest: DatasetManifest,
    manifestUrl: string,
    catalog: PackedCatalog,
    materialized?: MaterializedCatalog,
    browseEntries?: CatalogBrowseEntry[],
    searchDocuments?: CatalogSearchDocument[],
    decodedCatalogAssets?: ReadonlyMap<string, DecodedCatalogAsset>,
    reuseFrom?: DatasetRepository
  ) {
    this.manifest = manifest;
    this.manifestUrl = manifestUrl;
    this.datasetId = manifest.datasetId;
    this.gtnhVersion = manifest.gtnhVersion;
    this.revision = manifest.revision;
    const resolved = materialized ?? materializeCatalog(manifest, manifestUrl, catalog);
    this.entries = resolved.entries;
    this.browseEntries = browseEntries ?? buildCatalogBrowseEntries(resolved.entries);
    this.searchDocuments = searchDocuments
      ?? buildCatalogSearchDocuments(this.browseEntries, this.entries);
    this.packedGoods = resolved.goods;
    this.types = resolved.recipeTypes;
    this.ingredientGroups = resolved.ingredientGroups;
    this.productionFallbacks = resolved.productionFallbacks;
    this.catalogAssetsByHash = new Map(decodedCatalogAssets ?? []);
    for (const descriptor of manifest.recipeShards) {
      const sourceDescriptor = reuseFrom?.manifest.recipeShards.find(
        (candidate) => candidate.sha256 === descriptor.sha256
          && candidate.id === descriptor.id
          && candidate.logicalId === descriptor.logicalId
          && candidate.recipeTypeId === descriptor.recipeTypeId
          && candidate.prefix === descriptor.prefix
      );
      const sourceShard = sourceDescriptor && reuseFrom?.shards.get(sourceDescriptor.id);
      if (sourceShard) this.reusableRecipeShards.set(descriptor.sha256, sourceShard);
    }
    for (const descriptor of manifest.specialDataShards) {
      const sourceDescriptor = reuseFrom?.manifest.specialDataShards.find(
        (candidate) => candidate.sha256 === descriptor.sha256
          && candidate.id === descriptor.id
          && candidate.logicalId === descriptor.logicalId
          && candidate.specialViewTypeId === descriptor.specialViewTypeId
          && candidate.prefix === descriptor.prefix
      );
      const sourceShard = sourceDescriptor && reuseFrom?.specialShards.get(sourceDescriptor.id);
      if (sourceShard) this.reusableSpecialShards.set(descriptor.sha256, sourceShard);
    }
    this.specialViewTypes = (catalog.specialViewTypes ?? []).map((viewType, order) => ({
      ...viewType,
      order
    }));
    const entriesById = new Map(this.entries.map((entry) => [entry.id, entry]));
    this.specialServiceIcons = (catalog.specialServiceIcons ?? []).map((icon) => ({
      ...icon,
      icon: icon.goodsId ? entriesById.get(icon.goodsId)?.icon ?? null : null
    }));
    const serviceIconIds = new Set(this.specialServiceIcons.map((icon) => icon.id));
    for (const icon of this.specialServiceIcons) {
      if (icon.goodsId && !entriesById.has(icon.goodsId)) {
        throw new Error(`Special service icon ${icon.id} references unknown goods ${icon.goodsId}`);
      }
    }
    for (const viewType of this.specialViewTypes) {
      if (!viewType.serviceIconId || !serviceIconIds.has(viewType.serviceIconId)) {
        throw new Error(`Special view ${viewType.id} references unknown service icon ${viewType.serviceIconId}`);
      }
    }
  }

  static async availableVersions(): Promise<DatasetVersion[]> {
    const versionsUrl = new URL('./versions.json', document.baseURI).href;
    return (await fetchJsonNetworkFirst<VersionsIndex>(
      versionsUrl,
      `versions:${versionsUrl}`
    )).value.versions;
  }

  static async load(
    datasetId?: string,
    onProgress?: (progress: DatasetLoadProgress) => void,
    /** The active repository, whose already-decoded immutable data may be borrowed. */
    reuseFrom?: DatasetRepository
  ): Promise<DatasetRepository> {
    const progressContext: { gtnhVersion?: string } = {};
    let lastPercent = 0;
    const report = (percent: number, stage: string) => {
      lastPercent = Math.max(lastPercent, Math.min(100, percent));
      onProgress?.({
      percent: lastPercent,
      stage,
      gtnhVersion: progressContext.gtnhVersion
      });
    };
    const versionsUrl = new URL('./versions.json', document.baseURI).href;
    report(3, 'Checking available GTNH versions');
    const versionsResult = await fetchJsonNetworkFirst<VersionsIndex>(versionsUrl, `versions:${versionsUrl}`);
    const versions = versionsResult.value;
    const installed = await listDatasets();
    const selectedId = preferredDatasetId(versions.versions, installed, datasetId);
    const published = versions.versions.find((version) => version.datasetId === selectedId);
    const installedSelection = installed.find((dataset) => dataset.datasetId === selectedId);
    const selected = published ?? (installedSelection ? {
      datasetId: installedSelection.datasetId,
      gtnhVersion: installedSelection.gtnhVersion,
      revision: installedSelection.revision,
      packManifestUrl: installedSelection.manifestUrl
    } : undefined);
    if (!selected) throw new Error('No published GTNH datasets are available');
    progressContext.gtnhVersion = selected.gtnhVersion;
    report(5, 'Dataset selected');
    const manifestUrl = new URL(selected.packManifestUrl, versionsResult.url).href;
    report(8, 'Loading dataset manifest');
    const manifestResult = await fetchJsonNetworkFirst<DatasetManifest>(
      manifestUrl,
      `manifest:${manifestUrl}`
    );
    const manifest = manifestResult.value;
    if (manifest.formatVersion !== 6) {
      throw new Error(`Unsupported pack manifest format ${String(manifest.formatVersion)}; only format 6 is supported`);
    }
    if (!Array.isArray(manifest.recordPages) || manifest.recordPages.length === 0) {
      throw new Error('Format-6 manifest has no record pages');
    }
    if (manifest.catalogAssets.some((asset) => !isLogicalRecordAsset(asset))
      || manifest.recipeShards.some((asset) => !isLogicalRecordAsset(asset))
      || manifest.specialDataShards.some((asset) => !isLogicalRecordAsset(asset))) {
      throw new Error('Format-6 logical assets must use record-page segments');
    }
    const recordPageHashes = new Set(manifest.recordPages.map((asset) => asset.sha256));
    if (recordPageHashes.size !== manifest.recordPages.length
      || manifest.recordPages.some((asset) => !/^[a-f0-9]{64}$/.test(asset.sha256)
        || !Number.isSafeInteger(asset.bytes)
        || asset.bytes < 0
        || asset.encoding !== 'gzip'
        || typeof asset.url !== 'string'
        || asset.url.length === 0
        || asset.segments !== undefined)) {
      throw new Error('Format-6 manifest has invalid physical record pages');
    }
    for (const asset of [
      ...manifest.catalogAssets,
      ...manifest.recipeShards,
      ...manifest.specialDataShards
    ]) {
      if (asset.encoding !== 'identity' || asset.url !== ''
        || !asset.segments!.every(([pageIndex, first, count]) => Number.isSafeInteger(pageIndex)
          && pageIndex >= 0
          && pageIndex < manifest.recordPages.length
          && Number.isSafeInteger(first)
          && Number.isSafeInteger(count)
          && first >= 0
          && count >= 1)) {
        throw new Error(`${asset.id}: invalid record-page logical descriptor`);
      }
    }
    {
      const layout = manifest.sharedLayout;
      if (!layout
        || manifest.assetStore !== 'global-sha256'
        || layout.schemaVersion !== 1
        || !/^[a-f0-9]{64}$/.test(layout.layoutSha256)
        || !validSharedPrefixMap(layout.prefixes.recipeTypes)
        || !validSharedPrefixList(layout.prefixes.goods)
        || !validSharedPrefixList(layout.prefixes.oreDictionaries)
        || !validSharedPrefixMap(layout.prefixes.specialViews)) {
        throw new Error('Manifest is missing shared object-store metadata');
      }
      if (Object.values(layout.targets).some((bytes) => !Number.isInteger(bytes) || bytes < 1024)) {
        throw new Error('Manifest has invalid shared-layout targets');
      }
    }
    if (manifest.datasetId !== selected.datasetId) throw new Error('Manifest dataset identity mismatch');
    const legacyStates = installed.filter(isLegacyDatasetState);
    const sameVersionStates = installed.filter((state) =>
      state.gtnhVersion === manifest.gtnhVersion && state.datasetId !== manifest.datasetId
    );
    const obsoleteStates = [...new Map(
      [...sameVersionStates, ...legacyStates]
        .map((state) => [state.datasetId, state] as const)
    ).values()];
    report(12, 'Loading catalog');
    const loadedCatalog = await loadCatalog(
      manifest,
      manifestResult.url,
      report,
      reuseFrom?.catalogAssetsByHash
    );
    report(93, 'Preparing items and ore dictionaries');
    const repository = new DatasetRepository(
      manifest,
      manifestResult.url,
      loadedCatalog.catalog,
      undefined,
      undefined,
      undefined,
      loadedCatalog.decodedByHash,
      reuseFrom
    );
    const previous = await getDataset(manifest.datasetId);
    const manifestAssetHashes = new Set(repository.assets.map((asset) => asset.sha256));
    const assetHashes = new Set(
      (previous?.assetHashes ?? []).filter((hash) => manifestAssetHashes.has(hash))
    );
    const cachedSizes = await cachedAssetSizes();
    for (const asset of repository.assets) {
      if (cachedSizes.get(asset.sha256) === asset.bytes) assetHashes.add(asset.sha256);
    }
    const allAssets = repository.assets;
    const catalogHashes = physicalHashesForLogicalAssets(manifest.catalogAssets, manifest.recordPages);
    const storedBytes = uniqueAssetBytes(allAssets, assetHashes);
    const complete = [...uniqueAssetHashes(allAssets)].every((hash) => assetHashes.has(hash));
    await saveDataset({
      datasetId: manifest.datasetId,
      gtnhVersion: manifest.gtnhVersion,
      revision: manifest.revision,
      displayName: manifest.displayName,
      manifestUrl: manifestResult.url,
      cacheVersion: CURRENT_DATASET_CACHE_VERSION,
      status: complete
        ? 'complete'
        : allAssets.some((asset) =>
          !catalogHashes.has(asset.sha256) && assetHashes.has(asset.sha256))
          ? 'partial'
          : 'catalog',
      storedBytes,
      totalBytes: repository.offlineBytes,
      active: replacementDatasetActive(previous ?? undefined, sameVersionStates, installed),
      assetHashes: [...assetHashes],
      updatedAt: Date.now()
    });
    if (obsoleteStates.length > 0) {
      report(97, 'Migrating cached dataset bookkeeping');
      await migrateObsoleteDatasetStates(manifest.datasetId, obsoleteStates);
    }
    report(100, 'Catalog ready');
    return repository;
  }

  static loadLatest(onProgress?: (progress: DatasetLoadProgress) => void): Promise<DatasetRepository> {
    return DatasetRepository.load(undefined, onProgress);
  }

  async activate(): Promise<void> {
    await activateDataset(this.datasetId);
  }

  async installOffline(
    onProgress?: (progress: OfflineInstallProgress) => void,
    signal?: AbortSignal
  ): Promise<DatasetState> {
    const current = await getDataset(this.datasetId);
    const completed = new Set<string>();
    const cachedSizes = await cachedAssetSizes();
    for (const asset of this.assets) {
      if (cachedSizes.get(asset.sha256) === asset.bytes) {
        completed.add(asset.sha256);
      }
    }
    const persist = async (hashes: ReadonlySet<string>, complete: boolean) => {
      const storedBytes = uniqueAssetBytes(this.assets, hashes);
      const catalogHashes = physicalHashesForLogicalAssets(
        this.manifest.catalogAssets,
        this.manifest.recordPages
      );
      await saveDataset({
        datasetId: this.datasetId,
        gtnhVersion: this.gtnhVersion,
        revision: this.revision,
        displayName: this.displayName,
        manifestUrl: this.manifestUrl,
        cacheVersion: CURRENT_DATASET_CACHE_VERSION,
        status: complete
          ? 'complete'
          : this.assets.some((asset) =>
            !catalogHashes.has(asset.sha256) && hashes.has(asset.sha256))
            ? 'partial'
            : 'catalog',
        storedBytes,
        totalBytes: this.offlineBytes,
        active: current?.active ?? false,
        assetHashes: [...hashes],
        updatedAt: Date.now()
      });
    };
    const hashes = await installOfflineAssets({
      assets: this.assets as AssetDescriptor[],
      completedHashes: completed,
      concurrency: 3,
      attempts: 3,
      signal,
      load: async (asset, progress, assetSignal) => {
        await fetchVerified(asset, this.manifestUrl, ({ loaded }) => progress(loaded), assetSignal);
      },
      persist,
      onProgress
    });
    await persist(hashes, true);
    return (await getDataset(this.datasetId))!;
  }

  private async recordAsset(asset: DatasetAsset): Promise<void> {
    for (const physical of physicalDescriptorsFor(asset, this.manifest.recordPages)) {
      await recordDatasetAsset(this.datasetId, physical.sha256, physical.bytes);
    }
  }

  private validateRecipeRecords(
    descriptor: RecipeShardDescriptor,
    recipes: PackedRecipe[]
  ): PackedRecipe[] {
    if (!Array.isArray(recipes) || recipes.length !== descriptor.recipeCount) {
      throw new Error(`${descriptor.id}: recipe count mismatch`);
    }
    if (!sharedPrefixIsPublished(this.manifest, 'recipeTypes', descriptor.recipeTypeId, descriptor.prefix)) {
      throw new Error(`${descriptor.id}: recipe shard prefix is not in the published layout`);
    }
    if (!this.types.has(descriptor.recipeTypeId)) {
      throw new Error(`${descriptor.id}: recipe shard references an unknown recipe type`);
    }
    let previousId: string | undefined;
    for (const recipe of recipes) {
      if (!recipe || typeof recipe.id !== 'string' || recipe.recipeTypeId !== descriptor.recipeTypeId) {
        throw new Error(`${descriptor.id}: recipe has an invalid or mismatched identity`);
      }
      if (previousId !== undefined && recipe.id.localeCompare(previousId) < 0) {
        throw new Error(`${descriptor.id}: recipes are not sorted`);
      }
      previousId = recipe.id;
    }
    return recipes;
  }

  private async loadRecipeShard(descriptor: RecipeShardDescriptor): Promise<PackedRecipe[]> {
    const bytes = await fetchVerified(descriptor, this.manifestUrl, undefined, undefined, this.manifest);
    await this.recordAsset(descriptor);
    const shard = await decodeAssetPayload(descriptor, bytes) as PackedShard;
    await yieldToBrowser();
    if (
      shard.schemaVersion !== 5
      || shard.kind !== 'recipeShard'
      || shard.logicalId !== descriptor.id
      || shard.logicalId !== descriptor.logicalId
      || shard.recipeTypeId !== descriptor.recipeTypeId
      || shard.prefix !== descriptor.prefix
    ) throw new Error(`${descriptor.id}: shared recipe shard identity mismatch`);
    return this.validateRecipeRecords(descriptor, shard.recipes);
  }

  private loadShard(id: string): Promise<PackedRecipe[]> {
    let pending = this.shards.get(id);
    if (pending) return pending;
    const descriptor = this.manifest.recipeShards.find((shard) => shard.id === id);
    if (!descriptor) throw new Error(`Unknown recipe shard ${id}`);
    const reusable = this.reusableRecipeShards.get(descriptor.sha256);
    pending = reusable
      ? (async () => {
        try {
          const recipes = this.validateRecipeRecords(descriptor, await reusable);
          await this.recordAsset(descriptor);
          return recipes;
        } catch {
          return this.loadRecipeShard(descriptor);
        }
      })()
      : this.loadRecipeShard(descriptor);
    this.shards.set(id, pending);
    void pending.catch(() => this.shards.delete(id));
    return pending;
  }

  private validateSpecialRecords(
    descriptor: SpecialShardDescriptor,
    records: PackedSpecialRecord[]
  ): PackedSpecialRecord[] {
    if (!sharedPrefixIsPublished(this.manifest, 'specialViews', descriptor.specialViewTypeId, descriptor.prefix)) {
      throw new Error(`${descriptor.id}: special-data prefix is not in the published layout`);
    }
    if (!Array.isArray(records) || records.length !== descriptor.recordCount) {
      throw new Error(`${descriptor.id}: special-data record count mismatch`);
    }
    const serviceIconIds = new Set(this.specialServiceIcons.map((icon) => icon.id));
    let previousId: string | undefined;
    for (const record of records) {
      if (
        !record
        || typeof record.id !== 'string'
        || typeof record.category !== 'string'
        || typeof record.title !== 'string'
        || typeof record.searchText !== 'string'
        || !isStringArray(record.goodsIds)
        || (record.productionGoodsIds !== undefined && !isStringArray(record.productionGoodsIds))
        || (record.usageGoodsIds !== undefined && !isStringArray(record.usageGoodsIds))
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
        throw new Error(`${descriptor.id}: special records are not sorted`);
      }
      previousId = record.id;
      if (!serviceIconIds.has(record.serviceIconId)) {
        throw new Error(`${descriptor.id}: record ${record.id} references unknown service icon ${record.serviceIconId}`);
      }
      if (record.recipesLookupId.length === 0 || record.usagesLookupId.length === 0) {
        throw new Error(`${descriptor.id}: record ${record.id} has an empty lookup ID`);
      }
      for (const goodsId of specialRecordGoodsIds(record)) {
        if (!this.packedGoods.has(goodsId) && !this.ingredientGroups.has(goodsId)) {
          throw new Error(`${descriptor.id}: record ${record.id} references unknown goods ${goodsId}`);
        }
      }
    }
    return records;
  }

  private async loadSpecialShard(descriptor: SpecialShardDescriptor): Promise<PackedSpecialRecord[]> {
    const bytes = await fetchVerified(descriptor, this.manifestUrl, undefined, undefined, this.manifest);
    await this.recordAsset(descriptor);
    const shard = await decodeAssetPayload(descriptor, bytes) as PackedSpecialShard;
    await yieldToBrowser();
    if (
      shard.schemaVersion !== 5
      || shard.kind !== 'special'
      || shard.logicalId !== descriptor.id
      || shard.logicalId !== descriptor.logicalId
      || shard.specialViewTypeId !== descriptor.specialViewTypeId
      || shard.prefix !== descriptor.prefix
    ) {
      throw new Error(`${descriptor.id}: special-data identity mismatch`);
    }
    return this.validateSpecialRecords(descriptor, shard.records);
  }

  private loadSpecialShardById(id: string): Promise<PackedSpecialRecord[]> {
    let pending = this.specialShards.get(id);
    if (pending) return pending;
    const descriptor = this.manifest.specialDataShards.find((shard) => shard.id === id);
    if (!descriptor) throw new Error(`Unknown special-data shard ${id}`);
    const reusable = this.reusableSpecialShards.get(descriptor.sha256);
    pending = reusable
      ? (async () => {
        try {
          const records = this.validateSpecialRecords(descriptor, await reusable);
          await this.recordAsset(descriptor);
          return records;
        } catch {
          return this.loadSpecialShard(descriptor);
        }
      })()
      : this.loadSpecialShard(descriptor);
    this.specialShards.set(id, pending);
    void pending.catch(() => this.specialShards.delete(id));
    return pending;
  }

  private specialRecordIds(entryId: string, view: RecipeView): Set<string> | null {
    if (view === 'machineUsages') return null;
    const selectedGroup = this.ingredientGroups.get(entryId);
    const fluidScope = fluidRecipeScope(entryId, this.packedGoods);
    if (selectedGroup) return new Set([entryId, ...selectedGroup.itemIds]);
    if (fluidScope) return new Set(fluidScope.memberIds);
    if (!this.packedGoods.has(entryId)) return null;
    const productionFallback = this.productionFallbacks.get(entryId);
    const result = view === 'recipes' && productionFallback
      ? new Set(productionFallback.itemIds)
      : new Set([entryId]);
    // GT's special ore handlers resolve a selected product/host stack through
    // every named ore dictionary containing that stack.  The pack builder
    // projects current records onto group members, but expanding the scope
    // here also keeps older/externally-built packs correct when only the
    // dictionary entry carries the special metadata.
    for (const itemId of [...result]) {
      const item = this.packedGoods.get(itemId);
      for (const group of this.ingredientGroups.values()) {
        if (
          group.id.startsWith('o:')
          && group.itemIds.includes(itemId)
          && isGtOreSpecialGroup(group.id, item)
        ) result.add(group.id);
      }
    }
    // CropsNH's NEI handlers resolve every literal genericSeed stack through
    // the crop identity, while the sidecar retains the canonical analyzed
    // stack. Expand the lookup set at read time so a visible variant cannot
    // advertise a special tab whose shard then filters to zero records.
    const crop = cropsNhSeedKey(this.packedGoods.get(entryId));
    if (crop) {
      for (const goods of this.packedGoods.values()) {
        if (cropsNhSeedKey(goods) === crop) result.add(goods.id);
      }
    }
    return result;
  }

  private specialShardIds(entryIds: ReadonlySet<string>, view: RecipeView): string[] {
    const field = view === 'recipes' ? 'specialProductionShards' : 'specialUsageShards';
    const result = new Set<string>();
    for (const entryId of entryIds) {
      const metadata = this.packedGoods.get(entryId) ?? this.ingredientGroups.get(entryId);
      for (const shardId of metadata?.[field] ?? []) result.add(shardId);
    }
    return [...result].sort((left, right) => {
      const a = this.manifest.specialDataShards.find((shard) => shard.id === left);
      const b = this.manifest.specialDataShards.find((shard) => shard.id === right);
      return (a?.specialViewTypeOrder ?? 0) - (b?.specialViewTypeOrder ?? 0)
        || (a?.part ?? 0) - (b?.part ?? 0)
        || left.localeCompare(right);
    });
  }

  private specialShardIdsForViewType(viewType: string): string[] {
    return this.manifest.specialDataShards
      .filter((descriptor) => descriptor.specialViewTypeId === viewType)
      .sort((left, right) =>
        left.specialViewTypeOrder - right.specialViewTypeOrder
        || left.part - right.part
        || left.id.localeCompare(right.id)
      )
      .map((descriptor) => descriptor.id);
  }

  private materializeSpecialRecord(
    record: PackedSpecialRecord,
    view: RecipeView,
    order: number
  ): SpecialRecord {
    return {
      ...record,
      category: record.category,
      title: record.title,
      searchText: record.searchText,
      lookupId: view === 'recipes' ? record.recipesLookupId : record.usagesLookupId,
      recipesLookupId: record.recipesLookupId,
      usagesLookupId: record.usagesLookupId,
      goodsIds: record.goodsIds,
      productionGoodsIds: record.productionGoodsIds ?? record.goodsIds,
      usageGoodsIds: record.usageGoodsIds ?? record.goodsIds,
      serviceIconId: record.serviceIconId,
      payload: record.payload as SpecialRecord['payload'],
      order
    };
  }

  private async specialFromShards(
    shardIds: readonly string[],
    view: RecipeView,
    viewType: string,
    matches: (record: PackedSpecialRecord) => boolean,
    onProgress?: (progress: {
      loadedShards: number;
      totalShards: number;
      batch: SpecialRecord[];
    }) => void,
    signal?: AbortSignal
  ): Promise<SpecialRecord[]> {
    onProgress?.({ loadedShards: 0, totalShards: shardIds.length, batch: [] });
    const batches = await mapProgressively(
      shardIds,
      2,
      async (shardId, shardIndex) => {
        const records = await this.loadSpecialShardById(shardId);
        const batch = records
          .filter((record) => record.category === viewType)
          .filter(matches)
          .map((record, recordIndex) => this.materializeSpecialRecord(
            record,
            view,
            shardIndex * 1_000_000 + recordIndex
          ));
        await yieldToBrowser();
        return batch;
      },
      ({ completed, total, value }) => {
        onProgress?.({ loadedShards: completed, totalShards: total, batch: value });
      },
      signal
    );
    const unique = new Map<string, SpecialRecord>();
    for (const record of batches.flat()) unique.set(record.id, record);
    return [...unique.values()].sort((left, right) =>
      (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)
    );
  }

  async specialFor(
    entryId: string,
    view: RecipeView,
    viewType: string,
    onProgress?: (progress: {
      loadedShards: number;
      totalShards: number;
      batch: SpecialRecord[];
    }) => void,
    signal?: AbortSignal
  ): Promise<SpecialRecord[]> {
    const entryIds = this.specialRecordIds(entryId, view);
    if (!entryIds) {
      onProgress?.({ loadedShards: 0, totalShards: 0, batch: [] });
      return [];
    }
    const shardIds = this.specialShardIds(entryIds, view).filter((id) => {
      const descriptor = this.manifest.specialDataShards.find((shard) => shard.id === id);
      return descriptor?.specialViewTypeId === viewType;
    });
    return this.specialFromShards(
      shardIds,
      view,
      viewType,
      (record) => {
        const goodsIds = specialRecordGoodsForDirection(record, view);
        return goodsIds.some((goodsId) => entryIds.has(goodsId));
      },
      onProgress,
      signal
    );
  }

  async specialForAll(
    view: RecipeView,
    viewType: string,
    onProgress?: (progress: {
      loadedShards: number;
      totalShards: number;
      batch: SpecialRecord[];
    }) => void,
    signal?: AbortSignal
  ): Promise<SpecialRecord[]> {
    return this.specialFromShards(
      this.specialShardIdsForViewType(viewType),
      view,
      viewType,
      () => true,
      onProgress,
      signal
    );
  }

  specialRecordsFor(
    entryId: string,
    view: RecipeView,
    viewType: string,
    onProgress?: (progress: {
      loadedShards: number;
      totalShards: number;
      batch: SpecialRecord[];
    }) => void,
    signal?: AbortSignal
  ): Promise<SpecialRecord[]> {
    return this.specialFor(entryId, view, viewType, onProgress, signal);
  }

  specialRecordsForAll(
    view: RecipeView,
    viewType: string,
    onProgress?: (progress: {
      loadedShards: number;
      totalShards: number;
      batch: SpecialRecord[];
    }) => void,
    signal?: AbortSignal
  ): Promise<SpecialRecord[]> {
    return this.specialForAll(view, viewType, onProgress, signal);
  }

  async recipesFor(
    entryId: string,
    view: RecipeView,
    onProgress?: (progress: RecipeLoadProgress) => void,
    signal?: AbortSignal
  ): Promise<Recipe[]> {
    const goods = this.packedGoods.get(entryId);
    const selectedGroup = this.ingredientGroups.get(entryId);
    if (!goods && !selectedGroup) return [];
    const catalogEntry = this.entries.find((entry) => entry.id === entryId);
    const productionFallback = this.productionFallbacks.get(entryId);
    const fluidScope = fluidRecipeScope(entryId, this.packedGoods);
    const machineCapabilities = catalogEntry?.machineCapabilities ?? [];
    const shardIds = view === 'machineUsages'
      ? [...new Set(machineCapabilities.flatMap((capability) => capability.recipeShards))]
      : selectedGroup
      ? view === 'recipes'
        ? catalogEntry?.productionShards ?? []
        : catalogEntry?.usageShards ?? []
      : view === 'recipes'
        ? catalogEntry?.productionShards ?? []
        : goods!.usageShards;
    const selectedMembers = selectedGroup
      ? new Set(selectedGroup.itemIds)
      : view === 'recipes' && productionFallback
        ? new Set(productionFallback.itemIds)
        : null;
    const matches = (recipe: PackedRecipe) => {
      if (view === 'machineUsages') {
        const capability = machineCapabilities.find(
          (candidate) => candidate.recipeTypeId === recipe.recipeTypeId
        );
        return capability !== undefined
          && machineCanProcessVoltage(capability, recipe.gt?.voltageTier);
      }
      return (view === 'recipes' ? recipe.outputs : recipe.inputs).some((io) => {
        if (fluidScope) return fluidScope.memberIds.has(io.goodsId);
        return ingredientMatchesEntry(io, entryId, selectedMembers, this.ingredientGroups);
      });
    };
    onProgress?.({ loadedShards: 0, totalShards: shardIds.length, batch: [] });
    const batches = await mapProgressively(
      shardIds,
      2,
      async (shardId, shardIndex) => {
        const recipes = await this.loadShard(shardId);
        const batch = recipes
          .filter(matches)
          .map((recipe, recipeIndex) => materializeRecipe(
            recipe,
            shardIndex * 1_000_000 + recipeIndex,
            this.types,
            this.ingredientGroups
          ));
        await yieldToBrowser();
        return batch;
      },
      ({ completed, total, value }) => {
        onProgress?.({ loadedShards: completed, totalShards: total, batch: value });
      },
      signal
    );
    return batches.flat().sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  }
}
