import { decode } from '@msgpack/msgpack';
import type { CatalogEntry, Ingredient, Recipe, RecipeLayout } from './types';

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
  } | null;
}

interface PackedShard {
  datasetId: string;
  recipes: PackedRecipe[];
}

const voltageTiers = ['ULV','LV','MV','HV','EV','IV','LuV','ZPM','UV','UHV','UEV','UIV','UMV','UXV','MAX'];

function plainText(html: string | null): string {
  if (!html) return '';
  const document = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n'), 'text/html');
  return document.body.textContent?.trim() ?? '';
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchVerified(asset: Asset, manifestUrl: string): Promise<Uint8Array> {
  const response = await fetch(new URL(asset.url, manifestUrl));
  if (!response.ok) throw new Error(`Unable to download ${asset.id}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== asset.bytes) throw new Error(`${asset.id}: size mismatch`);
  if (await sha256(bytes) !== asset.sha256) throw new Error(`${asset.id}: integrity check failed`);
  return bytes;
}

async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([Uint8Array.from(bytes).buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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
    for (const ore of catalog.oreDictionaries) this.ores.set(ore.id, ore);
    this.entries = catalog.goods.map((goods) => {
      const sheet = goods.icon ? sheets.get(goods.icon.sheetId) : undefined;
      const tooltip = plainText(goods.tooltip).split(/\n+/).map((line) => line.trim()).filter(Boolean);
      return {
        id: goods.id,
        name: plainText(goods.name),
        mod: goods.mod,
        kind: goods.kind,
        tooltip: tooltip.length ? tooltip : [goods.unlocalizedName],
        color: '#aeb3b8',
        glyph: goods.kind === 'fluid' ? '≈' : '□',
        recipeTypes: [],
        searchable: goods.searchable,
        icon: goods.icon && sheet ? {
          url: new URL(sheet.url, manifestUrl).href,
          index: goods.icon.index,
          columns: sheet.columns
        } : undefined,
        productionShards: goods.productionShards,
        usageShards: goods.usageShards,
        productionCount: goods.productionCount,
        usageCount: goods.usageCount
      };
    });
  }

  static async loadLatest(): Promise<DatasetRepository> {
    const versionsResponse = await fetch(new URL('./versions.json', document.baseURI), { cache: 'no-cache' });
    if (!versionsResponse.ok) throw new Error(`Unable to load versions: HTTP ${versionsResponse.status}`);
    const versions = await versionsResponse.json() as VersionsIndex;
    const selected = versions.versions[0];
    if (!selected) throw new Error('No published GTNH datasets are available');
    const manifestUrl = new URL(selected.packManifestUrl, versionsResponse.url).href;
    const manifestResponse = await fetch(manifestUrl);
    if (!manifestResponse.ok) throw new Error(`Unable to load pack manifest: HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.json() as Manifest;
    const catalogAsset = manifest.catalogAssets[0];
    if (!catalogAsset) throw new Error('Pack manifest has no catalog asset');
    const catalog = decode(await decompress(await fetchVerified(catalogAsset, manifestUrl))) as PackedCatalog;
    if (catalog.datasetId !== manifest.datasetId) throw new Error('Catalog dataset identity mismatch');
    return new DatasetRepository(manifest, manifestUrl, catalog);
  }

  private loadShard(id: string): Promise<PackedRecipe[]> {
    let pending = this.shards.get(id);
    if (pending) return pending;
    pending = (async () => {
      const descriptor = this.manifest.recipeShards.find((shard) => shard.id === id);
      if (!descriptor) throw new Error(`Unknown recipe shard ${id}`);
      const shard = decode(await decompress(await fetchVerified(descriptor, this.manifestUrl))) as PackedShard;
      if (shard.datasetId !== this.datasetId) throw new Error(`${id}: dataset identity mismatch`);
      return shard.recipes;
    })();
    this.shards.set(id, pending);
    return pending;
  }

  async recipesFor(entryId: string, view: 'recipes' | 'usages'): Promise<Recipe[]> {
    const goods = this.packedGoods.get(entryId);
    if (!goods) return [];
    const shardIds = view === 'recipes' ? goods.productionShards : goods.usageShards;
    const packed = (await Promise.all(shardIds.map((id) => this.loadShard(id)))).flat()
      .filter((recipe) => (view === 'recipes' ? recipe.outputs : recipe.inputs).some((io) => {
        if (io.goodsId === entryId) return true;
        return io.kind === 'oreDict' && this.ores.get(io.goodsId)?.itemIds.includes(entryId);
      }));
    return packed.map((recipe) => {
      const type = this.types.get(recipe.recipeTypeId);
      if (!type) throw new Error(`Unknown recipe type ${recipe.recipeTypeId}`);
      const convert = (io: PackedIo): Ingredient => ({
        id: io.kind === 'oreDict' ? this.ores.get(io.goodsId)?.itemIds[0] ?? io.goodsId : io.goodsId,
        amount: io.amount,
        chance: io.probability,
        slot: io.slot,
        kind: io.kind
      });
      return {
        id: recipe.id,
        type: type.name,
        inputs: recipe.inputs.map(convert),
        outputs: recipe.outputs.map(convert),
        layout: { ...type.dimensions, shapeless: type.shapeless },
        duration: recipe.gt ? duration(recipe.gt.durationTicks) : undefined,
        voltage: recipe.gt ? voltageTiers[recipe.gt.voltageTier] ?? `T${recipe.gt.voltageTier}` : undefined,
        eu: recipe.gt ? amount(recipe.gt.voltage * recipe.gt.amperage * recipe.gt.durationTicks) : undefined,
        crafterId: type.defaultCrafter?.id ?? type.singleblocks[0]?.id ?? type.multiblocks[0]?.id
      };
    });
  }
}
