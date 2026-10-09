import { decode } from '@msgpack/msgpack';
import { materializeCatalog } from './catalogMaterialization';
import { cachePreparedCatalog, cachePreparedSearch, getPreparedCatalog, getPreparedSearch, preparedCatalogKey, type PreparedCatalog } from './preparedCatalogCache';
import { buildCatalogBrowseEntries } from './catalogVariants';
import {
  decompress,
  decodePhysicalRecordPage,
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
  PackedCatalogGoodsSearch,
  PackedCatalogRecipeRemaps,
  PackedCatalogRecipeTypes,
  PackedCatalogSpecialMetadata,
  PackedGoods,
  PackedGoodsDetail,
  PackedGoodsDetailsShard,
  PackedIngredientGroup,
  PackedIngredientGroupsShard,
  PackedOreDictionary,
  PackedRecipe,
  PackedRecipeType,
  PackedShard,
  PackedSpecialRecord,
  PackedSpecialShard,
  VersionsIndex
} from './datasetSchema';
import { ingredientMatchesEntry } from './oreDictionary';
import { assetDigest } from './integrity';
import { goodsIdentityFromId } from './goodsIdentity';
import { expandRelations } from './packedRelations';
import { recordPageSelections } from './recordPages';
import { restoreMinecraftFormatting } from './minecraftText';
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
  cacheMetadata,
  cacheRuntimeData,
  getRuntimeCache,
  getCachedMetadata,
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
  startupDatasetSelection,
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

type SharedPrefixFamily = 'goods' | 'oreDictionaries' | 'recipeTypes' | 'specialViews';

function sharedPrefixIsPublished(
  manifest: DatasetManifest,
  family: SharedPrefixFamily,
  namespace: string,
  prefix: unknown
): boolean {
  if (typeof prefix !== 'string') return false;
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
      for (const [pageIndex] of recordPageSelections(asset)) {
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

function abortError(): DOMException {
  return new DOMException('Operation was cancelled', 'AbortError');
}

async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw abortError();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); }
    );
  });
}

function descriptorForStableId<T extends { prefix: string }>(
  descriptors: readonly T[],
  namespace: string,
  id: string
): T | undefined {
  const hash = assetDigest(new TextEncoder().encode(`${namespace}\0${id}`));
  return [...descriptors]
    .filter((descriptor) => hash.startsWith(descriptor.prefix))
    .sort((left, right) => right.prefix.length - left.prefix.length)[0];
}

function physicalDescriptorsFor(
  asset: DatasetAsset,
  recordPages: readonly DatasetAsset[]
): DatasetAsset[] {
  if (!asset.segments) return [asset];
  const pages = new Map(recordPages.map((page, index) => [index, page]));
  const result: DatasetAsset[] = [];
  const seen = new Set<string>();
  for (const [pageIndex] of recordPageSelections(asset)) {
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

async function loadVersionsIndex(cachedWaitMs?: number): Promise<{ value: VersionsIndex; url: string }> {
  const v7Url = new URL('./versions-v7.json', document.baseURI).href;
  return fetchJsonNetworkFirst<VersionsIndex>(v7Url, `versions:${v7Url}`, cachedWaitMs);
}

type DecodedBootstrapAsset = PackedCatalogCore
  | PackedCatalogGoods
  | PackedCatalogGoodsSearch
  | PackedCatalogRecipeTypes
  | PackedCatalogRecipeRemaps
  | PackedCatalogSpecialMetadata;

type RecipeShardDescriptor = DatasetManifest['recipeShards'][number];
type SpecialShardDescriptor = DatasetManifest['specialDataShards'][number];

async function loadFormat7Bootstrap(
  manifest: DatasetManifest,
  manifestUrl: string,
  report: (percent: number, stage: string) => void
): Promise<{ catalog: PackedCatalog }> {
  if (manifest.catalogAssets.length === 0) throw new Error('Pack manifest has no bootstrap assets');
  const assetsToDecode = manifest.catalogAssets;
  const pages = [...new Map(assetsToDecode.flatMap((asset) => physicalDescriptorsFor(asset, manifest.recordPages))
    .map((page) => [page.sha256, page] as const)).values()];
  const loaded = new Array(pages.length).fill(0) as number[];
  const totalBytes = pages.reduce((total, page) => total + page.bytes, 0);
  await mapProgressively(pages, 3, async (page, index) => decodePhysicalRecordPage(
    page,
    manifestUrl,
    ({ loaded: count, cached }) => {
      loaded[index] = Math.max(loaded[index]!, Math.min(page.bytes, count));
      const ratio = loaded.reduce((total, value) => total + value, 0) / Math.max(1, totalBytes);
      report(12 + Math.round(ratio * 58), cached ? 'Reading bootstrap data' : 'Downloading bootstrap data');
    }
  ), ({ completed, total }) => report(
    12 + Math.round(completed / Math.max(1, total) * 58),
    `Loading bootstrap page ${completed.toLocaleString()} of ${total.toLocaleString()}`
  ));
  const decoded = await mapProgressively(manifest.catalogAssets, 3, async (asset) => {
    const value = (await decodeAssetPayload(
      asset,
      await fetchVerified(asset, manifestUrl, undefined, undefined, manifest)
    )) as DecodedBootstrapAsset;
    if (value.schemaVersion !== 6 || value.kind !== asset.role || value.logicalId !== asset.logicalId) {
      throw new Error(`${asset.id}: bootstrap logical identity mismatch`);
    }
    if ((asset.role === 'goods' || asset.role === 'goodsSearch')
      && (('prefix' in value ? value.prefix : undefined) !== asset.prefix
        || !sharedPrefixIsPublished(manifest, 'goods', 'goods', asset.prefix))) {
      throw new Error(`${asset.id}: bootstrap partition identity mismatch`);
    }
    return value;
  }, ({ completed, total }) => report(
    71 + Math.round(completed / Math.max(1, total) * 20),
    'Preparing browse and search data'
  ));
  const exactlyOne = (kind: DecodedBootstrapAsset['kind']): DecodedBootstrapAsset => {
    const values = decoded.filter((value) => value.kind === kind);
    if (values.length !== 1) throw new Error(`Bootstrap requires exactly one ${kind} asset`);
    return values[0]!;
  };
  const core = exactlyOne('core') as PackedCatalogCore;
  const recipeTypes = exactlyOne('recipeTypes') as PackedCatalogRecipeTypes;
  const recipeRemaps = exactlyOne('recipeRemaps') as PackedCatalogRecipeRemaps;
  const specialMetadata = exactlyOne('specialMetadata') as PackedCatalogSpecialMetadata;
  const goodsAssets = decoded.filter((value): value is PackedCatalogGoods => value.kind === 'goods');
  if (goodsAssets.length === 0) throw new Error('Bootstrap requires at least one goods asset');
  const searchAssets = decoded.filter((value): value is PackedCatalogGoodsSearch => value.kind === 'goodsSearch');
  const tooltips = new Map(searchAssets.flatMap((asset) => asset.tooltips.map((value) => [value.id, value.text] as const)));
  for (const value of goodsAssets.flatMap((asset) => asset.goods)) {
    if (value.tooltipId && !tooltips.has(value.tooltipId)) throw new Error(`${value.id}: missing search tooltip`);
  }
  const goods = goodsAssets.flatMap((asset) => asset.goods.map((value): PackedGoods => {
    const identity = goodsIdentityFromId(value.id);
    return {
      ...identity, ...value,
      tooltip: tooltips.get(value.tooltipId ?? '') ?? null,
      numericId: value.numericId,
      damage: value.damage ?? identity.damage ?? 0,
      unlocalizedName: value.unlocalizedName ?? '',
      searchMask: value.searchMask ?? [],
      productionShards: [], usageShards: [], productionCount: 0, usageCount: 0
    };
  }));
  return {
    catalog: {
      datasetId: manifest.datasetId,
      goods,
      recipeTypes: recipeTypes.recipeTypes,
      oreDictionaries: [],
      ingredientGroups: core.ingredientGroups ?? [],
      serviceItemIds: core.serviceItemIds,
      obsoleteRecipeRemaps: recipeRemaps.obsoleteRecipeRemaps,
      specialViewTypes: specialMetadata.specialViewTypes,
      specialServiceIcons: specialMetadata.specialServiceIcons
    }
  };
}

export class DatasetRepository {
  readonly entries: CatalogEntry[];
  readonly browseEntries: CatalogBrowseEntry[];
  private searchDocumentsPromise?: Promise<CatalogSearchDocument[]>;
  private readonly runtimeCacheKey: string;
  private preparedCatalog?: PreparedCatalog;

  /** Search text is loaded and normalized only once a search is requested. */
  loadSearchDocuments(): Promise<CatalogSearchDocument[]> {
    return this.searchDocumentsPromise ??= (async () => {
      const cached = await getPreparedSearch(this.datasetId, this.runtimeCacheKey, this.browseEntries.length);
      if (cached) {
        return cached;
      }
      await yieldToBrowser();
      const documents: CatalogSearchDocument[] = [];
      for (let start = 0; start < this.browseEntries.length; start += 500) {
        documents.push(...buildCatalogSearchDocuments(this.browseEntries.slice(start, start + 500), this.entries, this.entriesById));
        await yieldToBrowser();
      }
      void cachePreparedSearch(this.datasetId, this.runtimeCacheKey, documents)
        .catch((error: unknown) => console.warn('Unable to cache prepared search', error));
      return documents;
    })();
  }
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
  private readonly goodsIds: Set<string>;
  private readonly types: Map<string, PackedRecipeType>;
  private readonly ingredientGroups: Map<string, PackedOreDictionary | PackedIngredientGroup>;
  private readonly entriesById: Map<string, CatalogEntry>;
  private readonly goodsDetails = new Map<string, PackedGoodsDetail>();
  private readonly hydratedGroups = new Set<string>();
  private readonly detailShards = new Map<string, Promise<PackedGoodsDetail[]>>();
  private readonly groupShards = new Map<string, Promise<Array<PackedOreDictionary | PackedIngredientGroup>>>();
  private readonly reusableDetailShards = new Map<string, Promise<PackedGoodsDetail[]>>();
  private readonly reusableGroupShards = new Map<string, Promise<Array<PackedOreDictionary | PackedIngredientGroup>>>();
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
    runtimeCacheKey: string,
    catalog: PackedCatalog | null,
    reuseFrom?: DatasetRepository,
    prepared?: PreparedCatalog
  ) {
    this.manifest = manifest;
    this.manifestUrl = manifestUrl;
    this.datasetId = manifest.datasetId;
    this.gtnhVersion = manifest.gtnhVersion;
    this.revision = manifest.revision;
    this.runtimeCacheKey = runtimeCacheKey;
    const resolved = prepared?.resolved ?? materializeCatalog(manifest, manifestUrl, catalog!, false);
    this.entries = resolved.entries;
    this.goodsIds = new Set(this.entries.filter((entry) => entry.kind === 'item' || entry.kind === 'fluid').map((entry) => entry.id));
    this.types = resolved.recipeTypes;
    this.ingredientGroups = resolved.ingredientGroups;
    this.entriesById = new Map(this.entries.map((entry) => [entry.id, entry]));
    if (!prepared && manifest.formatVersion === 7) {
      for (const entry of this.entries) {
        entry.productionShards = undefined;
        entry.usageShards = undefined;
        entry.productionCount = undefined;
        entry.usageCount = undefined;
        entry.specialProductionShards = undefined;
        entry.specialUsageShards = undefined;
        entry.specialProductionLookupIds = undefined;
        entry.specialUsageLookupIds = undefined;
        entry.specialProductionCount = undefined;
        entry.specialUsageCount = undefined;
        entry.productionOreDictionaryId = undefined;
        entry.oreDictionaryIds = undefined;
        entry.machineCapabilities = undefined;
        entry.members = undefined;
      }
    }
    this.browseEntries = prepared
      ? prepared.browseRows.map((row) => ({ ...this.entriesById.get(row.variantIds[0]!)!, ...row }))
      : buildCatalogBrowseEntries(this.entries);
    if (!prepared) {
      this.preparedCatalog = {
        resolved: {
          entries: this.entries,
          recipeTypes: this.types,
          ingredientGroups: this.ingredientGroups
        },
        browseRows: this.browseEntries.map(({ id, variantIds, variantCount, variantKind, variantLabels }) =>
          ({ id, variantIds, variantCount, variantKind, variantLabels })),
        specialViewTypes: catalog!.specialViewTypes,
        specialServiceIcons: catalog!.specialServiceIcons
      };
    }
    for (const descriptor of manifest.goodsDetailShards ?? []) {
      const source = reuseFrom?.manifest.goodsDetailShards?.find((candidate) =>
        candidate.sha256 === descriptor.sha256 && candidate.logicalId === descriptor.logicalId
      );
      const pending = source && reuseFrom?.detailShards.get(source.id);
      if (pending) this.reusableDetailShards.set(descriptor.sha256, pending);
    }
    for (const descriptor of manifest.ingredientGroupShards ?? []) {
      const source = reuseFrom?.manifest.ingredientGroupShards?.find((candidate) =>
        candidate.sha256 === descriptor.sha256 && candidate.logicalId === descriptor.logicalId
      );
      const pending = source && reuseFrom?.groupShards.get(source.id);
      if (pending) this.reusableGroupShards.set(descriptor.sha256, pending);
    }
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
    this.specialViewTypes = (prepared?.specialViewTypes ?? catalog?.specialViewTypes ?? []).map((viewType, order) => ({
      ...viewType,
      order
    }));
    const entriesById = this.entriesById;
    this.specialServiceIcons = (prepared?.specialServiceIcons ?? catalog?.specialServiceIcons ?? []).map((icon) => ({
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
    return (await loadVersionsIndex(150)).value.versions;
  }

  static async load(
    datasetId?: string,
    onProgress?: (progress: DatasetLoadProgress) => void,
    /** The active repository, whose already-decoded immutable data may be borrowed. */
    reuseFrom?: DatasetRepository,
    startup = false
  ): Promise<DatasetRepository> {
    try {
      return await DatasetRepository.loadSelected(datasetId, onProgress, reuseFrom, startup);
    } catch (error) {
      if (!startup) throw error;
      const installed = await listDatasets();
      const active = installed.find((state) => state.active && !isLegacyDatasetState(state));
      const indexUrl = new URL('./versions-v7.json', document.baseURI).href;
      const index = await getCachedMetadata<VersionsIndex>(`versions:${indexUrl}`);
      const epoch = await getCachedMetadata<number>('dataset-rollout-epoch');
      const selection = index && startupDatasetSelection(index.value, installed, datasetId, epoch?.value);
      if (!active || !selection?.rolloutEpoch || selection.datasetId === active.datasetId
        || selection.datasetId !== index?.value.rollout?.targetDatasetId) throw error;
      // Keep the usable v7 cache when a rollout bootstrap is unavailable. Retry the epoch next startup.
      return DatasetRepository.loadSelected(active.datasetId, onProgress, reuseFrom);
    }
  }

  private static async loadSelected(
    datasetId?: string,
    onProgress?: (progress: DatasetLoadProgress) => void,
    reuseFrom?: DatasetRepository,
    startup = false
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
    report(3, 'Checking available GTNH versions');
    const versionsResult = await loadVersionsIndex(150);
    const versions = versionsResult.value;
    const installed = await listDatasets();
    const applied = startup ? await getCachedMetadata<number>('dataset-rollout-epoch') : null;
    const selection = startup
      ? startupDatasetSelection(versions, installed, datasetId, applied?.value)
      : { datasetId: preferredDatasetId(versions.versions, installed, datasetId), rolloutEpoch: undefined };
    const selectedId = selection.datasetId;
    const published = versions.versions.find((version) => version.datasetId === selectedId);
    const installedSelection = installed.find((dataset) => dataset.datasetId === selectedId
      && !isLegacyDatasetState(dataset) && !dataset.datasetId.includes('-v6-'));
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
      `manifest:${manifestUrl}`,
      0
    );
    const manifest = manifestResult.value;
    if (manifest.formatVersion !== 7) {
      throw new Error(`Unsupported pack manifest format ${String(manifest.formatVersion)}; only format 7 is supported`);
    }
    if (!Array.isArray(manifest.recordPages) || manifest.recordPages.length === 0) {
      throw new Error(`Format-${manifest.formatVersion} manifest has no record pages`);
    }
    if (manifest.formatVersion === 7 && (
      !Array.isArray(manifest.goodsDetailShards)
      || !Array.isArray(manifest.ingredientGroupShards)
      || manifest.goodsDetailShards.length === 0
    )) throw new Error('Format-7 manifest is missing lazy detail families');
    if (manifest.catalogAssets.some((asset) => !isLogicalRecordAsset(asset))
      || (manifest.goodsDetailShards ?? []).some((asset) => !isLogicalRecordAsset(asset))
      || (manifest.ingredientGroupShards ?? []).some((asset) => !isLogicalRecordAsset(asset))
      || manifest.recipeShards.some((asset) => !isLogicalRecordAsset(asset))
      || manifest.specialDataShards.some((asset) => !isLogicalRecordAsset(asset))) {
      throw new Error(`Format-${manifest.formatVersion} logical assets must use record-page segments`);
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
      throw new Error(`Format-${manifest.formatVersion} manifest has invalid physical record pages`);
    }
    for (const asset of [
      ...manifest.catalogAssets,
      ...(manifest.goodsDetailShards ?? []),
      ...(manifest.ingredientGroupShards ?? []),
      ...manifest.recipeShards,
      ...manifest.specialDataShards
    ]) {
      if (asset.encoding !== 'identity' || asset.url !== ''
        || !recordPageSelections(asset).every(([pageIndex, first, count]) => Number.isSafeInteger(pageIndex)
          && pageIndex >= 0
          && pageIndex < manifest.recordPages.length
          && Number.isSafeInteger(first)
          && Number.isSafeInteger(count)
          && first >= 0
          && count >= 1)) {
        throw new Error(`${asset.id}: invalid record-page logical descriptor`);
      }
    }
    if (manifest.formatVersion === 7) {
      const expectedFamilies = new Map<DatasetAsset, DatasetAsset['family']>([
        ...manifest.catalogAssets.map((asset) => [asset, 'bootstrap'] as const),
        ...manifest.goodsDetailShards!.map((asset) => [asset, 'goods-details'] as const),
        ...manifest.ingredientGroupShards!.map((asset) => [asset, 'ingredient-groups'] as const),
        ...manifest.recipeShards.map((asset) => [asset, 'recipes'] as const),
        ...manifest.specialDataShards.map((asset) => [asset, 'special'] as const)
      ]);
      for (const [asset, family] of expectedFamilies) {
        if (asset.family !== family) throw new Error(`${asset.id}: invalid load family`);
        for (const [pageIndex] of recordPageSelections(asset)) {
          if (manifest.recordPages[pageIndex]?.family !== family) {
            throw new Error(`${asset.id}: record page crosses load-family boundary`);
          }
        }
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
    const legacyStates = installed.filter((state) => isLegacyDatasetState(state)
      && state.gtnhVersion === manifest.gtnhVersion);
    const sameVersionStates = installed.filter((state) =>
      state.gtnhVersion === manifest.gtnhVersion && state.datasetId !== manifest.datasetId
    );
    const obsoleteStates = [...new Map(
      [...sameVersionStates, ...legacyStates]
        .map((state) => [state.datasetId, state] as const)
    ).values()];
    report(12, 'Restoring cached items');
    const cacheKey = preparedCatalogKey(manifest, manifestResult.url);
    const prepared = await getPreparedCatalog(manifest.datasetId, cacheKey);
    const loadedCatalog = prepared ? null : await loadFormat7Bootstrap(
      manifest, manifestResult.url, report
    );
    report(93, 'Preparing items');
    let repository: DatasetRepository;
    try {
      repository = new DatasetRepository(
        manifest, manifestResult.url, cacheKey, loadedCatalog?.catalog ?? null,
        reuseFrom, prepared ?? undefined
      );
    } catch (error) {
      if (!prepared) throw error;
      // Prepared data is disposable. Recover from corrupt projections without deleting source bytes.
      const rebuilt = await loadFormat7Bootstrap(manifest, manifestResult.url, report);
      repository = new DatasetRepository(manifest, manifestResult.url, cacheKey, rebuilt.catalog, reuseFrom);
    }
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
    if (repository.preparedCatalog) {
      void cachePreparedCatalog(repository.datasetId, repository.runtimeCacheKey, repository.preparedCatalog)
        .catch((error: unknown) => console.warn('Unable to cache prepared items', error));
      repository.preparedCatalog = undefined;
    }
    if (obsoleteStates.length > 0) {
      report(97, 'Migrating cached dataset bookkeeping');
      await migrateObsoleteDatasetStates(manifest.datasetId, obsoleteStates);
    }
    repository.pendingRolloutEpoch = selection.rolloutEpoch;
    report(100, 'Catalog ready');
    return repository;
  }

  static loadLatest(onProgress?: (progress: DatasetLoadProgress) => void): Promise<DatasetRepository> {
    return DatasetRepository.load(undefined, onProgress);
  }

  private pendingRolloutEpoch?: number;

  async activate(): Promise<void> {
    await activateDataset(this.datasetId);
    if (this.pendingRolloutEpoch !== undefined) {
      await cacheMetadata('dataset-rollout-epoch', this.manifestUrl, this.pendingRolloutEpoch);
      this.pendingRolloutEpoch = undefined;
    }
  }

  private async readDecodedShard<T>(descriptor: DatasetAsset, validate: (value: unknown) => T): Promise<T> {
    const key = `decoded-v1:${descriptor.sha256}`;
    const cached = await getRuntimeCache<unknown>(this.datasetId, key);
    if (cached !== null) {
      try { return validate(cached); } catch { /* Rebuild a corrupt projection from verified bytes. */ }
    }
    const bytes = await fetchVerified(descriptor, this.manifestUrl, undefined, undefined, this.manifest);
    await this.recordAsset(descriptor);
    const raw = await decodeAssetPayload(descriptor, bytes);
    await yieldToBrowser();
    const value = validate(raw);
    void cacheRuntimeData(this.datasetId, key, raw);
    return value;
  }

  private async loadGoodsDetailShard(
    descriptor: NonNullable<DatasetManifest['goodsDetailShards']>[number]
  ): Promise<PackedGoodsDetail[]> {
    return this.readDecodedShard(descriptor, (raw) => {
      const value = raw as PackedGoodsDetailsShard;
      if (value.schemaVersion !== 6 || value.kind !== 'goodsDetails'
        || value.logicalId !== descriptor.logicalId || value.prefix !== descriptor.prefix
        || !Array.isArray(value.goods) || value.goods.length !== descriptor.recordCount) {
        throw new Error(`${descriptor.id}: goods-detail identity mismatch`);
      }
      for (const detail of value.goods) {
        if (!this.goodsIds.has(detail.id)
          || descriptorForStableId(this.manifest.goodsDetailShards, 'goods', detail.id)?.id !== descriptor.id) {
          throw new Error(`${descriptor.id}: invalid goods-detail membership ${detail.id}`);
        }
      }
      const numericIds = new Map((value.goodsMetadata ?? []).map((record) => [record.id, record.numericId]));
      const tooltips = new Map((value.goodsTooltips ?? []).map((record) => [record.id, record.formats]));
      return expandRelations(value.goods, value.lists).map((record) => ({ ...record,
        numericId: numericIds.get(record.id) ?? record.numericId,
        tooltipFormats: tooltips.get(record.id) ?? [],
        productionCount: record.productionCount ?? 0, usageCount: record.usageCount ?? 0,
        specialProductionCount: record.specialProductionCount ?? 0, specialUsageCount: record.specialUsageCount ?? 0 }));
    });
  }

  private async loadIngredientGroupShard(
    descriptor: NonNullable<DatasetManifest['ingredientGroupShards']>[number]
  ): Promise<Array<PackedOreDictionary | PackedIngredientGroup>> {
    return this.readDecodedShard(descriptor, (raw) => {
      const value = raw as PackedIngredientGroupsShard;
      if (value.schemaVersion !== 6 || value.kind !== 'ingredientGroups'
        || value.logicalId !== descriptor.logicalId || value.prefix !== descriptor.prefix
        || !Array.isArray(value.ingredientGroups)
        || value.ingredientGroups.length !== descriptor.recordCount) {
        throw new Error(`${descriptor.id}: ingredient-group identity mismatch`);
      }
      const groups = expandRelations(value.ingredientGroups, value.lists);
      for (const group of groups) {
        if (!this.entriesById.has(group.id) || !isStringArray(group.itemIds)
          || group.itemIds.some((id) => !this.goodsIds.has(id))
          || descriptorForStableId(this.manifest.ingredientGroupShards, 'oreDictionaries', group.id)?.id !== descriptor.id) {
          throw new Error(`${descriptor.id}: invalid ingredient-group membership ${group.id}`);
        }
      }
      return groups;
    });
  }

  private detailShard(descriptor: NonNullable<DatasetManifest['goodsDetailShards']>[number]): Promise<PackedGoodsDetail[]> {
    let pending = this.detailShards.get(descriptor.id);
    if (pending) return pending;
    const reusable = this.reusableDetailShards.get(descriptor.sha256);
    pending = reusable ? reusable.catch(() => this.loadGoodsDetailShard(descriptor)) : this.loadGoodsDetailShard(descriptor);
    this.detailShards.set(descriptor.id, pending);
    void pending.catch(() => this.detailShards.delete(descriptor.id));
    return pending;
  }

  private groupShard(descriptor: NonNullable<DatasetManifest['ingredientGroupShards']>[number]): Promise<Array<PackedOreDictionary | PackedIngredientGroup>> {
    let pending = this.groupShards.get(descriptor.id);
    if (pending) return pending;
    const reusable = this.reusableGroupShards.get(descriptor.sha256);
    pending = reusable ? reusable.catch(() => this.loadIngredientGroupShard(descriptor)) : this.loadIngredientGroupShard(descriptor);
    this.groupShards.set(descriptor.id, pending);
    void pending.catch(() => this.groupShards.delete(descriptor.id));
    return pending;
  }

  /** Hydrate exactly one stable detail partition and overlay its catalog entries. */
  async entryFor(id: string, signal?: AbortSignal): Promise<CatalogEntry | undefined> {
    if (signal?.aborted) throw new DOMException('Operation was cancelled', 'AbortError');
    const entry = this.entriesById.get(id);
    if (!entry || this.manifest.formatVersion !== 7) return entry;
    if (this.goodsIds.has(id)) {
      if (!this.goodsDetails.has(id)) {
        const descriptor = descriptorForStableId(this.manifest.goodsDetailShards ?? [], 'goods', id);
        if (!descriptor) throw new Error(`No goods-detail partition contains ${id}`);
        const details = await withAbort(this.detailShard(descriptor), signal);
        for (const detail of details) {
          this.goodsDetails.set(detail.id, detail);
          const target = this.entriesById.get(detail.id);
          if (!target) throw new Error(`${descriptor.id}: detail references unknown goods ${detail.id}`);
          this.entriesById.set(detail.id, { ...target,
            numericId: detail.numericId,
            unlocalizedName: detail.unlocalizedName,
            nbt: detail.nbt ?? target.nbt,
            rawTooltip: detail.tooltip ?? target.rawTooltip,
            formattedTooltip: detail.tooltipFormats?.length
              ? restoreMinecraftFormatting(detail.tooltip ?? target.rawTooltip ?? '', detail.tooltipFormats) : undefined,
            productionShards: detail.productionShards,
            usageShards: detail.usageShards,
            productionCount: detail.productionOreDictionaryId ? undefined : detail.productionCount,
            usageCount: detail.usageCount,
            specialProductionShards: detail.specialProductionShards,
            specialUsageShards: detail.specialUsageShards,
            specialProductionLookupIds: detail.specialProductionLookupIds,
            specialUsageLookupIds: detail.specialUsageLookupIds,
            specialProductionCounts: detail.specialProductionCounts,
            specialUsageCounts: detail.specialUsageCounts,
            specialProductionCount: detail.specialProductionCount,
            specialUsageCount: detail.specialUsageCount,
            productionOreDictionaryId: detail.productionOreDictionaryId,
            oreDictionaryIds: detail.oreDictionaryIds,
            container: detail.container,
            containerItemIds: detail.containerItemIds,
            machineCapabilities: detail.machineCapabilities
          });
        }
      }
      return this.entriesById.get(id);
    }
    const stub = this.ingredientGroups.get(id);
    if (!stub) return undefined;
    if (!this.hydratedGroups.has(id)) {
      const descriptor = descriptorForStableId(this.manifest.ingredientGroupShards ?? [], 'oreDictionaries', id);
      if (!descriptor) throw new Error(`No ingredient-group partition contains ${id}`);
      const groups = await withAbort(this.groupShard(descriptor), signal);
      for (const group of groups) {
        this.ingredientGroups.set(group.id, group);
        this.hydratedGroups.add(group.id);
        const target = this.entriesById.get(group.id);
        if (!target) throw new Error(`${descriptor.id}: group references unknown entry ${group.id}`);
        const representative = group.itemIds.map((member) => this.entriesById.get(member)).find(Boolean);
        this.entriesById.set(group.id, { ...target,
          members: group.itemIds,
          tooltip: [`${group.itemIds.length.toLocaleString('en-US')} interchangeable item${group.itemIds.length === 1 ? '' : 's'}`,
            'All listed members are valid recipe ingredients.'],
          icon: representative?.icon,
          productionShards: group.productionShards ?? [],
          usageShards: group.usageShards ?? [],
          productionCount: group.productionCount,
          usageCount: group.usageCount,
          specialProductionShards: group.specialProductionShards ?? [],
          specialUsageShards: group.specialUsageShards ?? [],
          specialProductionLookupIds: group.specialProductionLookupIds ?? [],
          specialUsageLookupIds: group.specialUsageLookupIds ?? [],
          specialProductionCounts: group.specialProductionCounts,
          specialUsageCounts: group.specialUsageCounts,
          specialProductionCount: group.specialProductionCount ?? 0,
          specialUsageCount: group.specialUsageCount ?? 0,
          machineCapabilities: group.machineCapabilities
        });
      }
    }
    return this.entriesById.get(id);
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
    return this.readDecodedShard(descriptor, (raw) => {
      const shard = raw as PackedShard;
      if (
        shard.schemaVersion !== 5
        || shard.kind !== 'recipeShard'
        || shard.logicalId !== descriptor.id
        || shard.logicalId !== descriptor.logicalId
        || shard.recipeTypeId !== descriptor.recipeTypeId
        || shard.prefix !== descriptor.prefix
      ) throw new Error(`${descriptor.id}: shared recipe shard identity mismatch`);
      return this.validateRecipeRecords(descriptor, shard.recipes);
    });
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
        if (!this.goodsIds.has(goodsId) && !this.ingredientGroups.has(goodsId)) {
          throw new Error(`${descriptor.id}: record ${record.id} references unknown goods ${goodsId}`);
        }
      }
    }
    return records;
  }

  private async loadSpecialShard(descriptor: SpecialShardDescriptor): Promise<PackedSpecialRecord[]> {
    return this.readDecodedShard(descriptor, (raw) => {
      const shard = raw as PackedSpecialShard;
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
    });
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
    if (this.manifest.formatVersion === 7) {
      const detail = this.goodsDetails.get(entryId);
      const group = this.ingredientGroups.get(entryId);
      const ids = view === 'recipes'
        ? detail?.specialProductionMatchIds ?? group?.specialProductionMatchIds
        : detail?.specialUsageMatchIds ?? group?.specialUsageMatchIds;
      return ids ? new Set(ids) : null;
    }
    return null;
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
    await this.entryFor(entryId, signal);
    const fallbackId = view === 'recipes' ? this.goodsDetails.get(entryId)?.productionOreDictionaryId : undefined;
    if (fallbackId) await this.entryFor(fallbackId, signal);
    const entryIds = this.specialRecordIds(entryId, view);
    if (entryIds && fallbackId) {
      for (const id of this.ingredientGroups.get(fallbackId)?.itemIds ?? []) entryIds.add(id);
    }
    if (!entryIds) {
      onProgress?.({ loadedShards: 0, totalShards: 0, batch: [] });
      return [];
    }
    const scopedShardIds = [...new Set([...(view === 'recipes' ? this.entriesById.get(entryId)?.specialProductionShards
      : this.entriesById.get(entryId)?.specialUsageShards) ?? [],
      ...(fallbackId ? this.ingredientGroups.get(fallbackId)?.specialProductionShards ?? [] : [])])];
    const shardIds = scopedShardIds.filter((id) => {
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
    await this.entryFor(entryId, signal);
    const isGoods = this.goodsIds.has(entryId);
    const fallbackId = view === 'recipes' ? this.goodsDetails.get(entryId)?.productionOreDictionaryId : undefined;
    if (fallbackId) await this.entryFor(fallbackId, signal);
    const selectedGroup = this.ingredientGroups.get(entryId);
    if (!isGoods && !selectedGroup) return [];
    const catalogEntry = this.entriesById.get(entryId);
    const lazyDetail = this.goodsDetails.get(entryId);
    const machineCapabilities = catalogEntry?.machineCapabilities ?? [];
    const shardIds = view === 'machineUsages'
      ? [...new Set(machineCapabilities.flatMap((capability) => capability.recipeShards))]
      : selectedGroup
      ? view === 'recipes'
        ? catalogEntry?.productionShards ?? []
        : catalogEntry?.usageShards ?? []
      : view === 'recipes'
        ? (fallbackId ? this.ingredientGroups.get(fallbackId)?.productionShards : catalogEntry?.productionShards) ?? []
        : catalogEntry?.usageShards ?? [];
    const selectedMembers = selectedGroup
      ? new Set(selectedGroup.itemIds)
      : new Set(view === 'recipes'
          ? (fallbackId ? this.ingredientGroups.get(fallbackId)?.itemIds : lazyDetail?.productionMatchIds) ?? [entryId]
          : lazyDetail?.usageMatchIds ?? [entryId]);
    const matches = (recipe: PackedRecipe) => {
      if (view === 'machineUsages') {
        const capability = machineCapabilities.find(
          (candidate) => candidate.recipeTypeId === recipe.recipeTypeId
        );
        return capability !== undefined
          && machineCanProcessVoltage(capability, recipe.gt?.voltageTier);
      }
      return (view === 'recipes' ? recipe.outputs : recipe.inputs).some((io) => {
        return ingredientMatchesEntry(io, entryId, selectedMembers, this.ingredientGroups);
      });
    };
    onProgress?.({ loadedShards: 0, totalShards: shardIds.length, batch: [] });
    const batches = await mapProgressively(
      shardIds,
      2,
      async (shardId, shardIndex) => {
        const recipes = await this.loadShard(shardId);
        const matchingIngredients = (recipe: PackedRecipe) => view === 'recipes' ? recipe.outputs : recipe.inputs;
        const directMatch = (recipe: PackedRecipe) => matchingIngredients(recipe).some((io) =>
          io.kind !== 'oreDict' && io.kind !== 'itemGroup' && selectedMembers.has(io.goodsId));
        // Only the matching side can decide whether a recipe belongs to this item.
        const groupIds = new Set((view === 'machineUsages' ? [] : recipes.filter((recipe) => !directMatch(recipe)))
          .flatMap(matchingIngredients)
          .filter((io) => io.kind === 'oreDict' || io.kind === 'itemGroup').map((io) => io.goodsId));
        await Promise.all([...groupIds].map((groupId) => this.entryFor(groupId, signal)));
        const matched = recipes.filter(matches);
        // Hydrate presentation alternatives only for recipes actually being displayed.
        const displayedGroups = new Set(matched.flatMap((recipe) => [...recipe.inputs, ...recipe.outputs])
          .filter((io) => io.kind === 'oreDict' || io.kind === 'itemGroup').map((io) => io.goodsId));
        await Promise.all([...displayedGroups].map((groupId) => this.entryFor(groupId, signal)));
        const batch = matched.map((recipe, recipeIndex) => materializeRecipe(
          recipe, shardIndex * 1_000_000 + recipeIndex, this.types, this.ingredientGroups
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
