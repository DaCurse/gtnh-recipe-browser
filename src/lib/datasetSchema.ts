import type { DatasetVersion, RecipeLayout } from './types';

export interface VersionsIndex {
  schemaVersion: number;
  versions: DatasetVersion[];
}

export interface DatasetAsset {
  id: string;
  url: string;
  bytes: number;
  sha256: string;
  encoding: 'gzip' | 'identity';
}

interface CatalogAsset extends DatasetAsset {
  role?: 'core' | 'goods';
  part?: number;
  goodsCount?: number;
}

interface RecipeShardAsset extends DatasetAsset {
  recipeTypeId: string;
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
}

export interface DatasetManifest {
  formatVersion: number;
  datasetId: string;
  gtnhVersion: string;
  revision: string;
  displayName: string;
  catalogAssets: CatalogAsset[];
  recipeShards: RecipeShardAsset[];
  iconSheets: IconSheetAsset[];
  specialDataShards?: SpecialDataShardAsset[];
  totals?: {
    assets: number;
    offlineBytes: number;
    specialRecords?: number;
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
  numericId: number;
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
}

export interface PackedIngredientGroup {
  id: string;
  itemIds: string[];
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

export interface PackedCatalogCore extends Omit<PackedCatalog, 'goods'> {
  schemaVersion: 2 | 3 | 4;
  kind: 'core';
}

export interface PackedCatalogGoods {
  schemaVersion: 2 | 3 | 4;
  datasetId: string;
  kind: 'goods';
  part: number;
  goods: PackedGoods[];
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
  datasetId: string;
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
  schemaVersion: 4;
  datasetId: string;
  kind: 'special';
  specialViewTypeId: string;
  specialViewTypeOrder: number;
  part: number;
  records: PackedSpecialRecord[];
}
