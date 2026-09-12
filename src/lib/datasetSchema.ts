import type { DatasetVersion, RecipeLayout } from './types';
import type { RecordPageSelection } from './recordPages';

export interface VersionsIndex {
  schemaVersion: number;
  versions: DatasetVersion[];
}

export interface DatasetAsset {
  segments?: RecordPageSelection[];
  oversizedSingleton?: boolean;
  id: string;
  url: string;
  bytes: number;
  sha256: string;
  encoding: 'gzip' | 'identity';
}

interface CatalogAsset extends DatasetAsset {
  role: 'core' | 'goods' | 'goodsMetadata' | 'recipeTypes' | 'oreDictionaries'
    | 'ingredientGroups' | 'recipeRemaps' | 'specialMetadata' | 'icons';
  part: number;
  goodsCount: number;
  recordCount?: number;
  prefix?: string;
  logicalId: string;
  oversizedSingleton?: boolean;
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
  formatVersion: 6;
  datasetId: string;
  gtnhVersion: string;
  revision: string;
  displayName: string;
  catalogAssets: CatalogAsset[];
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
  specialProductionCount?: number;
  specialUsageCount?: number;
}

export interface PackedIngredientGroup {
  id: string;
  itemIds: string[];
  kind: 'itemGroup';
  specialProductionShards?: string[];
  specialUsageShards?: string[];
  specialProductionLookupIds?: string[];
  specialUsageLookupIds?: string[];
  specialProductionCount?: number;
  specialUsageCount?: number;
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
  schemaVersion: 5;
  kind: 'core';
  logicalId: string;
}

export interface PackedCatalogIcons {
  schemaVersion: 5;
  kind: 'icons';
  logicalId: string;
  icons: Array<{ id: string; icon: PackedGoods['icon'] }>;
}

export interface PackedCatalogGoods {
  schemaVersion: 5;
  kind: 'goods';
  logicalId: string;
  prefix: string;
  goods: Array<Omit<PackedGoods, 'icon'>>;
}

export interface PackedCatalogGoodsMetadata {
  schemaVersion: 5;
  kind: 'goodsMetadata';
  logicalId: string;
  prefix: string;
  goods: PackedGoodsMetadata[];
}

/** Fields that complete an intrinsic goods record at runtime. */
export interface PackedGoodsMetadata {
  id: string;
  name: string;
  tooltip: string | null;
  unlocalizedName: string;
  searchMask: number[];
  searchable: boolean;
  numericId: number;
  productionShards: string[];
  usageShards: string[];
  productionCount: number;
  usageCount: number;
  specialProductionShards: string[];
  specialUsageShards: string[];
  specialProductionLookupIds: string[];
  specialUsageLookupIds: string[];
  specialProductionCount: number;
  specialUsageCount: number;
}

export interface PackedCatalogRecipeTypes {
  schemaVersion: 5;
  kind: 'recipeTypes';
  logicalId: string;
  recipeTypes: PackedRecipeType[];
}

export interface PackedCatalogOreDictionaries {
  schemaVersion: 5;
  kind: 'oreDictionaries';
  logicalId: string;
  prefix: string;
  oreDictionaries: PackedOreDictionary[];
}

export interface PackedCatalogIngredientGroups {
  schemaVersion: 5;
  kind: 'ingredientGroups';
  logicalId: string;
  ingredientGroups: PackedIngredientGroup[];
}

export interface PackedCatalogRecipeRemaps {
  schemaVersion: 5;
  kind: 'recipeRemaps';
  logicalId: string;
  obsoleteRecipeRemaps: Record<string, string>;
}

export interface PackedCatalogSpecialMetadata {
  schemaVersion: 5;
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
