import { catalogOrderAsset } from './catalogOrderIndex';
import { specialGoodsForDirection, specialGroupMatchesItem } from './specialMatching';
import { physicalDescriptorsFor, sharedPrefixIsPublished } from './datasetLayout';
import { ingredientGroupPreview } from './catalogMaterialization';
import { matchesRecipeConstraints, type RecipeConstraints } from './recipeFinder';
import { decode } from '@msgpack/msgpack';
import { catalogIndexes, prepareCatalog, type PreparedCatalogIndexes } from './catalogPreparation';
import {
  cachePreparedCatalog,
  cachePreparedSearch,
  getPreparedCatalog,
  getPreparedSearch,
  preparedCatalogKey,
  type PreparedCatalog,
} from './preparedCatalogCache';
import { decompress, fetchJsonNetworkFirst, fetchVerified, yieldToBrowser } from './datasetAssets';
import type {
  DatasetAsset,
  DatasetManifest,
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
  VersionsIndex,
} from './datasetSchema';
import { ingredientMatchesEntry } from './oreDictionary';
import { assetDigest, verifyAssetBytesAsync } from './integrity';
import type { ChainReference } from './recipeChain';
import { expandRelations } from './packedRelations';
import { recordPageSelections } from './recordPages';
import { restoreMinecraftFormatting } from './minecraftText';
import { installOfflineAssets } from './offline';
import { materializeRecipe } from './recipeMaterialization';
import { applyFrontendPresentation } from './recipeFrontendPresentation';
import { hasNativeOreDiagrams, nativeOreRecords } from './oreDiagram';
import {
  machineCanProcessVoltage,
  machineCapabilitiesByCrafter,
  propagateOreMachineCapabilities,
} from './recipePresentation';
import { mapProgressively } from './progressive';
import { buildCatalogSearchDocuments, type CatalogSearchDocument } from './catalogSearch';
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
  recordDatasetAssets,
  saveDataset,
} from './storage';
import type {
  AssetDescriptor,
  CatalogBrowseEntry,
  CatalogEntry,
  DatasetState,
  DatasetVersion,
  OfflineInstallProgress,
  Recipe,
  RecipeView,
} from './types';
import type { SpecialRecord, SpecialViewType } from './specialData';
import {
  CURRENT_DATASET_CACHE_VERSION,
  isLegacyDatasetState,
  preferredDatasetId,
  startupDatasetSelection,
  replacementDatasetActive,
} from './datasetVersions';

function specialRecordGoodsIds(
  record: Pick<SpecialRecord, 'goodsIds' | 'productionGoodsIds' | 'usageGoodsIds' | 'payload'>,
): string[] {
  const result = new Set<string>([
    ...(record.goodsIds ?? []),
    ...(record.productionGoodsIds ?? []),
    ...(record.usageGoodsIds ?? []),
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
        child
          .filter((candidate): candidate is string => typeof candidate === 'string')
          .forEach((candidate) => result.add(candidate));
      }
      visit(child);
    }
  };
  visit(record.payload);
  return [...result].sort();
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function validSharedPrefixMap(value: unknown): value is Record<string, string[]> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value as Record<string, unknown>).every(
      ([namespace, prefixes]) =>
        namespace.length > 0 &&
        Array.isArray(prefixes) &&
        prefixes.length > 0 &&
        prefixes.every((prefix) => typeof prefix === 'string' && /^[0-9a-f]{0,8}$/.test(prefix)) &&
        new Set(prefixes).size === prefixes.length,
    )
  );
}

function validSharedPrefixList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((prefix) => typeof prefix === 'string' && /^[0-9a-f]{0,8}$/.test(prefix)) &&
    new Set(value).size === value.length
  );
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
  recordPages: readonly DatasetAsset[],
): Set<string> {
  const physicalPages = new Map(recordPages.map((asset, index) => [index, asset]));
  const result = new Set<string>();
  for (const asset of assets) {
    if (asset.segments) {
      for (const [pageIndex] of recordPageSelections(asset)) {
        const page = physicalPages.get(pageIndex);
        if (!page) {
          throw new Error(
            `${asset.id}: record page index ${String(pageIndex)} is absent from the manifest`,
          );
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
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

function descriptorForStableId<T extends { prefix: string }>(
  descriptors: readonly T[],
  namespace: string,
  id: string,
): T | undefined {
  const hash = assetDigest(new TextEncoder().encode(`${namespace}\0${id}`));
  return [...descriptors]
    .filter((descriptor) => hash.startsWith(descriptor.prefix))
    .sort((left, right) => right.prefix.length - left.prefix.length)[0];
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

async function loadVersionsIndex(
  cachedWaitMs?: number,
): Promise<{ value: VersionsIndex; url: string }> {
  const v7Url = new URL('./versions-v7.json', document.baseURI).href;
  return fetchJsonNetworkFirst<VersionsIndex>(v7Url, `versions:${v7Url}`, cachedWaitMs);
}

type RecipeShardDescriptor = DatasetManifest['recipeShards'][number];
type SpecialShardDescriptor = DatasetManifest['specialDataShards'][number];

export class DatasetRepository {
  readonly entries: CatalogEntry[];
  readonly browseEntries: CatalogBrowseEntry[];
  get catalogEntriesById(): ReadonlyMap<string, CatalogEntry> {
    return this.entriesById;
  }
  readonly browseEntriesById: ReadonlyMap<string, CatalogBrowseEntry>;
  private readonly searchDocumentsPromises = new Map<boolean, Promise<CatalogSearchDocument[]>>();
  private readonly runtimeCacheKey: string;
  private preparedCatalog?: PreparedCatalog;

  /** Search text is loaded and normalized only once a search is requested. */
  loadSearchDocuments(includeOreDictionary = false): Promise<CatalogSearchDocument[]> {
    const existing = this.searchDocumentsPromises.get(includeOreDictionary);
    if (existing) return existing;
    const cacheKey = `${this.runtimeCacheKey}:search-syntax-v1:${includeOreDictionary ? 'ore' : 'base'}`;
    const pending = (async () => {
      const cached = await getPreparedSearch(this.datasetId, cacheKey, this.browseEntries.length);
      if (cached) {
        return cached;
      }
      await yieldToBrowser();
      const oreDictionaryIds = new Map<string, string[]>();
      if (includeOreDictionary) {
        await mapProgressively(this.manifest.ingredientGroupShards, 3, async (descriptor) => {
          for (const group of await this.groupShard(descriptor)) {
            if (!group.id.startsWith('o:')) continue;
            for (const itemId of group.itemIds) {
              const names = oreDictionaryIds.get(itemId);
              if (names) names.push(group.id);
              else oreDictionaryIds.set(itemId, [group.id]);
            }
          }
        });
      }
      const documents: CatalogSearchDocument[] = [];
      for (let start = 0; start < this.browseEntries.length; start += 500) {
        documents.push(
          ...buildCatalogSearchDocuments(
            this.browseEntries.slice(start, start + 500),
            this.entries,
            this.entriesById,
            oreDictionaryIds,
          ),
        );
        await yieldToBrowser();
      }
      void cachePreparedSearch(this.datasetId, cacheKey, documents).catch((error: unknown) =>
        console.warn('Unable to cache prepared search', error),
      );
      return documents;
    })();
    this.searchDocumentsPromises.set(includeOreDictionary, pending);
    void pending.catch(() => this.searchDocumentsPromises.delete(includeOreDictionary));
    return pending;
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
  private readonly additionalMachineCapabilities: Map<
    string,
    import('./types').MachineRecipeCapability[]
  >;
  private readonly ingredientGroups: Map<string, PackedOreDictionary | PackedIngredientGroup>;
  private readonly entriesById: Map<string, CatalogEntry>;
  private readonly goodsDetails = new Map<string, PackedGoodsDetail>();
  private readonly hydratedGroups = new Set<string>();
  private readonly detailShards = new Map<string, Promise<PackedGoodsDetail[]>>();
  private readonly groupShards = new Map<
    string,
    Promise<Array<PackedOreDictionary | PackedIngredientGroup>>
  >();
  private readonly reusableDetailShards = new Map<string, Promise<PackedGoodsDetail[]>>();
  private readonly reusableGroupShards = new Map<
    string,
    Promise<Array<PackedOreDictionary | PackedIngredientGroup>>
  >();
  private readonly shards = new Map<string, Promise<PackedRecipe[]>>();
  private readonly specialShards = new Map<string, Promise<PackedSpecialRecord[]>>();
  /** Loaded shard promises borrowed from the repository being replaced. */
  private readonly reusableRecipeShards = new Map<string, Promise<PackedRecipe[]>>();
  private readonly reusableSpecialShards = new Map<string, Promise<PackedSpecialRecord[]>>();

  private get assets(): DatasetAsset[] {
    return [
      ...this.manifest.recordPages,
      ...this.manifest.iconSheets,
      ...[catalogOrderAsset(this.manifest, this.manifestUrl)].filter(
        (asset): asset is DatasetAsset => asset !== undefined,
      ),
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
    prepared: PreparedCatalog,
    indexes: PreparedCatalogIndexes,
    reuseFrom?: DatasetRepository,
  ) {
    this.manifest = manifest;
    this.manifestUrl = manifestUrl;
    this.datasetId = manifest.datasetId;
    this.gtnhVersion = manifest.gtnhVersion;
    this.revision = manifest.revision;
    this.runtimeCacheKey = runtimeCacheKey;
    const resolved = prepared.resolved;
    this.entries = resolved.entries;
    this.goodsIds = indexes.goodsIds;
    this.types = resolved.recipeTypes;
    this.additionalMachineCapabilities = machineCapabilitiesByCrafter(
      [...this.types.values()].map((type) => ({
        ...type,
        singleblocks: [],
        multiblocks: [],
        defaultCrafter: null,
      })),
      manifest.recipeShards,
    );
    this.ingredientGroups = resolved.ingredientGroups;
    this.entriesById = indexes.entriesById;
    this.browseEntries = indexes.browseEntries;
    this.browseEntriesById = indexes.browseById;
    for (const descriptor of manifest.goodsDetailShards ?? []) {
      const source = reuseFrom?.manifest.goodsDetailShards?.find(
        (candidate) =>
          candidate.sha256 === descriptor.sha256 && candidate.logicalId === descriptor.logicalId,
      );
      const pending = source && reuseFrom?.detailShards.get(source.id);
      if (pending) this.reusableDetailShards.set(descriptor.sha256, pending);
    }
    for (const descriptor of manifest.ingredientGroupShards ?? []) {
      const source = reuseFrom?.manifest.ingredientGroupShards?.find(
        (candidate) =>
          candidate.sha256 === descriptor.sha256 && candidate.logicalId === descriptor.logicalId,
      );
      const pending = source && reuseFrom?.groupShards.get(source.id);
      if (pending) this.reusableGroupShards.set(descriptor.sha256, pending);
    }
    for (const descriptor of manifest.recipeShards) {
      const sourceDescriptor = reuseFrom?.manifest.recipeShards.find(
        (candidate) =>
          candidate.sha256 === descriptor.sha256 &&
          candidate.id === descriptor.id &&
          candidate.logicalId === descriptor.logicalId &&
          candidate.recipeTypeId === descriptor.recipeTypeId &&
          candidate.prefix === descriptor.prefix,
      );
      const sourceShard = sourceDescriptor && reuseFrom?.shards.get(sourceDescriptor.id);
      if (sourceShard) this.reusableRecipeShards.set(descriptor.sha256, sourceShard);
    }
    for (const descriptor of manifest.specialDataShards) {
      const sourceDescriptor = reuseFrom?.manifest.specialDataShards.find(
        (candidate) =>
          candidate.sha256 === descriptor.sha256 &&
          candidate.id === descriptor.id &&
          candidate.logicalId === descriptor.logicalId &&
          candidate.specialViewTypeId === descriptor.specialViewTypeId &&
          candidate.prefix === descriptor.prefix,
      );
      const sourceShard = sourceDescriptor && reuseFrom?.specialShards.get(sourceDescriptor.id);
      if (sourceShard) this.reusableSpecialShards.set(descriptor.sha256, sourceShard);
    }
    this.specialViewTypes = (prepared.specialViewTypes ?? []).map((viewType, order) => ({
      ...viewType,
      order,
    }));
    const entriesById = this.entriesById;
    this.specialServiceIcons = (prepared.specialServiceIcons ?? []).map((icon) => ({
      ...icon,
      icon: icon.goodsId ? (entriesById.get(icon.goodsId)?.icon ?? null) : null,
    }));
    const serviceIconIds = new Set(this.specialServiceIcons.map((icon) => icon.id));
    for (const icon of this.specialServiceIcons) {
      if (icon.goodsId && !entriesById.has(icon.goodsId)) {
        throw new Error(`Special service icon ${icon.id} references unknown goods ${icon.goodsId}`);
      }
    }
    for (const viewType of this.specialViewTypes) {
      if (!viewType.serviceIconId || !serviceIconIds.has(viewType.serviceIconId)) {
        throw new Error(
          `Special view ${viewType.id} references unknown service icon ${viewType.serviceIconId}`,
        );
      }
    }
  }

  /** Capture startup intent before activation, then wait for the background index. */
  static async startupRollout(
    requested?: string,
  ): Promise<(DatasetVersion & { rolloutEpoch: number }) | undefined> {
    const installed = await listDatasets();
    const { value: index } = await loadVersionsIndex();
    const applied = await getCachedMetadata<number>('dataset-rollout-epoch');
    const selection = startupDatasetSelection(index, installed, requested, applied?.value);
    if (selection.rolloutEpoch === undefined) return undefined;
    const version = index.versions.find((candidate) => candidate.datasetId === selection.datasetId);
    return version && { ...version, rolloutEpoch: selection.rolloutEpoch };
  }

  static async availableVersions(): Promise<DatasetVersion[]> {
    return (await loadVersionsIndex(150)).value.versions;
  }

  static async load(
    datasetId?: string,
    onProgress?: (progress: DatasetLoadProgress) => void,
    /** The active repository, whose already-decoded immutable data may be borrowed. */
    reuseFrom?: DatasetRepository,
    startup = false,
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
      const selection =
        index && startupDatasetSelection(index.value, installed, datasetId, epoch?.value);
      if (
        !active ||
        !selection?.rolloutEpoch ||
        selection.datasetId === active.datasetId ||
        selection.datasetId !== index?.value.rollout?.targetDatasetId
      )
        throw error;
      // Keep the usable v7 cache when a rollout bootstrap is unavailable. Retry the epoch next startup.
      return DatasetRepository.loadSelected(active.datasetId, onProgress, reuseFrom, false, false);
    }
  }

  private static async loadSelected(
    datasetId?: string,
    onProgress?: (progress: DatasetLoadProgress) => void,
    reuseFrom?: DatasetRepository,
    startup = false,
    acknowledgeChoice = true,
  ): Promise<DatasetRepository> {
    const progressContext: { gtnhVersion?: string } = {};
    let lastPercent = 0;
    const report = (percent: number, stage: string) => {
      lastPercent = Math.max(lastPercent, Math.min(100, percent));
      onProgress?.({
        percent: lastPercent,
        stage,
        gtnhVersion: progressContext.gtnhVersion,
      });
    };
    report(3, 'Checking available GTNH versions');
    const versionsResult = await loadVersionsIndex(150);
    const versions = versionsResult.value;
    const installed = await listDatasets();
    const applied = startup ? await getCachedMetadata<number>('dataset-rollout-epoch') : null;
    const selection = startup
      ? startupDatasetSelection(versions, installed, datasetId, applied?.value)
      : {
          datasetId: preferredDatasetId(versions.versions, installed, datasetId),
          // An explicit manager choice takes precedence over a pending automatic switch.
          rolloutEpoch: acknowledgeChoice
            ? startupDatasetSelection(versions, installed, datasetId, applied?.value).rolloutEpoch
            : undefined,
        };
    const selectedId = selection.datasetId;
    const published = versions.versions.find((version) => version.datasetId === selectedId);
    const installedSelection = installed.find(
      (dataset) =>
        dataset.datasetId === selectedId &&
        !isLegacyDatasetState(dataset) &&
        !dataset.datasetId.includes('-v6-'),
    );
    const selected =
      published ??
      (installedSelection
        ? {
            datasetId: installedSelection.datasetId,
            gtnhVersion: installedSelection.gtnhVersion,
            revision: installedSelection.revision,
            packManifestUrl: installedSelection.manifestUrl,
          }
        : undefined);
    if (!selected) throw new Error('No published GTNH datasets are available');
    progressContext.gtnhVersion = selected.gtnhVersion;
    report(5, 'Dataset selected');
    const manifestUrl = new URL(selected.packManifestUrl, versionsResult.url).href;
    report(8, 'Loading dataset manifest');
    const manifestResult = await fetchJsonNetworkFirst<DatasetManifest>(
      manifestUrl,
      `manifest:${manifestUrl}`,
      0,
    );
    const manifest = manifestResult.value;
    if (manifest.formatVersion !== 7) {
      throw new Error(
        `Unsupported pack manifest format ${String(manifest.formatVersion)}; only format 7 is supported`,
      );
    }
    if (!Array.isArray(manifest.recordPages) || manifest.recordPages.length === 0) {
      throw new Error(`Format-${manifest.formatVersion} manifest has no record pages`);
    }
    if (
      manifest.formatVersion === 7 &&
      (!Array.isArray(manifest.goodsDetailShards) ||
        !Array.isArray(manifest.ingredientGroupShards) ||
        manifest.goodsDetailShards.length === 0)
    )
      throw new Error('Format-7 manifest is missing lazy detail families');
    if (
      manifest.catalogAssets.some((asset) => !isLogicalRecordAsset(asset)) ||
      (manifest.goodsDetailShards ?? []).some((asset) => !isLogicalRecordAsset(asset)) ||
      (manifest.ingredientGroupShards ?? []).some((asset) => !isLogicalRecordAsset(asset)) ||
      manifest.recipeShards.some((asset) => !isLogicalRecordAsset(asset)) ||
      manifest.specialDataShards.some((asset) => !isLogicalRecordAsset(asset))
    ) {
      throw new Error(
        `Format-${manifest.formatVersion} logical assets must use record-page segments`,
      );
    }
    const recordPageHashes = new Set(manifest.recordPages.map((asset) => asset.sha256));
    if (
      recordPageHashes.size !== manifest.recordPages.length ||
      manifest.recordPages.some(
        (asset) =>
          !/^[a-f0-9]{64}$/.test(asset.sha256) ||
          !Number.isSafeInteger(asset.bytes) ||
          asset.bytes < 0 ||
          asset.encoding !== 'gzip' ||
          typeof asset.url !== 'string' ||
          asset.url.length === 0 ||
          asset.segments !== undefined,
      )
    ) {
      throw new Error(
        `Format-${manifest.formatVersion} manifest has invalid physical record pages`,
      );
    }
    for (const asset of [
      ...manifest.catalogAssets,
      ...(manifest.goodsDetailShards ?? []),
      ...(manifest.ingredientGroupShards ?? []),
      ...manifest.recipeShards,
      ...manifest.specialDataShards,
    ]) {
      if (
        asset.encoding !== 'identity' ||
        asset.url !== '' ||
        !recordPageSelections(asset).every(
          ([pageIndex, first, count]) =>
            Number.isSafeInteger(pageIndex) &&
            pageIndex >= 0 &&
            pageIndex < manifest.recordPages.length &&
            Number.isSafeInteger(first) &&
            Number.isSafeInteger(count) &&
            first >= 0 &&
            count >= 1,
        )
      ) {
        throw new Error(`${asset.id}: invalid record-page logical descriptor`);
      }
    }
    if (manifest.formatVersion === 7) {
      const expectedFamilies = new Map<DatasetAsset, DatasetAsset['family']>([
        ...manifest.catalogAssets.map((asset) => [asset, 'bootstrap'] as const),
        ...manifest.goodsDetailShards!.map((asset) => [asset, 'goods-details'] as const),
        ...manifest.ingredientGroupShards!.map((asset) => [asset, 'ingredient-groups'] as const),
        ...manifest.recipeShards.map((asset) => [asset, 'recipes'] as const),
        ...manifest.specialDataShards.map((asset) => [asset, 'special'] as const),
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
      if (
        !layout ||
        manifest.assetStore !== 'global-sha256' ||
        layout.schemaVersion !== 1 ||
        !/^[a-f0-9]{64}$/.test(layout.layoutSha256) ||
        !validSharedPrefixMap(layout.prefixes.recipeTypes) ||
        !validSharedPrefixList(layout.prefixes.goods) ||
        !validSharedPrefixList(layout.prefixes.oreDictionaries) ||
        !validSharedPrefixMap(layout.prefixes.specialViews)
      ) {
        throw new Error('Manifest is missing shared object-store metadata');
      }
      if (Object.values(layout.targets).some((bytes) => !Number.isInteger(bytes) || bytes < 1024)) {
        throw new Error('Manifest has invalid shared-layout targets');
      }
    }
    if (manifest.datasetId !== selected.datasetId)
      throw new Error('Manifest dataset identity mismatch');
    const legacyStates = installed.filter(
      (state) => isLegacyDatasetState(state) && state.gtnhVersion === manifest.gtnhVersion,
    );
    const sameVersionStates = installed.filter(
      (state) =>
        state.gtnhVersion === manifest.gtnhVersion && state.datasetId !== manifest.datasetId,
    );
    const obsoleteStates = [
      ...new Map(
        [...sameVersionStates, ...legacyStates].map((state) => [state.datasetId, state] as const),
      ).values(),
    ];
    report(12, 'Restoring cached items');
    const cacheKey = preparedCatalogKey(manifest, manifestResult.url);
    let prepared = await getPreparedCatalog(manifest.datasetId, cacheKey);
    const wasCached = Boolean(prepared);
    let needsCache = !prepared;
    if (!prepared) prepared = await prepareCatalog(manifest, manifestResult.url, report);
    report(94, 'Preparing items');
    let repository: DatasetRepository;
    const create = async (data: PreparedCatalog) =>
      new DatasetRepository(
        manifest,
        manifestResult.url,
        cacheKey,
        data,
        await catalogIndexes(data),
        reuseFrom,
      );
    try {
      repository = await create(prepared);
    } catch (error) {
      if (!wasCached) throw error;
      // A damaged prepared cache is disposable; immutable source pages remain verified.
      prepared = await prepareCatalog(manifest, manifestResult.url, report);
      needsCache = true;
      repository = await create(prepared);
    }
    if (needsCache)
      repository.preparedCatalog = {
        ...prepared,
        resolved: {
          entries: repository.entries,
          recipeTypes: repository.types,
          ingredientGroups: repository.ingredientGroups,
        },
      };
    const previous = await getDataset(manifest.datasetId);
    const manifestAssetHashes = new Set(repository.assets.map((asset) => asset.sha256));
    const assetHashes = new Set(
      (previous?.assetHashes ?? []).filter((hash) => manifestAssetHashes.has(hash)),
    );
    const cachedSizes = await cachedAssetSizes();
    for (const asset of repository.assets) {
      if (cachedSizes.get(asset.sha256) === asset.bytes) assetHashes.add(asset.sha256);
    }
    const allAssets = repository.assets;
    const catalogHashes = physicalHashesForLogicalAssets(
      manifest.catalogAssets,
      manifest.recordPages,
    );
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
        : allAssets.some(
              (asset) => !catalogHashes.has(asset.sha256) && assetHashes.has(asset.sha256),
            )
          ? 'partial'
          : 'catalog',
      storedBytes,
      totalBytes: repository.offlineBytes,
      active: replacementDatasetActive(previous ?? undefined, sameVersionStates, installed),
      assetHashes: [...assetHashes],
      updatedAt: Date.now(),
    });
    if (repository.preparedCatalog) {
      void cachePreparedCatalog(
        repository.datasetId,
        repository.runtimeCacheKey,
        repository.preparedCatalog,
      ).catch((error: unknown) => console.warn('Unable to cache prepared items', error));
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

  static loadLatest(
    onProgress?: (progress: DatasetLoadProgress) => void,
  ): Promise<DatasetRepository> {
    return DatasetRepository.load(undefined, onProgress);
  }

  private pendingRolloutEpoch?: number;

  async activate(): Promise<void> {
    await activateDataset(this.datasetId);
    if (this.pendingRolloutEpoch !== undefined) {
      await this.acknowledgeRollout(this.pendingRolloutEpoch);
      this.pendingRolloutEpoch = undefined;
    }
  }

  /** Acknowledge only after this verified repository is successfully active. */
  async acknowledgeRollout(epoch: number): Promise<void> {
    const applied = await getCachedMetadata<number>('dataset-rollout-epoch');
    if ((applied?.value ?? 0) < epoch) {
      await cacheMetadata('dataset-rollout-epoch', this.manifestUrl, epoch);
    }
  }

  private async readDecodedShard<T>(
    descriptor: DatasetAsset,
    validate: (value: unknown) => T,
  ): Promise<T> {
    const key = `decoded-v1:${descriptor.sha256}`;
    const cached = await getRuntimeCache<unknown>(this.datasetId, key);
    if (cached !== null) {
      try {
        return validate(cached);
      } catch {
        /* Rebuild a corrupt projection from verified bytes. */
      }
    }
    const bytes = await fetchVerified(
      descriptor,
      this.manifestUrl,
      undefined,
      undefined,
      this.manifest,
    );
    await this.recordAsset(descriptor);
    const raw = await decodeAssetPayload(descriptor, bytes);
    await yieldToBrowser();
    const value = validate(raw);
    void cacheRuntimeData(this.datasetId, key, raw);
    return value;
  }

  private async loadGoodsDetailShard(
    descriptor: NonNullable<DatasetManifest['goodsDetailShards']>[number],
  ): Promise<PackedGoodsDetail[]> {
    return this.readDecodedShard(descriptor, (raw) => {
      const value = raw as PackedGoodsDetailsShard;
      if (
        value.schemaVersion !== 6 ||
        value.kind !== 'goodsDetails' ||
        value.logicalId !== descriptor.logicalId ||
        value.prefix !== descriptor.prefix ||
        !Array.isArray(value.goods) ||
        value.goods.length !== descriptor.recordCount
      ) {
        throw new Error(`${descriptor.id}: goods-detail identity mismatch`);
      }
      for (const detail of value.goods) {
        if (
          !this.goodsIds.has(detail.id) ||
          descriptorForStableId(this.manifest.goodsDetailShards, 'goods', detail.id)?.id !==
            descriptor.id
        ) {
          throw new Error(`${descriptor.id}: invalid goods-detail membership ${detail.id}`);
        }
      }
      const numericIds = new Map(
        (value.goodsMetadata ?? []).map((record) => [record.id, record.numericId]),
      );
      const tooltips = new Map(
        (value.goodsTooltips ?? []).map((record) => [record.id, record.formats]),
      );
      return expandRelations(value.goods, value.lists).map((record) => ({
        ...record,
        numericId: numericIds.get(record.id) ?? record.numericId,
        tooltipFormats: tooltips.get(record.id) ?? [],
        productionCount: record.productionCount ?? 0,
        usageCount: record.usageCount ?? 0,
        specialProductionCount: record.specialProductionCount ?? 0,
        specialUsageCount: record.specialUsageCount ?? 0,
      }));
    });
  }

  private async loadIngredientGroupShard(
    descriptor: NonNullable<DatasetManifest['ingredientGroupShards']>[number],
  ): Promise<Array<PackedOreDictionary | PackedIngredientGroup>> {
    return this.readDecodedShard(descriptor, (raw) => {
      const value = raw as PackedIngredientGroupsShard;
      if (
        value.schemaVersion !== 6 ||
        value.kind !== 'ingredientGroups' ||
        value.logicalId !== descriptor.logicalId ||
        value.prefix !== descriptor.prefix ||
        !Array.isArray(value.ingredientGroups) ||
        value.ingredientGroups.length !== descriptor.recordCount
      ) {
        throw new Error(`${descriptor.id}: ingredient-group identity mismatch`);
      }
      const groups = expandRelations(value.ingredientGroups, value.lists);
      for (const group of groups) {
        if (
          !this.entriesById.has(group.id) ||
          !isStringArray(group.itemIds) ||
          group.itemIds.some((id) => !this.goodsIds.has(id)) ||
          descriptorForStableId(this.manifest.ingredientGroupShards, 'oreDictionaries', group.id)
            ?.id !== descriptor.id
        ) {
          throw new Error(`${descriptor.id}: invalid ingredient-group membership ${group.id}`);
        }
      }
      return groups;
    });
  }

  private detailShard(
    descriptor: NonNullable<DatasetManifest['goodsDetailShards']>[number],
  ): Promise<PackedGoodsDetail[]> {
    let pending = this.detailShards.get(descriptor.id);
    if (pending) return pending;
    const reusable = this.reusableDetailShards.get(descriptor.sha256);
    pending = reusable
      ? reusable.catch(() => this.loadGoodsDetailShard(descriptor))
      : this.loadGoodsDetailShard(descriptor);
    this.detailShards.set(descriptor.id, pending);
    void pending.catch(() => this.detailShards.delete(descriptor.id));
    return pending;
  }

  private groupShard(
    descriptor: NonNullable<DatasetManifest['ingredientGroupShards']>[number],
  ): Promise<Array<PackedOreDictionary | PackedIngredientGroup>> {
    let pending = this.groupShards.get(descriptor.id);
    if (pending) return pending;
    const reusable = this.reusableGroupShards.get(descriptor.sha256);
    pending = reusable
      ? reusable.catch(() => this.loadIngredientGroupShard(descriptor))
      : this.loadIngredientGroupShard(descriptor);
    this.groupShards.set(descriptor.id, pending);
    void pending.catch(() => this.groupShards.delete(descriptor.id));
    return pending;
  }

  /** Hydrate exactly one stable detail partition and overlay its catalog entries. */
  async entryFor(id: string, signal?: AbortSignal): Promise<CatalogEntry | undefined> {
    const entry = await this.loadEntry(id, signal);
    if (!entry) return undefined;
    let additional = this.additionalMachineCapabilities.get(id);
    if (!additional && entry.members) {
      const members = new Map(
        entry.members.flatMap((member) => {
          const capabilities = this.additionalMachineCapabilities.get(member);
          return capabilities ? [[member, capabilities] as const] : [];
        }),
      );
      additional =
        propagateOreMachineCapabilities(members, [{ id, itemIds: entry.members }]).get(id) ?? [];
      this.additionalMachineCapabilities.set(id, additional);
    }
    if (!additional?.length) return entry;
    const capabilities = new Map(
      (entry.machineCapabilities ?? []).map((value) => [value.recipeTypeId, value]),
    );
    for (const value of additional) capabilities.set(value.recipeTypeId, value);
    const updated = { ...entry, machineCapabilities: [...capabilities.values()] };
    this.entriesById.set(id, updated);
    return updated;
  }

  private async loadEntry(id: string, signal?: AbortSignal): Promise<CatalogEntry | undefined> {
    if (signal?.aborted) throw new DOMException('Operation was cancelled', 'AbortError');
    const entry = this.entriesById.get(id);
    if (!entry || this.manifest.formatVersion !== 7) return entry;
    if (this.goodsIds.has(id)) {
      if (!this.goodsDetails.has(id)) {
        const descriptor = descriptorForStableId(
          this.manifest.goodsDetailShards ?? [],
          'goods',
          id,
        );
        if (!descriptor) throw new Error(`No goods-detail partition contains ${id}`);
        const details = await withAbort(this.detailShard(descriptor), signal);
        // A concurrent lookup may already have applied this entire partition.
        if (this.goodsDetails.has(id)) return this.entriesById.get(id);
        for (const detail of details) {
          this.goodsDetails.set(detail.id, detail);
          const target = this.entriesById.get(detail.id);
          if (!target)
            throw new Error(`${descriptor.id}: detail references unknown goods ${detail.id}`);
          this.entriesById.set(detail.id, {
            ...target,
            numericId: detail.numericId,
            unlocalizedName: detail.unlocalizedName,
            nbt: detail.nbt ?? target.nbt,
            rawTooltip: detail.tooltip ?? target.rawTooltip,
            formattedTooltip: detail.tooltipFormats?.length
              ? restoreMinecraftFormatting(
                  detail.tooltip ?? target.rawTooltip ?? '',
                  detail.tooltipFormats,
                )
              : undefined,
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
            machineCapabilities: detail.machineCapabilities,
          });
        }
      }
      return this.entriesById.get(id);
    }
    const stub = this.ingredientGroups.get(id);
    if (!stub) return undefined;
    if (!this.hydratedGroups.has(id)) {
      const descriptor = descriptorForStableId(
        this.manifest.ingredientGroupShards ?? [],
        'oreDictionaries',
        id,
      );
      if (!descriptor) throw new Error(`No ingredient-group partition contains ${id}`);
      const groups = await withAbort(this.groupShard(descriptor), signal);
      if (this.hydratedGroups.has(id)) return this.entriesById.get(id);
      for (const group of groups) {
        this.ingredientGroups.set(group.id, group);
        this.hydratedGroups.add(group.id);
        const target = this.entriesById.get(group.id);
        if (!target)
          throw new Error(`${descriptor.id}: group references unknown entry ${group.id}`);
        this.entriesById.set(group.id, {
          ...target,
          ...ingredientGroupPreview(group.itemIds, this.entriesById),
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
          machineCapabilities: group.machineCapabilities,
        });
      }
    }
    return this.entriesById.get(id);
  }

  async installOffline(
    onProgress?: (progress: OfflineInstallProgress) => void,
    signal?: AbortSignal,
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
        this.manifest.recordPages,
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
          : this.assets.some(
                (asset) => !catalogHashes.has(asset.sha256) && hashes.has(asset.sha256),
              )
            ? 'partial'
            : 'catalog',
        storedBytes,
        totalBytes: this.offlineBytes,
        active: current?.active ?? false,
        assetHashes: [...hashes],
        updatedAt: Date.now(),
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
      onProgress,
    });
    await persist(hashes, true);
    return (await getDataset(this.datasetId))!;
  }

  private async recordAsset(asset: DatasetAsset): Promise<void> {
    await recordDatasetAssets(
      this.datasetId,
      physicalDescriptorsFor(asset, this.manifest.recordPages),
    );
  }

  private validateRecipeRecords(
    descriptor: RecipeShardDescriptor,
    recipes: PackedRecipe[],
  ): PackedRecipe[] {
    if (!Array.isArray(recipes) || recipes.length !== descriptor.recipeCount) {
      throw new Error(`${descriptor.id}: recipe count mismatch`);
    }
    if (
      !sharedPrefixIsPublished(
        this.manifest,
        'recipeTypes',
        descriptor.recipeTypeId,
        descriptor.prefix,
      )
    ) {
      throw new Error(`${descriptor.id}: recipe shard prefix is not in the published layout`);
    }
    if (!this.types.has(descriptor.recipeTypeId)) {
      throw new Error(`${descriptor.id}: recipe shard references an unknown recipe type`);
    }
    let previousId: string | undefined;
    for (const recipe of recipes) {
      if (
        !recipe ||
        typeof recipe.id !== 'string' ||
        recipe.recipeTypeId !== descriptor.recipeTypeId
      ) {
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
        shard.schemaVersion !== 5 ||
        shard.kind !== 'recipeShard' ||
        shard.logicalId !== descriptor.id ||
        shard.logicalId !== descriptor.logicalId ||
        shard.recipeTypeId !== descriptor.recipeTypeId ||
        shard.prefix !== descriptor.prefix
      )
        throw new Error(`${descriptor.id}: shared recipe shard identity mismatch`);
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
    records: PackedSpecialRecord[],
  ): PackedSpecialRecord[] {
    if (
      !sharedPrefixIsPublished(
        this.manifest,
        'specialViews',
        descriptor.specialViewTypeId,
        descriptor.prefix,
      )
    ) {
      throw new Error(`${descriptor.id}: special-data prefix is not in the published layout`);
    }
    if (!Array.isArray(records) || records.length !== descriptor.recordCount) {
      throw new Error(`${descriptor.id}: special-data record count mismatch`);
    }
    const serviceIconIds = new Set(this.specialServiceIcons.map((icon) => icon.id));
    let previousId: string | undefined;
    for (const record of records) {
      if (
        !record ||
        typeof record.id !== 'string' ||
        typeof record.category !== 'string' ||
        typeof record.title !== 'string' ||
        typeof record.searchText !== 'string' ||
        !isStringArray(record.goodsIds) ||
        (record.productionGoodsIds !== undefined && !isStringArray(record.productionGoodsIds)) ||
        (record.usageGoodsIds !== undefined && !isStringArray(record.usageGoodsIds)) ||
        typeof record.recipesLookupId !== 'string' ||
        typeof record.usagesLookupId !== 'string' ||
        typeof record.serviceIconId !== 'string' ||
        record.payload === null ||
        typeof record.payload !== 'object' ||
        Array.isArray(record.payload)
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
        throw new Error(
          `${descriptor.id}: record ${record.id} references unknown service icon ${record.serviceIconId}`,
        );
      }
      if (record.recipesLookupId.length === 0 || record.usagesLookupId.length === 0) {
        throw new Error(`${descriptor.id}: record ${record.id} has an empty lookup ID`);
      }
      for (const goodsId of specialRecordGoodsIds(record)) {
        if (!this.goodsIds.has(goodsId) && !this.ingredientGroups.has(goodsId)) {
          throw new Error(
            `${descriptor.id}: record ${record.id} references unknown goods ${goodsId}`,
          );
        }
      }
    }
    return records;
  }

  private async loadSpecialShard(
    descriptor: SpecialShardDescriptor,
  ): Promise<PackedSpecialRecord[]> {
    return this.readDecodedShard(descriptor, (raw) => {
      const shard = raw as PackedSpecialShard;
      if (
        shard.schemaVersion !== 5 ||
        shard.kind !== 'special' ||
        shard.logicalId !== descriptor.id ||
        shard.logicalId !== descriptor.logicalId ||
        shard.specialViewTypeId !== descriptor.specialViewTypeId ||
        shard.prefix !== descriptor.prefix
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
      const ids =
        view === 'recipes'
          ? (detail?.specialProductionMatchIds ?? group?.specialProductionMatchIds)
          : (detail?.specialUsageMatchIds ?? group?.specialUsageMatchIds);
      if (!ids) return null;
      const matches = new Set(ids);
      // Counts project explicit group references onto their registered members.
      // Use the same aliases here when filtering records from those shards.
      const item = this.entriesById.get(entryId);
      if (item)
        for (const id of detail?.oreDictionaryIds ?? []) {
          if (specialGroupMatchesItem(id, item)) matches.add(id);
        }
      return matches;
    }
    return null;
  }

  private specialShardIdsForViewType(viewType: string): string[] {
    return this.manifest.specialDataShards
      .filter((descriptor) => descriptor.specialViewTypeId === viewType)
      .sort(
        (left, right) =>
          left.specialViewTypeOrder - right.specialViewTypeOrder ||
          left.part - right.part ||
          left.id.localeCompare(right.id),
      )
      .map((descriptor) => descriptor.id);
  }

  private materializeSpecialRecord(
    record: PackedSpecialRecord,
    view: RecipeView,
    order: number,
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
      order,
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
    signal?: AbortSignal,
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
          .map((record, recordIndex) =>
            this.materializeSpecialRecord(record, view, shardIndex * 1_000_000 + recordIndex),
          );
        // Special slots may reference groups absent from the current item's
        // detail partition. Load their member lists before publishing the card.
        const groups = new Set(
          batch
            .flatMap((record) => specialRecordGoodsIds(record))
            .filter((id) => this.ingredientGroups.has(id)),
        );
        await Promise.all([...groups].map((id) => this.entryFor(id, signal)));
        await yieldToBrowser();
        return batch;
      },
      ({ completed, total, value }) => {
        onProgress?.({ loadedShards: completed, totalShards: total, batch: value });
      },
      signal,
    );
    const unique = new Map<string, SpecialRecord>();
    for (const record of batches.flat()) unique.set(record.id, record);
    return [...unique.values()].sort(
      (left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id),
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
    signal?: AbortSignal,
  ): Promise<SpecialRecord[]> {
    if (view === 'machineUsages') return [];
    await this.entryFor(entryId, signal);
    if (viewType === 'gt-ore-processing' && hasNativeOreDiagrams(this.datasetId)) {
      const entry = this.entriesById.get(entryId);
      if (!entry) {
        onProgress?.({ loadedShards: 0, totalShards: 0, batch: [] });
        return [];
      }
      const records = await withAbort(
        nativeOreRecords(this.datasetId, entry, view, (id) => this.entriesById.get(id)),
        signal,
      );
      onProgress?.({ loadedShards: 1, totalShards: 1, batch: records });
      return records;
    }
    const fallbackId =
      view === 'recipes' ? this.goodsDetails.get(entryId)?.productionOreDictionaryId : undefined;
    if (fallbackId) await this.entryFor(fallbackId, signal);
    const entryIds = this.specialRecordIds(entryId, view);
    if (entryIds && fallbackId) {
      for (const id of this.ingredientGroups.get(fallbackId)?.itemIds ?? []) entryIds.add(id);
    }
    if (!entryIds) {
      onProgress?.({ loadedShards: 0, totalShards: 0, batch: [] });
      return [];
    }
    const scopedShardIds = [
      ...new Set([
        ...((view === 'recipes'
          ? this.entriesById.get(entryId)?.specialProductionShards
          : this.entriesById.get(entryId)?.specialUsageShards) ?? []),
        ...(fallbackId
          ? (this.ingredientGroups.get(fallbackId)?.specialProductionShards ?? [])
          : []),
      ]),
    ];
    const shardIds = scopedShardIds.filter((id) => {
      const descriptor = this.manifest.specialDataShards.find((shard) => shard.id === id);
      return descriptor?.specialViewTypeId === viewType;
    });
    return this.specialFromShards(
      shardIds,
      view,
      viewType,
      (record) => {
        const goodsIds = specialGoodsForDirection(record, view);
        return goodsIds.some((goodsId) => entryIds.has(goodsId));
      },
      onProgress,
      signal,
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
    signal?: AbortSignal,
  ): Promise<SpecialRecord[]> {
    if (viewType === 'gt-ore-processing' && hasNativeOreDiagrams(this.datasetId)) {
      const records = await withAbort(
        nativeOreRecords(this.datasetId, undefined, view, (id) => this.entriesById.get(id)),
        signal,
      );
      onProgress?.({ loadedShards: 1, totalShards: 1, batch: records });
      return records;
    }
    return this.specialFromShards(
      this.specialShardIdsForViewType(viewType),
      view,
      viewType,
      () => true,
      onProgress,
      signal,
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
    signal?: AbortSignal,
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
    signal?: AbortSignal,
  ): Promise<SpecialRecord[]> {
    return this.specialForAll(view, viewType, onProgress, signal);
  }

  /** Optional, verified application projection; loaded only when the chain tool is used. */
  async chainIndex(
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array<ArrayBuffer>; manifestSha256: string }> {
    const registryUrl = new URL('./recipe-chain-index.json', document.baseURI).href;
    const registry = await withAbort(
      fetchJsonNetworkFirst<{
        schemaVersion: number;
        indexes: Record<string, AssetDescriptor & { manifestSha256: string }>;
      }>(registryUrl, `chain-index:${registryUrl}`, 150),
      signal,
    );
    const asset = registry.value.indexes?.[this.datasetId];
    if (
      registry.value.schemaVersion !== 1 ||
      !asset ||
      !/^[a-f0-9]{64}$/.test(asset.manifestSha256)
    ) {
      throw new Error('A matching recipe chain index is not available for this dataset');
    }
    const manifestBytes = new TextEncoder().encode(JSON.stringify(this.manifest));
    await verifyAssetBytesAsync(
      { id: 'Chain source manifest', bytes: manifestBytes.length, sha256: asset.manifestSha256 },
      manifestBytes,
    );
    const manifestSha256 = asset.manifestSha256;
    const key = `chain-index-v1:${asset.sha256}`;
    const cached = await getRuntimeCache<Uint8Array>(this.datasetId, key);
    if (cached instanceof Uint8Array) {
      try {
        await verifyAssetBytesAsync(asset, cached);
        if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
        return { bytes: Uint8Array.from(cached), manifestSha256 };
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
    const response = await fetch(new URL(asset.url, registry.url), { signal });
    if (!response.ok) throw new Error(`Unable to load recipe chain index: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await verifyAssetBytesAsync(asset, bytes);
    if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
    // Finish the IndexedDB clone before the caller transfers this buffer to a worker.
    await cacheRuntimeData(this.datasetId, key, bytes);
    return { bytes, manifestSha256 };
  }

  async chainRecipes(references: ChainReference[], signal?: AbortSignal): Promise<Recipe[]> {
    return mapProgressively(
      references,
      2,
      async (reference, index) => {
        const descriptor = this.manifest.recipeShards.find(
          (asset) => asset.id === reference.shardId,
        );
        if (
          !descriptor ||
          !Number.isSafeInteger(reference.record) ||
          reference.record < 0 ||
          reference.record >= descriptor.recipeCount
        ) {
          throw new Error('Invalid chain recipe reference');
        }
        const recipe = (await this.loadShard(reference.shardId))[reference.record];
        if (!recipe) throw new Error('Chain recipe is missing');
        const groups = new Set(
          [...recipe.inputs, ...recipe.outputs]
            .filter((io) => io.kind === 'oreDict' || io.kind === 'itemGroup')
            .map((io) => io.goodsId),
        );
        await Promise.all([...groups].map((id) => this.entryFor(id, signal)));
        return applyFrontendPresentation(
          materializeRecipe(recipe, index, this.types, this.ingredientGroups, this.gtnhVersion),
        );
      },
      undefined,
      signal,
    );
  }

  /** Use the narrowest indexed ingredient, then verify the complete subset on both sides. */
  async findRecipes(
    constraints: RecipeConstraints,
    onProgress?: (progress: RecipeLoadProgress) => void,
    signal?: AbortSignal,
  ): Promise<Recipe[]> {
    const candidates = [
      ...constraints.inputs.map((id) => ({ id, view: 'usages' as const })),
      ...constraints.outputs.map((id) => ({ id, view: 'recipes' as const })),
    ];
    if (!candidates.length) return [];
    const hydrated = await Promise.all(
      candidates.map(async (candidate) => {
        const entry = await this.entryFor(candidate.id, signal);
        const fallback =
          candidate.view === 'recipes' && entry?.productionOreDictionaryId
            ? await this.entryFor(entry.productionOreDictionaryId, signal)
            : undefined;
        const source = fallback ?? entry;
        const shards =
          candidate.view === 'recipes' ? source?.productionShards : source?.usageShards;
        return { ...candidate, entry, shardCount: shards?.length ?? 0 };
      }),
    );
    if (hydrated.some((candidate) => !candidate.entry || candidate.shardCount === 0)) {
      onProgress?.({ loadedShards: 0, totalShards: 0, batch: [] });
      return [];
    }
    hydrated.sort((a, b) => a.shardCount - b.shardCount);
    const anchor = hydrated[0]!;
    const matches = (recipe: Recipe) => matchesRecipeConstraints(recipe, constraints);
    const recipes = await this.recipesFor(
      anchor.id,
      anchor.view,
      (progress) => {
        onProgress?.({ ...progress, batch: progress.batch.filter(matches) });
      },
      signal,
    );
    return recipes.filter(matches);
  }

  async recipesFor(
    entryId: string,
    view: RecipeView,
    onProgress?: (progress: RecipeLoadProgress) => void,
    signal?: AbortSignal,
  ): Promise<Recipe[]> {
    await this.entryFor(entryId, signal);
    const isGoods = this.goodsIds.has(entryId);
    const fallbackId =
      view === 'recipes' ? this.goodsDetails.get(entryId)?.productionOreDictionaryId : undefined;
    if (fallbackId) await this.entryFor(fallbackId, signal);
    const selectedGroup = this.ingredientGroups.get(entryId);
    if (!isGoods && !selectedGroup) return [];
    const catalogEntry = this.entriesById.get(entryId);
    const lazyDetail = this.goodsDetails.get(entryId);
    const machineCapabilities = catalogEntry?.machineCapabilities ?? [];
    const shardIds =
      view === 'machineUsages'
        ? [...new Set(machineCapabilities.flatMap((capability) => capability.recipeShards))]
        : selectedGroup
          ? view === 'recipes'
            ? (catalogEntry?.productionShards ?? [])
            : (catalogEntry?.usageShards ?? [])
          : view === 'recipes'
            ? ((fallbackId
                ? this.ingredientGroups.get(fallbackId)?.productionShards
                : catalogEntry?.productionShards) ?? [])
            : (catalogEntry?.usageShards ?? []);
    const selectedMembers = selectedGroup
      ? new Set(selectedGroup.itemIds)
      : new Set(
          view === 'recipes'
            ? ((fallbackId
                ? this.ingredientGroups.get(fallbackId)?.itemIds
                : lazyDetail?.productionMatchIds) ?? [entryId])
            : (lazyDetail?.usageMatchIds ?? [entryId]),
        );
    const matches = (recipe: PackedRecipe) => {
      if (view === 'machineUsages') {
        const capability = machineCapabilities.find(
          (candidate) => candidate.recipeTypeId === recipe.recipeTypeId,
        );
        return (
          capability !== undefined && machineCanProcessVoltage(capability, recipe.gt?.voltageTier)
        );
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
        const matchingIngredients = (recipe: PackedRecipe) =>
          view === 'recipes' ? recipe.outputs : recipe.inputs;
        const directMatch = (recipe: PackedRecipe) =>
          matchingIngredients(recipe).some(
            (io) =>
              io.kind !== 'oreDict' && io.kind !== 'itemGroup' && selectedMembers.has(io.goodsId),
          );
        // Only the matching side can decide whether a recipe belongs to this item.
        const groupIds = new Set(
          (view === 'machineUsages' ? [] : recipes.filter((recipe) => !directMatch(recipe)))
            .flatMap(matchingIngredients)
            .filter((io) => io.kind === 'oreDict' || io.kind === 'itemGroup')
            .map((io) => io.goodsId),
        );
        await Promise.all([...groupIds].map((groupId) => this.entryFor(groupId, signal)));
        const matched = recipes.filter(matches);
        // Hydrate presentation alternatives only for recipes actually being displayed.
        const displayedGroups = new Set(
          matched
            .flatMap((recipe) => [...recipe.inputs, ...recipe.outputs])
            .filter((io) => io.kind === 'oreDict' || io.kind === 'itemGroup')
            .map((io) => io.goodsId),
        );
        await Promise.all([...displayedGroups].map((groupId) => this.entryFor(groupId, signal)));
        const batch = await Promise.all(
          matched.map((recipe, recipeIndex) => {
            const displayed = materializeRecipe(
              recipe,
              shardIndex * 1_000_000 + recipeIndex,
              this.types,
              this.ingredientGroups,
              this.gtnhVersion,
            );
            if (
              view === 'machineUsages' &&
              isGoods &&
              displayed.crafters?.some((crafter) => crafter.id === entryId)
            )
              displayed.crafterId = entryId;
            return applyFrontendPresentation(displayed);
          }),
        );
        await yieldToBrowser();
        return batch;
      },
      ({ completed, total, value }) => {
        onProgress?.({ loadedShards: completed, totalShards: total, batch: value });
      },
      signal,
    );
    return batches.flat().sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  }
}
