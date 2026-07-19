import { decode } from '@msgpack/msgpack';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  ingredientMatchesEntry,
  materializeIngredient,
  productionFallbackDictionary
} from './oreDictionary';
import { fluidRecipeScope } from './fluidContainers';
import { parseMinecraftHtml } from './minecraftText';
import {
  formatCircuitConflicts,
  formatGtMetadata,
  hasRelevantPower,
  voltageTierName
} from './recipeMetadata';
import { recipeCrafterId, recipeTypeIconId } from './recipePresentation';
import { mapProgressively } from './progressive';
import {
  cacheAsset,
  cacheMetadata,
  getCachedAsset,
  getCachedMetadata,
  removeCachedAsset
} from './storage';
import type { CatalogEntry, Recipe, RecipeLayout } from './types';

interface VersionRecord {
  datasetId: string;
  gtnhVersion: string;
  revision: string;
  packManifestUrl: string;
}

interface VersionsIndex {
  schemaVersion: number;
  versions: VersionRecord[];
}

interface Asset {
  id: string;
  url: string;
  bytes: number;
  sha256: string;
  encoding: 'gzip' | 'identity';
}

interface RecipeShardAsset extends Asset {
  recipeTypeId: string;
}

interface IconSheetAsset extends Asset {
  columns: number;
}

interface Manifest {
  datasetId: string;
  gtnhVersion: string;
  revision: string;
  catalogAssets: Asset[];
  recipeShards: RecipeShardAsset[];
  iconSheets: IconSheetAsset[];
}

interface PackedGoods {
  id: string;
  name: string;
  mod: string;
  kind: 'item' | 'fluid';
  tooltip: string | null;
  internalName: string;
  unlocalizedName: string;
  nbt: string | null;
  searchable: boolean;
  icon: { sheetId: string; index: number } | null;
  productionShards: string[];
  usageShards: string[];
  productionCount: number;
  usageCount: number;
  container?: {
    fluidId: string;
    amount: number;
    emptyItemId: string | null;
  } | null;
  containerItemIds?: string[];
}

interface PackedRecipeType {
  id: string;
  name: string;
  order: number;
  shapeless: boolean;
  dimensions: RecipeLayout;
  defaultCrafter: { id: string } | null;
  singleblocks: Array<{ id: string }>;
  multiblocks: Array<{ id: string }>;
}

interface PackedOreDictionary {
  id: string;
  itemIds: string[];
}

interface PackedCatalog {
  datasetId: string;
  goods: PackedGoods[];
  recipeTypes: PackedRecipeType[];
  oreDictionaries: PackedOreDictionary[];
}

interface PackedIo {
  kind: 'item' | 'fluid' | 'oreDict';
  goodsId: string;
  slot: number;
  amount: number;
  probability: number;
}

interface PackedRecipe {
  id: string;
  recipeTypeId: string;
  inputs: PackedIo[];
  outputs: PackedIo[];
  gt: {
    voltage: number;
    durationTicks: number;
    amperage: number;
    voltageTier: number;
    metadata: Array<{ key: string; value: number }>;
    circuitConflicts: number;
    specialValue: number;
  } | null;
}

interface PackedShard {
  datasetId: string;
  recipes: PackedRecipe[];
}

export interface DatasetLoadProgress {
  percent: number;
  stage: string;
}

export interface RecipeLoadProgress {
  loadedShards: number;
  totalShards: number;
  batch: Recipe[];
}

interface AssetLoadProgress {
  loaded: number;
  total: number;
  cached: boolean;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return bytesToHex(nobleSha256(bytes));
}

async function fetchVerified(
  asset: Asset,
  manifestUrl: string,
  onProgress?: (progress: AssetLoadProgress) => void
): Promise<Uint8Array> {
  const cached = await getCachedAsset(asset.sha256);
  if (cached) {
    onProgress?.({ loaded: cached.byteLength, total: asset.bytes, cached: true });
    if (cached.byteLength === asset.bytes && await sha256(cached) === asset.sha256) return cached;
    await removeCachedAsset(asset.sha256);
  }

  const response = await fetch(new URL(asset.url, manifestUrl));
  if (!response.ok) throw new Error(`Unable to download ${asset.id}: HTTP ${response.status}`);
  let bytes: Uint8Array;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      loaded += result.value.byteLength;
      onProgress?.({ loaded, total: asset.bytes, cached: false });
    }
    bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ loaded: bytes.byteLength, total: asset.bytes, cached: false });
  }
  if (bytes.byteLength !== asset.bytes) throw new Error(`${asset.id}: size mismatch`);
  if (await sha256(bytes) !== asset.sha256) throw new Error(`${asset.id}: integrity check failed`);
  await cacheAsset(asset.sha256, bytes);
  return bytes;
}

async function fetchJsonNetworkFirst<T>(url: string, cacheKey: string): Promise<{ url: string; value: T }> {
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.json() as T;
    await cacheMetadata(cacheKey, response.url, value);
    return { url: response.url, value };
  } catch (networkError) {
    const cached = await getCachedMetadata<T>(cacheKey);
    if (cached) return cached;
    throw networkError;
  }
}

async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([Uint8Array.from(bytes).buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function yieldToBrowser(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function duration(ticks: number): string {
  const seconds = ticks / 20;
  if (seconds < 60) return `${Number(seconds.toFixed(2))} s`;
  return `${Number((seconds / 60).toFixed(2))} m`;
}

function amount(value: number): string {
  if (value >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(2))}B EU`;
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M EU`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(2))}k EU`;
  return `${value} EU`;
}

function power(value: number): string {
  return amount(value).replace(/ EU$/, ' EU/t');
}

export class DatasetRepository {
  readonly entries: CatalogEntry[];
  readonly datasetId: string;
  readonly gtnhVersion: string;
  readonly revision: string;
  private readonly manifest: Manifest;
  private readonly manifestUrl: string;
  private readonly packedGoods = new Map<string, PackedGoods>();
  private readonly types = new Map<string, PackedRecipeType>();
  private readonly ores = new Map<string, PackedOreDictionary>();
  private readonly itemOres = new Map<string, PackedOreDictionary[]>();
  private readonly productionFallbacks = new Map<string, PackedOreDictionary>();
  private readonly shards = new Map<string, Promise<PackedRecipe[]>>();

  private constructor(manifest: Manifest, manifestUrl: string, catalog: PackedCatalog) {
    this.manifest = manifest;
    this.manifestUrl = manifestUrl;
    this.datasetId = manifest.datasetId;
    this.gtnhVersion = manifest.gtnhVersion;
    this.revision = manifest.revision;
    const sheets = new Map(manifest.iconSheets.map((sheet) => [sheet.id, sheet]));
    for (const goods of catalog.goods) this.packedGoods.set(goods.id, goods);
    for (const type of catalog.recipeTypes) this.types.set(type.id, type);
    for (const ore of catalog.oreDictionaries) {
      this.ores.set(ore.id, ore);
      for (const itemId of ore.itemIds) {
        const memberships = this.itemOres.get(itemId) ?? [];
        memberships.push(ore);
        this.itemOres.set(itemId, memberships);
      }
    }
    for (const goods of catalog.goods) {
      if (goods.kind !== 'item' || goods.productionCount !== 0) continue;
      const fallback = productionFallbackDictionary(
        goods.id,
        this.itemOres.get(goods.id) ?? [],
        (itemId) => (this.packedGoods.get(itemId)?.productionCount ?? 0) > 0
      );
      if (fallback) this.productionFallbacks.set(goods.id, fallback);
    }
    const goodsEntries = catalog.goods.map((goods): CatalogEntry => {
      const sheet = goods.icon ? sheets.get(goods.icon.sheetId) : undefined;
      const formattedName = parseMinecraftHtml(goods.name);
      const parsedTooltip = parseMinecraftHtml(goods.tooltip);
      const formattedTooltip = goods.tooltip ? parsedTooltip.lines : [];
      const tooltip = formattedTooltip
        .map((line) => line.segments.map((segment) => segment.text).join('').trim())
        .filter(Boolean);
      const productionFallback = this.productionFallbacks.get(goods.id);
      const fluidScope = fluidRecipeScope(goods.id, this.packedGoods);
      const recipeScopeIds = fluidScope?.memberIds ?? productionFallback?.itemIds;
      const productionShards = recipeScopeIds
        ? [...new Set([...recipeScopeIds].flatMap((itemId) =>
            this.packedGoods.get(itemId)?.productionShards ?? []))].sort()
        : goods.productionShards;
      const usageShards = fluidScope
        ? [...new Set([...fluidScope.memberIds].flatMap((itemId) =>
            this.packedGoods.get(itemId)?.usageShards ?? []))].sort()
        : goods.usageShards;
      return {
        id: goods.id,
        name: formattedName.plainText.trim(),
        mod: goods.mod,
        kind: goods.kind,
        tooltip,
        formattedName: formattedName.lines,
        formattedTooltip,
        color: '#aeb3b8',
        glyph: goods.kind === 'fluid' ? '≈' : '□',
        recipeTypes: [],
        searchable: goods.searchable,
        icon: goods.icon && sheet ? {
          url: new URL(sheet.url, manifestUrl).href,
          index: goods.icon.index,
          columns: sheet.columns
        } : undefined,
        productionShards,
        usageShards,
        productionCount: recipeScopeIds ? undefined : goods.productionCount,
        usageCount: fluidScope ? undefined : goods.usageCount,
        productionOreDictionaryId: fluidScope ? undefined : productionFallback?.id,
        container: goods.container,
        containerItemIds: goods.containerItemIds
      };
    });
    const goodsEntriesById = new Map(goodsEntries.map((entry) => [entry.id, entry]));
    const oreEntries = catalog.oreDictionaries.map((ore): CatalogEntry => {
      const members = ore.itemIds.map((id) => goodsEntriesById.get(id)).filter((entry) => entry !== undefined);
      const representative = members[0];
      const productionShards = new Set<string>();
      const usageShards = new Set<string>();
      for (const memberId of ore.itemIds) {
        const member = this.packedGoods.get(memberId);
        member?.productionShards.forEach((id) => productionShards.add(id));
        member?.usageShards.forEach((id) => usageShards.add(id));
      }
      const dictionaryName = ore.id.startsWith('o:') ? ore.id.slice(2) : ore.id;
      return {
        id: ore.id,
        name: `Ore dictionary: ${dictionaryName}`,
        mod: 'Ore Dictionary',
        kind: 'oreDict',
        tooltip: [
          `${ore.itemIds.length.toLocaleString('en-US')} interchangeable item${ore.itemIds.length === 1 ? '' : 's'}`,
          'All listed members are valid recipe ingredients.'
        ],
        color: '#aeb3b8',
        glyph: '◇',
        recipeTypes: [],
        searchable: false,
        icon: representative?.icon,
        productionShards: [...productionShards].sort(),
        usageShards: [...usageShards].sort(),
        members: ore.itemIds
      };
    });
    this.entries = [...goodsEntries, ...oreEntries];
  }

  static async loadLatest(onProgress?: (progress: DatasetLoadProgress) => void): Promise<DatasetRepository> {
    const report = (percent: number, stage: string) => onProgress?.({ percent, stage });
    const versionsUrl = new URL('./versions.json', document.baseURI).href;
    report(3, 'Checking available GTNH versions');
    const versionsResult = await fetchJsonNetworkFirst<VersionsIndex>(versionsUrl, `versions:${versionsUrl}`);
    const versions = versionsResult.value;
    const selected = versions.versions[0];
    if (!selected) throw new Error('No published GTNH datasets are available');
    const manifestUrl = new URL(selected.packManifestUrl, versionsResult.url).href;
    report(8, 'Loading dataset manifest');
    const manifest = (await fetchJsonNetworkFirst<Manifest>(
      manifestUrl,
      `manifest:${manifestUrl}`
    )).value;
    const catalogAsset = manifest.catalogAssets[0];
    if (!catalogAsset) throw new Error('Pack manifest has no catalog asset');
    report(12, 'Loading catalog');
    const catalogBytes = await fetchVerified(catalogAsset, manifestUrl, ({ loaded, total, cached }) => {
      const ratio = total > 0 ? Math.min(1, loaded / total) : 0;
      report(12 + Math.round(ratio * 58), cached ? 'Reading verified catalog cache' : 'Downloading catalog');
    });
    report(76, 'Decompressing catalog');
    const decompressed = await decompress(catalogBytes);
    report(86, 'Decoding catalog');
    const catalog = decode(decompressed) as PackedCatalog;
    if (catalog.datasetId !== manifest.datasetId) throw new Error('Catalog dataset identity mismatch');
    report(93, 'Preparing items and ore dictionaries');
    const repository = new DatasetRepository(manifest, manifestUrl, catalog);
    report(100, 'Catalog ready');
    return repository;
  }

  private loadShard(id: string): Promise<PackedRecipe[]> {
    let pending = this.shards.get(id);
    if (pending) return pending;
    pending = (async () => {
      const descriptor = this.manifest.recipeShards.find((shard) => shard.id === id);
      if (!descriptor) throw new Error(`Unknown recipe shard ${id}`);
      const decompressed = await decompress(await fetchVerified(descriptor, this.manifestUrl));
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
    view: 'recipes' | 'usages',
    onProgress?: (progress: RecipeLoadProgress) => void,
    signal?: AbortSignal
  ): Promise<Recipe[]> {
    const goods = this.packedGoods.get(entryId);
    const selectedOre = this.ores.get(entryId);
    if (!goods && !selectedOre) return [];
    const catalogEntry = this.entries.find((entry) => entry.id === entryId);
    const productionFallback = this.productionFallbacks.get(entryId);
    const fluidScope = fluidRecipeScope(entryId, this.packedGoods);
    const shardIds = selectedOre
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
    const matches = (recipe: PackedRecipe) =>
      (view === 'recipes' ? recipe.outputs : recipe.inputs).some((io) => {
        if (fluidScope) return fluidScope.memberIds.has(io.goodsId);
        return ingredientMatchesEntry(io, entryId, selectedMembers, this.ores);
      });
    const convertRecipe = (recipe: PackedRecipe, order: number): Recipe => {
      const type = this.types.get(recipe.recipeTypeId);
      if (!type) throw new Error(`Unknown recipe type ${recipe.recipeTypeId}`);
      const convert = (io: PackedIo) => materializeIngredient(io, this.ores);
      const gt = recipe.gt;
      const powerInfo = hasRelevantPower(gt) ? gt : null;
      const totalEu = powerInfo ? powerInfo.voltage * powerInfo.amperage * powerInfo.durationTicks : undefined;
      const euPerTick = powerInfo ? powerInfo.voltage * powerInfo.amperage : undefined;
      return {
        id: recipe.id,
        type: type.name,
        inputs: recipe.inputs.map(convert),
        outputs: recipe.outputs.map(convert),
        layout: { ...type.dimensions, shapeless: type.shapeless },
        duration: powerInfo ? duration(powerInfo.durationTicks) : undefined,
        voltage: powerInfo ? voltageTierName(powerInfo.voltageTier) : undefined,
        voltageExact: powerInfo ? `${powerInfo.voltage.toLocaleString('en-US')} V` : undefined,
        amperage: powerInfo && powerInfo.amperage !== 1 ? `${powerInfo.amperage} A` : undefined,
        eu: totalEu === undefined ? undefined : amount(totalEu),
        euExact: totalEu === undefined ? undefined : `${totalEu.toLocaleString('en-US')} EU`,
        euPerTick: euPerTick === undefined ? undefined : power(euPerTick),
        euPerTickExact: euPerTick === undefined ? undefined : `${euPerTick.toLocaleString('en-US')} EU/t`,
        metadata: gt?.metadata
          .map((metadata) => formatGtMetadata(metadata, {
            recipeType: type.name,
            voltageTier: gt.voltageTier
          }))
          .filter((line): line is string => line !== null),
        crafterId: recipeCrafterId(type, gt?.voltageTier),
        typeIconId: recipeTypeIconId(type),
        circuitConflicts: gt && gt.circuitConflicts !== 0
          ? formatCircuitConflicts(gt.circuitConflicts)
          : undefined,
        specialValue: gt?.specialValue,
        order
      };
    };
    onProgress?.({ loadedShards: 0, totalShards: shardIds.length, batch: [] });
    const batches = await mapProgressively(
      shardIds,
      2,
      async (shardId, shardIndex) => {
        const recipes = await this.loadShard(shardId);
        const batch = recipes
          .filter(matches)
          .map((recipe, recipeIndex) => convertRecipe(recipe, shardIndex * 1_000_000 + recipeIndex));
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
