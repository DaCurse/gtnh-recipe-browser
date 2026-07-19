export type Kind = 'item' | 'fluid';

export interface CatalogEntry {
  id: string;
  name: string;
  mod: string;
  kind: Kind;
  formula?: string;
  tooltip: string[];
  color: string;
  glyph: string;
  recipeTypes: string[];
  icon?: {
    url: string;
    index: number;
    columns: number;
  };
  productionShards?: string[];
  usageShards?: string[];
  searchable?: boolean;
}

export interface Ingredient {
  id: string;
  amount?: number;
  chance?: number;
  /** Zero-based position in the matching NEI item/fluid grid. */
  slot?: number;
  kind?: 'item' | 'fluid' | 'oreDict';
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
  eu?: string;
  note?: string;
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
  displayName: string;
  status: 'catalog' | 'partial' | 'complete';
  storedBytes: number;
  totalBytes: number;
  active: boolean;
}
