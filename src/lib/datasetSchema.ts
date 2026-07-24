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

export interface CatalogAsset extends DatasetAsset {
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

export interface DatasetManifest {
  formatVersion: number;
  datasetId: string;
  gtnhVersion: string;
  revision: string;
  displayName: string;
  catalogAssets: CatalogAsset[];
  recipeShards: RecipeShardAsset[];
  iconSheets: IconSheetAsset[];
  totals?: {
    assets: number;
    offlineBytes: number;
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
}

export interface PackedCatalog {
  datasetId: string;
  goods: PackedGoods[];
  recipeTypes: PackedRecipeType[];
  oreDictionaries: PackedOreDictionary[];
  serviceItemIds?: string[];
  obsoleteRecipeRemaps?: Record<string, string>;
}

export interface PackedCatalogCore extends Omit<PackedCatalog, 'goods'> {
  schemaVersion: 2;
  kind: 'core';
}

export interface PackedCatalogGoods {
  schemaVersion: 2;
  datasetId: string;
  kind: 'goods';
  part: number;
  goods: PackedGoods[];
}

interface PackedIo {
  kind: 'item' | 'fluid' | 'oreDict';
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
