import { decode } from '@msgpack/msgpack';
import { materializeCatalog } from './catalogMaterialization';
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
  PackedOreDictionary,
  PackedRecipe,
  PackedRecipeType,
  PackedShard,
  VersionsIndex
} from './datasetSchema';
import { ingredientMatchesEntry } from './oreDictionary';
import { fluidRecipeScope } from './fluidContainers';
import { installOfflineAssets } from './offline';
import { materializeRecipe } from './recipeMaterialization';
import { machineCanProcessVoltage } from './recipePresentation';
import { mapProgressively } from './progressive';
import {
  activateDataset,
  getDataset,
  hasCachedAsset,
  listDatasets,
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
  if (manifest.formatVersion !== 2) {
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
      if (value.schemaVersion !== 2 || value.datasetId !== manifest.datasetId) {
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
    throw new Error('Format-2 catalog requires one core and at least one goods chunk');
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
      serviceItemIds: core.serviceItemIds,
      obsoleteRecipeRemaps: core.obsoleteRecipeRemaps
    },
    hashes: manifest.catalogAssets.map((asset) => asset.sha256)
  };
}

export class DatasetRepository {
  readonly entries: CatalogEntry[];
  readonly browseEntries: CatalogBrowseEntry[];
  readonly datasetId: string;
  readonly gtnhVersion: string;
  readonly revision: string;
  private readonly manifest: DatasetManifest;
  private readonly manifestUrl: string;
  private readonly packedGoods: Map<string, PackedGoods>;
  private readonly types: Map<string, PackedRecipeType>;
  private readonly ores: Map<string, PackedOreDictionary>;
  private readonly productionFallbacks: Map<string, PackedOreDictionary>;
  private readonly shards = new Map<string, Promise<PackedRecipe[]>>();

  private get assets(): DatasetAsset[] {
    return [...this.manifest.catalogAssets, ...this.manifest.recipeShards, ...this.manifest.iconSheets];
  }

  get displayName(): string {
    return this.manifest.displayName;
  }

  get offlineBytes(): number {
    return this.assets.reduce((total, asset) => total + asset.bytes, 0);
  }

  private constructor(manifest: DatasetManifest, manifestUrl: string, catalog: PackedCatalog) {
    this.manifest = manifest;
    this.manifestUrl = manifestUrl;
    this.datasetId = manifest.datasetId;
    this.gtnhVersion = manifest.gtnhVersion;
    this.revision = manifest.revision;
    const materialized = materializeCatalog(manifest, manifestUrl, catalog);
    this.entries = materialized.entries;
    this.browseEntries = buildCatalogBrowseEntries(materialized.entries);
    this.packedGoods = materialized.goods;
    this.types = materialized.recipeTypes;
    this.ores = materialized.oreDictionaries;
    this.productionFallbacks = materialized.productionFallbacks;
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
    const active = installed.find((dataset) => dataset.active);
    const selectedId = datasetId ?? active?.datasetId ?? versions.versions[0]?.datasetId;
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
    if (manifest.formatVersion !== 1 && manifest.formatVersion !== 2) {
      throw new Error(`Unsupported pack manifest format ${manifest.formatVersion}`);
    }
    if (manifest.datasetId !== selected.datasetId) throw new Error('Manifest dataset identity mismatch');
    report(12, 'Loading catalog');
    const loadedCatalog = await loadCatalog(manifest, manifestResult.url, report);
    report(93, 'Preparing items and ore dictionaries');
    const repository = new DatasetRepository(manifest, manifestResult.url, loadedCatalog.catalog);
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

  async recipesFor(
    entryId: string,
    view: RecipeView,
    onProgress?: (progress: RecipeLoadProgress) => void,
    signal?: AbortSignal
  ): Promise<Recipe[]> {
    const goods = this.packedGoods.get(entryId);
    const selectedOre = this.ores.get(entryId);
    if (!goods && !selectedOre) return [];
    const catalogEntry = this.entries.find((entry) => entry.id === entryId);
    const productionFallback = this.productionFallbacks.get(entryId);
    const fluidScope = fluidRecipeScope(entryId, this.packedGoods);
    const machineCapabilities = catalogEntry?.machineCapabilities ?? [];
    const shardIds = view === 'machineUsages'
      ? [...new Set(machineCapabilities.flatMap((capability) => capability.recipeShards))]
      : selectedOre
      ? view === 'recipes'
        ? catalogEntry?.productionShards ?? []
        : catalogEntry?.usageShards ?? []
      : view === 'recipes'
        ? catalogEntry?.productionShards ?? []
        : goods!.usageShards;
    const selectedMembers = selectedOre
      ? new Set(selectedOre.itemIds)
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
        return ingredientMatchesEntry(io, entryId, selectedMembers, this.ores);
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
            this.ores
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
