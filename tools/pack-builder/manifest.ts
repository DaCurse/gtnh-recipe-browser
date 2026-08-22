type AssetEncoding = 'gzip' | 'identity';

export interface ImmutableAsset {
  id: string;
  url: string;
  bytes: number;
  sha256: string;
  encoding: AssetEncoding;
  mediaType: string;
}

export interface CatalogAsset extends ImmutableAsset {
  kind: 'catalog';
  role: 'core' | 'goods';
  part: number;
  goodsCount: number;
}

export interface RecipeShardAsset extends ImmutableAsset {
  kind: 'recipeShard';
  recipeTypeId: string;
  recipeTypeOrder: number;
  part: number;
  recipeCount: number;
}

export interface IconSheetAsset extends ImmutableAsset {
  kind: 'iconSheet';
  firstIcon: number;
  iconCount: number;
  columns: 32;
  rows: 32;
  spriteSize: 32;
}

export interface SpecialDataShardAsset extends ImmutableAsset {
  kind: 'specialData';
  specialViewTypeId: string;
  specialViewTypeOrder: number;
  part: number;
  recordCount: number;
}

export interface GeneratedPackManifest {
  formatVersion: 4;
  datasetId: string;
  gtnhVersion: string;
  revision: string;
  displayName: string;
  source: {
    formatVersion: 5;
    dataSha256: string;
    atlasSha256: string;
    specialDataSha256?: string;
  };
  catalogAssets: CatalogAsset[];
  recipeShards: RecipeShardAsset[];
  iconSheets: IconSheetAsset[];
  specialDataShards: SpecialDataShardAsset[];
  totals: {
    searchableEntries: number;
    recipes: number;
    specialRecords: number;
    assets: number;
    offlineBytes: number;
  };
}
