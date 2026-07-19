import type { MinecraftTextLine } from './minecraftText';

export type Kind = 'item' | 'fluid' | 'oreDict';
export type RecipeView = 'recipes' | 'usages' | 'machineUsages';

export interface MachineRecipeCapability {
  recipeTypeId: string;
  recipeTypeName: string;
  recipeShards: string[];
  maxVoltageTier?: number;
}

export interface CatalogEntry {
  id: string;
  name: string;
  mod: string;
  kind: Kind;
  formula?: string;
  tooltip: string[];
  formattedName?: MinecraftTextLine[];
  formattedTooltip?: MinecraftTextLine[];
  color: string;
  glyph: string;
  recipeTypes: string[];
  icon?: {
    url: string;
    index: number;
    columns: number;
    sha256?: string;
  };
  productionShards?: string[];
  usageShards?: string[];
  productionCount?: number;
  usageCount?: number;
  /** Ore dictionary used when this item has no direct production recipes. */
  productionOreDictionaryId?: string;
  container?: {
    fluidId: string;
    amount: number;
    emptyItemId: string | null;
  } | null;
  containerItemIds?: string[];
  searchable?: boolean;
  /** Stable item IDs accepted by a synthetic ore-dictionary entry. */
  members?: string[];
  /** Recipe categories this item can process when used as a machine/crafter. */
  machineCapabilities?: MachineRecipeCapability[];
}

export interface Ingredient {
  id: string;
  amount?: number;
  chance?: number;
  /** Zero-based position in the matching NEI item/fluid grid. */
  slot?: number;
  kind?: 'item' | 'fluid' | 'oreDict';
  /** Stable ore-dictionary ID retained instead of flattening the ingredient to one item. */
  oreDictionaryId?: string;
  /** Every interchangeable item accepted by an ore-dictionary ingredient. */
  alternatives?: string[];
}

export interface GridDimensions {
  columns: number;
  rows: number;
}

/**
 * Mirrors ShadowTheAge's format-v5 RecipeType.dimensions array.
 * Keeping the four grids separate preserves GT machine layouts.
 */
export interface RecipeLayout {
  itemInputs: GridDimensions;
  fluidInputs: GridDimensions;
  itemOutputs: GridDimensions;
  fluidOutputs: GridDimensions;
  shapeless?: boolean;
}

export interface Recipe {
  id: string;
  type: string;
  inputs: Ingredient[];
  outputs: Ingredient[];
  layout: RecipeLayout;
  duration?: string;
  voltage?: string;
  voltageExact?: string;
  amperage?: string;
  eu?: string;
  euExact?: string;
  euPerTick?: string;
  euPerTickExact?: string;
  metadata?: string[];
  note?: string;
  crafterId?: string;
  crafters?: Array<{
    id: string;
    role: 'singleblock' | 'multiblock' | 'default';
  }>;
  typeIconId?: string;
  circuitConflicts?: string;
  specialValue?: number;
  /** Stable client-side order derived from exporter recipe-type and shard order. */
  order?: number;
}

export interface AssetDescriptor {
  id: string;
  url: string;
  bytes: number;
  sha256: string;
  encoding: 'gzip' | 'identity';
}

export interface PackManifest {
  formatVersion: 1;
  datasetId: string;
  gtnhVersion: string;
  revision: string;
  displayName: string;
  catalogAssets: AssetDescriptor[];
  recipeShards: (AssetDescriptor & { recipeType: string })[];
  iconSheets: (AssetDescriptor & { firstIcon: number; iconCount: number })[];
}

export interface DatasetState {
  datasetId: string;
  gtnhVersion: string;
  revision: string;
  displayName: string;
  manifestUrl: string;
  status: 'catalog' | 'partial' | 'complete';
  storedBytes: number;
  totalBytes: number;
  active: boolean;
  assetHashes: string[];
  updatedAt: number;
}

export interface DatasetVersion {
  datasetId: string;
  gtnhVersion: string;
  revision: string;
  publishedAt?: string;
  packManifestUrl: string;
  catalogBytes?: number;
  offlineBytes?: number;
}

export interface OfflineInstallProgress {
  loadedBytes: number;
  totalBytes: number;
  completedAssets: number;
  totalAssets: number;
  currentAsset?: string;
  retry?: number;
}
