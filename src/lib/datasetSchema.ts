import type { DatasetVersion, RecipeLayout } from './types';
import type { RecordPageSelection } from './recordPages';
import type { PackedRelationList } from './packedRelations';
import type { MinecraftFormattingSpan } from './minecraftText';

export interface VersionsIndex {
  schemaVersion: number;
  versions: DatasetVersion[];
  rollout?: { epoch: number; targetDatasetId: string };
}

export interface DatasetAsset {
  segments?: RecordPageSelection[] | string;
  oversizedSingleton?: boolean;
  id: string;
  url: string;
  bytes: number;
  sha256: string;
  encoding: 'gzip' | 'identity';
  family?: 'bootstrap' | 'goods-details' | 'ingredient-groups' | 'recipes' | 'special';
}

interface CatalogAsset extends DatasetAsset {
  role: 'core' | 'goods' | 'goodsSearch' | 'recipeTypes' | 'recipeRemaps' | 'specialMetadata';
  part: number;
  goodsCount: number;
  recordCount?: number;
  prefix?: string;
  logicalId: string;
  oversizedSingleton?: boolean;
}

interface GoodsDetailShardAsset extends DatasetAsset {
  kind: 'goodsDetails';
  part: number;
  recordCount: number;
  prefix: string;
  logicalId: string;
}

interface IngredientGroupShardAsset extends DatasetAsset {
  kind: 'ingredientGroups';
  part: number;
  recordCount: number;
  prefix: string;
  logicalId: string;
}

interface RecipeShardAsset extends DatasetAsset {
  recipeTypeId: string;
  recipeTypeOrder: number;
  part: number;
  recipeCount: number;
  prefix: string;
  logicalId: string;
  oversizedSingleton?: boolean;
}

interface IconSheetAsset extends DatasetAsset {
  columns: number;
}

interface SpecialDataShardAsset extends DatasetAsset {
  kind: 'specialData';
  specialViewTypeId: string;
  specialViewTypeOrder: number;
  part: number;
  recordCount: number;
  prefix: string;
  logicalId: string;
  oversizedSingleton?: boolean;
}

export interface DatasetManifest {
  formatVersion: 7;
  datasetId: string;
  gtnhVersion: string;
  revision: string;
  displayName: string;
  catalogAssets: CatalogAsset[];
  goodsDetailShards: GoodsDetailShardAsset[];
  ingredientGroupShards: IngredientGroupShardAsset[];
  recipeShards: RecipeShardAsset[];
  iconSheets: IconSheetAsset[];
  specialDataShards: SpecialDataShardAsset[];
  recordPages: DatasetAsset[];
  assetStore: 'global-sha256';
  sharedLayout: {
    schemaVersion: 1;
    layoutSha256: string;
    targets: {
      recipes: number;
      goods: number;
      goodsMetadata: number;
      special: number;
      oreDictionaries: number;
    };
    prefixes: {
      recipeTypes: Record<string, string[]>;
      goods: string[];
      oreDictionaries: string[];
      specialViews: Record<string, string[]>;
    };
  };
  totals: {
    assets: number;
    offlineBytes: number;
    specialRecords: number;
  };
}

export interface PackedGoods {
  id: string;
  name: string;
  mod: string;
  kind: 'item' | 'fluid';
  tooltip: string | null;
  internalName: string;
  unlocalizedName: string;
  nbt: string | null;
  variantNbtKey?: string;
  tooltipId?: string | null;
  /** Stored in a separate metadata record family rather than intrinsic goods identity. */
  numericId?: number;
  damage?: number;
  searchMask: number[];
  searchable: boolean;
  icon: { sheetId: string; index: number } | null;
  productionShards: string[];
  usageShards: string[];
  productionCount: number;
  usageCount: number;
  specialProductionShards?: string[];
  specialUsageShards?: string[];
  specialProductionLookupIds?: string[];
  specialUsageLookupIds?: string[];
  specialProductionCount?: number;
  specialUsageCount?: number;
  container?: {
    fluidId: string;
    amount: number;
    emptyItemId: string | null;
  } | null;
  containerItemIds?: string[];
}

/** Lazy relations and precomputed matching scope for one exact goods record. */
export interface PackedGoodsDetail {
  id: string;
  nbt?: string | null;
  tooltip?: string | null;
  tooltipFormats?: MinecraftFormattingSpan[];
  numericId?: number;
  unlocalizedName?: string;
  productionShards: string[];
  usageShards: string[];
  productionCount: number;
  usageCount: number;
  specialProductionShards: string[];
  specialUsageShards: string[];
  specialProductionLookupIds?: string[];
  specialUsageLookupIds?: string[];
  specialProductionCounts?: Record<string, number>;
  specialUsageCounts?: Record<string, number>;
  specialProductionCount: number;
  specialUsageCount: number;
  productionMatchIds: string[];
  usageMatchIds: string[];
  specialProductionMatchIds: string[];
  specialUsageMatchIds: string[];
  productionOreDictionaryId?: string;
  oreDictionaryIds: string[];
  container?: PackedGoods['container'];
  containerItemIds?: string[];
  machineCapabilities?: import('./types').MachineRecipeCapability[];
}

export interface PackedGoodsDetailsShard {
  schemaVersion: 6;
  kind: 'goodsDetails';
  logicalId: string;
  prefix: string;
  goods: PackedGoodsDetail[];
  goodsMetadata?: Array<{ id: string; numericId?: number }>;
  goodsTooltips?: Array<{ id: string; formats: MinecraftFormattingSpan[] }>;
  lists?: PackedRelationList[];
}

export interface PackedIngredientGroupsShard {
  schemaVersion: 6;
  kind: 'ingredientGroups';
  logicalId: string;
  prefix: string;
  ingredientGroups: Array<PackedOreDictionary | PackedIngredientGroup>;
  lists?: PackedRelationList[];
}

export interface PackedRecipeType {
  id: string;
  name: string;
  order: number;
  shapeless: boolean;
  dimensions: RecipeLayout;
  defaultCrafter: { id: string } | null;
  singleblocks: Array<{ id: string }>;
  multiblocks: Array<{ id: string }>;
}

export interface PackedOreDictionary {
  id: string;
  itemIds: string[];
  kind?: 'oreDict';
  specialProductionShards?: string[];
  specialUsageShards?: string[];
  specialProductionLookupIds?: string[];
  specialUsageLookupIds?: string[];
  specialProductionCounts?: Record<string, number>;
  specialUsageCounts?: Record<string, number>;
  specialProductionCount?: number;
  specialUsageCount?: number;
  productionShards?: string[];
  usageShards?: string[];
  productionCount?: number;
  usageCount?: number;
  productionMatchIds?: string[];
  usageMatchIds?: string[];
  specialProductionMatchIds?: string[];
  specialUsageMatchIds?: string[];
  machineCapabilities?: import('./types').MachineRecipeCapability[];
}

export interface PackedIngredientGroup extends Omit<PackedOreDictionary, 'kind'> {
  kind: 'itemGroup';
}

export interface PackedCatalog {
  datasetId: string;
  goods: PackedGoods[];
  recipeTypes: PackedRecipeType[];
  oreDictionaries: PackedOreDictionary[];
  ingredientGroups?: PackedIngredientGroup[];
  serviceItemIds?: string[];
  obsoleteRecipeRemaps?: Record<string, string>;
  specialViewTypes?: Array<{
    id: string;
    label: string;
    serviceIconId: string;
    recordCount?: number;
  }>;
  specialServiceIcons?: Array<{
    id: string;
    label: string;
    goodsId?: string;
    searchable: false;
    icon: { sheetId: string; index: number } | null;
  }>;
}

export interface PackedCatalogCore extends Omit<PackedCatalog, 'goods' | 'datasetId'> {
  schemaVersion: 6;
  kind: 'core';
  logicalId: string;
}

export interface PackedCatalogGoods {
  schemaVersion: 6;
  kind: 'goods';
  logicalId: string;
  prefix: string;
  goods: Array<Partial<PackedGoods> & Pick<PackedGoods,
    'id' | 'name' | 'nbt' | 'searchable' | 'icon'>>;
}

export interface PackedCatalogGoodsSearch {
  schemaVersion: 6;
  kind: 'goodsSearch';
  logicalId: string;
  prefix: string;
  tooltips: Array<{ id: string; text: string }>;
}

export interface PackedCatalogRecipeTypes {
  schemaVersion: 6;
  kind: 'recipeTypes';
  logicalId: string;
  recipeTypes: PackedRecipeType[];
}

export interface PackedCatalogRecipeRemaps {
  schemaVersion: 6;
  kind: 'recipeRemaps';
  logicalId: string;
  obsoleteRecipeRemaps: Record<string, string>;
}

export interface PackedCatalogSpecialMetadata {
  schemaVersion: 6;
  kind: 'specialMetadata';
  logicalId: string;
  specialViewTypes: NonNullable<PackedCatalog['specialViewTypes']>;
  specialServiceIcons: NonNullable<PackedCatalog['specialServiceIcons']>;
}

interface PackedIo {
  kind: 'item' | 'fluid' | 'oreDict' | 'itemGroup';
  goodsId: string;
  slot: number;
  amount: number;
  probability: number;
}

export interface PackedRecipe {
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

export interface PackedShard {
  schemaVersion: 5;
  kind: 'recipeShard';
  logicalId: string;
  recipeTypeId: string;
  prefix: string;
  recipes: PackedRecipe[];
}

export interface PackedSpecialRecord {
  id: string;
  category: string;
  title: string;
  searchText: string;
  goodsIds: string[];
  recipesLookupId: string;
  usagesLookupId: string;
  serviceIconId: string;
  payload: Record<string, unknown>;
  productionGoodsIds?: string[];
  usageGoodsIds?: string[];
  [key: string]: unknown;
}

export interface PackedSpecialShard {
  schemaVersion: 5;
  kind: 'special';
  specialViewTypeId: string;
  logicalId: string;
  prefix: string;
  records: PackedSpecialRecord[];
}
