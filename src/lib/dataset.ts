import { decode } from '@msgpack/msgpack';
import {
  materializeCatalog,
  restoreMaterializedCatalog,
  snapshotMaterializedCatalog,
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
  PackedGoods,
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
  getCatalogSnapshot,
  getDataset,
  hasCachedAsset,
  listDatasets,
  saveCatalogSnapshot,
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
import { preferredDatasetId } from './datasetVersions';

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

async function loadCatalog(
  manifest: DatasetManifest,
  manifestUrl: string,
  report: (percent: number, stage: string) => void
): Promise<{ catalog: PackedCatalog; hashes: string[] }> {
  if (manifest.catalogAssets.length === 0) throw new Error('Pack manifest has no catalog assets');
  if (manifest.formatVersion === 1) {
    const asset = manifest.catalogAssets[0]!;
    const bytes = await fetchVerified(asset, manifestUrl, ({ loaded, total, cached }) => {
      const ratio = total > 0 ? Math.min(1, loaded / total) : 0;
      report(12 + Math.round(ratio * 58), cached ? 'Reading verified catalog cache' : 'Downloading catalog');
    });
    report(76, 'Decompressing catalog');
    const catalog = decode(await decompress(bytes)) as PackedCatalog;
    if (catalog.datasetId !== manifest.datasetId) throw new Error('Catalog dataset identity mismatch');
    return { catalog, hashes: [asset.sha256] };
  }
  if (manifest.formatVersion !== 2 && manifest.formatVersion !== 3 && manifest.formatVersion !== 4) {
    throw new Error(`Unsupported pack manifest format ${manifest.formatVersion}`);
  }

  const loaded = new Array(manifest.catalogAssets.length).fill(0) as number[];
  const totalBytes = manifest.catalogAssets.reduce((total, asset) => total + asset.bytes, 0);
  const decoded = await mapProgressively(
    manifest.catalogAssets,
    3,
    async (asset, index) => {
      const bytes = await fetchVerified(asset, manifestUrl, ({ loaded: assetLoaded, cached }) => {
        loaded[index] = assetLoaded;
        const ratio = loaded.reduce((total, value) => total + value, 0) / Math.max(1, totalBytes);
        report(
          12 + Math.round(ratio * 50),
          cached ? 'Reading verified catalog chunks' : 'Downloading catalog chunks'
        );
      });
      const value = decode(await decompress(bytes)) as PackedCatalogCore | PackedCatalogGoods;
      if (value.schemaVersion !== manifest.formatVersion || value.datasetId !== manifest.datasetId) {
        throw new Error(`${asset.id}: catalog identity mismatch`);
      }
      return value;
    },
    ({ completed, total }) => report(
      64 + Math.round(completed / total * 22),
      `Decoding catalog chunk ${completed.toLocaleString()} of ${total.toLocaleString()}`
    )
  );
  const coreAssets = decoded.filter((asset): asset is PackedCatalogCore => asset.kind === 'core');
  const goodsAssets = decoded
    .filter((asset): asset is PackedCatalogGoods => asset.kind === 'goods')
    .sort((left, right) => left.part - right.part);
  if (coreAssets.length !== 1 || goodsAssets.length === 0) {
    throw new Error(`Format-${manifest.formatVersion} catalog requires one core and at least one goods chunk`);
  }
  goodsAssets.forEach((asset, index) => {
    if (asset.part !== index) throw new Error(`Catalog goods chunk ${asset.part} is out of order`);
  });
  const core = coreAssets[0]!;
  return {
    catalog: {
      datasetId: core.datasetId,
      goods: goodsAssets.flatMap((asset) => asset.goods),
      recipeTypes: core.recipeTypes,
      oreDictionaries: core.oreDictionaries,
      ingredientGroups: core.ingredientGroups ?? [],
      serviceItemIds: core.serviceItemIds,
      obsoleteRecipeRemaps: core.obsoleteRecipeRemaps,
      specialViewTypes: core.specialViewTypes,
      specialServiceIcons: core.specialServiceIcons
    },
    hashes: manifest.catalogAssets.map((asset) => asset.sha256)
  };
}

export class DatasetRepository {
  readonly entries: CatalogEntry[];
  readonly browseEntries: CatalogBrowseEntry[];
  readonly searchDocuments: CatalogSearchDocument[];
  readonly datasetId: string;
  readonly gtnhVersion: string;
  readonly revision: string;
  /** Format-4 NEI tabs; empty for legacy format-1--3 packs. */
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
  private readonly shards = new Map<string, Promise<PackedRecipe[]>>();
  private readonly specialShards = new Map<string, Promise<PackedSpecialRecord[]>>();

  private get assets(): DatasetAsset[] {
    return [
      ...this.manifest.catalogAssets,
      ...this.manifest.recipeShards,
      ...(this.manifest.specialDataShards ?? []),
      ...this.manifest.iconSheets
    ];
  }

  get displayName(): string {
    return this.manifest.displayName;
  }

  get offlineBytes(): number {
    return this.assets.reduce((total, asset) => total + asset.bytes, 0);
  }

  private constructor(
    manifest: DatasetManifest,
    manifestUrl: string,
    catalog: PackedCatalog,
    materialized?: MaterializedCatalog,
    browseEntries?: CatalogBrowseEntry[],
    searchDocuments?: CatalogSearchDocument[]
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
    onProgress?: (progress: DatasetLoadProgress) => void
  ): Promise<DatasetRepository> {
    const progressContext: { gtnhVersion?: string } = {};
    const report = (percent: number, stage: string) => onProgress?.({
      percent,
      stage,
      gtnhVersion: progressContext.gtnhVersion
    });
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
    if (![1, 2, 3, 4].includes(manifest.formatVersion)) {
      throw new Error(`Unsupported pack manifest format ${manifest.formatVersion}`);
    }
    if (manifest.datasetId !== selected.datasetId) throw new Error('Manifest dataset identity mismatch');
    report(12, 'Loading catalog');
    const expectedCatalogHashes = manifest.catalogAssets.map((asset) => asset.sha256);
    const cachedSnapshot = await getCatalogSnapshot(manifest.datasetId);
    const snapshotMatches = cachedSnapshot
      && cachedSnapshot.cacheVersion === 1
      && cachedSnapshot.formatVersion === manifest.formatVersion
      && cachedSnapshot.manifestUrl === manifestResult.url
      && Array.isArray(cachedSnapshot.catalogHashes)
      && cachedSnapshot.catalogHashes.length === expectedCatalogHashes.length
      && cachedSnapshot.catalogHashes.every((hash, index) => hash === expectedCatalogHashes[index])
      && cachedSnapshot.catalog !== undefined
      && cachedSnapshot.catalog.datasetId === manifest.datasetId
      && Array.isArray(cachedSnapshot.materialized?.entries)
      && Array.isArray(cachedSnapshot.materialized?.productionFallbacks)
      && Array.isArray(cachedSnapshot.browseEntries)
      && Array.isArray(cachedSnapshot.searchDocuments);
    let restoredSnapshot = false;
    let loadedCatalog: {
      catalog: PackedCatalog;
      hashes: string[];
      materialized?: MaterializedCatalog;
      browseEntries?: CatalogBrowseEntry[];
      searchDocuments?: CatalogSearchDocument[];
    };
    if (snapshotMatches) {
      try {
        report(88, 'Restoring decoded catalog cache');
        loadedCatalog = {
          catalog: cachedSnapshot.catalog,
          hashes: expectedCatalogHashes,
          materialized: restoreMaterializedCatalog(cachedSnapshot.materialized, cachedSnapshot.catalog),
          browseEntries: cachedSnapshot.browseEntries,
          searchDocuments: cachedSnapshot.searchDocuments
        };
        restoredSnapshot = true;
      } catch (error) {
        console.warn('Ignoring an incompatible decoded catalog cache', error);
        loadedCatalog = await loadCatalog(manifest, manifestResult.url, report);
      }
    } else {
      loadedCatalog = await loadCatalog(manifest, manifestResult.url, report);
    }
    report(93, 'Preparing items and ore dictionaries');
    const repository = new DatasetRepository(
      manifest,
      manifestResult.url,
      loadedCatalog.catalog,
      loadedCatalog.materialized,
      loadedCatalog.browseEntries,
      loadedCatalog.searchDocuments
    );
    if (!restoredSnapshot) {
      void saveCatalogSnapshot({
        cacheVersion: 1,
        datasetId: manifest.datasetId,
        formatVersion: manifest.formatVersion,
        manifestUrl: manifestResult.url,
        catalogHashes: expectedCatalogHashes,
        catalog: loadedCatalog.catalog,
        materialized: snapshotMaterializedCatalog({
          entries: repository.entries,
          goods: repository.packedGoods,
          recipeTypes: repository.types,
          oreDictionaries: new Map(loadedCatalog.catalog.oreDictionaries.map((ore) => [ore.id, ore])),
          ingredientGroups: repository.ingredientGroups,
          productionFallbacks: repository.productionFallbacks
        }),
        browseEntries: repository.browseEntries,
        searchDocuments: repository.searchDocuments,
        cachedAt: Date.now()
      }).catch((error) => console.warn('Unable to persist decoded catalog cache', error));
    }
    const previous = await getDataset(manifest.datasetId);
    const assetHashes = new Set(previous?.assetHashes ?? []);
    loadedCatalog.hashes.forEach((hash) => assetHashes.add(hash));
    const allAssets = repository.assets;
    const catalogHashes = new Set(manifest.catalogAssets.map((asset) => asset.sha256));
    const storedBytes = allAssets.reduce(
      (total, asset) => total + (assetHashes.has(asset.sha256) ? asset.bytes : 0),
      0
    );
    const noActiveDataset = installed.every((dataset) => !dataset.active);
    await saveDataset({
      datasetId: manifest.datasetId,
      gtnhVersion: manifest.gtnhVersion,
      revision: manifest.revision,
      displayName: manifest.displayName,
      manifestUrl: manifestResult.url,
      status: previous?.status === 'complete'
        ? 'complete'
        : allAssets.some((asset) =>
          !catalogHashes.has(asset.sha256) && assetHashes.has(asset.sha256))
          ? 'partial'
          : 'catalog',
      storedBytes,
      totalBytes: repository.offlineBytes,
      active: previous?.active ?? noActiveDataset,
      assetHashes: [...assetHashes],
      updatedAt: Date.now()
    });
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
    for (const asset of this.assets) {
      if (current?.assetHashes?.includes(asset.sha256) && await hasCachedAsset(asset.sha256, asset.bytes)) {
        completed.add(asset.sha256);
      }
    }
    const persist = async (hashes: ReadonlySet<string>, complete: boolean) => {
      const storedBytes = this.assets.reduce(
        (total, asset) => total + (hashes.has(asset.sha256) ? asset.bytes : 0),
        0
      );
      const catalogHashes = new Set(this.manifest.catalogAssets.map((asset) => asset.sha256));
      await saveDataset({
        datasetId: this.datasetId,
        gtnhVersion: this.gtnhVersion,
        revision: this.revision,
        displayName: this.displayName,
        manifestUrl: this.manifestUrl,
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
    const current = await getDataset(this.datasetId);
    if (!current || current.assetHashes?.includes(asset.sha256)) return;
    const hashes = new Set(current.assetHashes ?? []);
    hashes.add(asset.sha256);
    const storedBytes = this.assets.reduce(
      (total, candidate) => total + (hashes.has(candidate.sha256) ? candidate.bytes : 0),
      0
    );
    await saveDataset({
      ...current,
      status: hashes.size === this.assets.length ? 'complete' : 'partial',
      storedBytes,
      assetHashes: [...hashes],
      updatedAt: Date.now()
    });
  }

  private loadShard(id: string): Promise<PackedRecipe[]> {
    let pending = this.shards.get(id);
    if (pending) return pending;
    pending = (async () => {
      const descriptor = this.manifest.recipeShards.find((shard) => shard.id === id);
      if (!descriptor) throw new Error(`Unknown recipe shard ${id}`);
      const bytes = await fetchVerified(descriptor, this.manifestUrl);
      await this.recordAsset(descriptor);
      const decompressed = await decompress(bytes);
      await yieldToBrowser();
      const shard = decode(decompressed) as PackedShard;
      if (shard.datasetId !== this.datasetId) throw new Error(`${id}: dataset identity mismatch`);
      return shard.recipes;
    })();
    this.shards.set(id, pending);
    void pending.catch(() => this.shards.delete(id));
    return pending;
  }

  private loadSpecialShard(id: string): Promise<PackedSpecialRecord[]> {
    let pending = this.specialShards.get(id);
    if (pending) return pending;
    pending = (async () => {
      const descriptor = this.manifest.specialDataShards?.find((shard) => shard.id === id);
      if (!descriptor) throw new Error(`Unknown special-data shard ${id}`);
      if (this.manifest.formatVersion !== 4) {
        throw new Error(`Special-data shard ${id} requires format 4`);
      }
      const bytes = await fetchVerified(descriptor, this.manifestUrl);
      await this.recordAsset(descriptor);
      const decompressed = await decompress(bytes);
      await yieldToBrowser();
      const shard = decode(decompressed) as PackedSpecialShard;
      if (
        shard.schemaVersion !== 4
        || shard.datasetId !== this.datasetId
        || shard.kind !== 'special'
        || shard.specialViewTypeId !== descriptor.specialViewTypeId
        || shard.specialViewTypeOrder !== descriptor.specialViewTypeOrder
        || shard.part !== descriptor.part
      ) {
        throw new Error(`${id}: special-data identity mismatch`);
      }
      if (!Array.isArray(shard.records) || shard.records.length !== descriptor.recordCount) {
        throw new Error(`${id}: special-data record count mismatch`);
      }
      const serviceIconIds = new Set(this.specialServiceIcons.map((icon) => icon.id));
      let previousId: string | undefined;
      for (const record of shard.records) {
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
          throw new Error(`${id}: invalid special record`);
        }
        if (record.category !== descriptor.specialViewTypeId) {
          throw new Error(`${id}: record ${record.id} has the wrong special category`);
        }
        if (previousId !== undefined && record.id.localeCompare(previousId) < 0) {
          throw new Error(`${id}: special records are not sorted`);
        }
        previousId = record.id;
        if (!serviceIconIds.has(record.serviceIconId)) {
          throw new Error(`${id}: record ${record.id} references unknown service icon ${record.serviceIconId}`);
        }
        if (record.recipesLookupId.length === 0 || record.usagesLookupId.length === 0) {
          throw new Error(`${id}: record ${record.id} has an empty lookup ID`);
        }
        for (const goodsId of specialRecordGoodsIds(record)) {
          if (!this.packedGoods.has(goodsId) && !this.ingredientGroups.has(goodsId)) {
            throw new Error(`${id}: record ${record.id} references unknown goods ${goodsId}`);
          }
        }
      }
      return shard.records;
    })();
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
      const a = this.manifest.specialDataShards?.find((shard) => shard.id === left);
      const b = this.manifest.specialDataShards?.find((shard) => shard.id === right);
      return (a?.specialViewTypeOrder ?? 0) - (b?.specialViewTypeOrder ?? 0)
        || (a?.part ?? 0) - (b?.part ?? 0)
        || left.localeCompare(right);
    });
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
      const descriptor = this.manifest.specialDataShards?.find((shard) => shard.id === id);
      return descriptor?.specialViewTypeId === viewType;
    });
    onProgress?.({ loadedShards: 0, totalShards: shardIds.length, batch: [] });
    const batches = await mapProgressively(
      shardIds,
      2,
      async (shardId, shardIndex) => {
        const records = await this.loadSpecialShard(shardId);
        const batch = records
          .filter((record) => record.category === viewType)
          .filter((record) => {
            const goodsIds = specialRecordGoodsForDirection(record, view);
            return goodsIds.some((goodsId) => entryIds.has(goodsId));
          })
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
