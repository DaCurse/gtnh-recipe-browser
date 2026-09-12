import type { RecordPageSelection } from '../../src/lib/recordPages';

type AssetEncoding = 'gzip' | 'identity';

interface SharedPrefixLayoutManifest {
  recipeTypes: Record<string, string[]>;
  goods: string[];
  oreDictionaries: string[];
  specialViews: Record<string, string[]>;
}

export interface ImmutableAsset {
  segments?: RecordPageSelection[];
  /** Physical record pages may exceed the cap only for one complete record. */
  oversizedSingleton?: boolean;
  id: string;
  url: string;
  bytes: number;
  sha256: string;
  encoding: AssetEncoding;
  mediaType: string;
}

export interface CatalogAsset extends ImmutableAsset {
  kind: 'catalog';
  role: 'core' | 'goods' | 'goodsMetadata' | 'recipeTypes' | 'oreDictionaries'
    | 'ingredientGroups' | 'recipeRemaps' | 'specialMetadata' | 'icons';
  part: number;
  goodsCount: number;
  recordCount?: number;
  /** Stable logical name; `part` is presentation order only. */
  logicalId: string;
  prefix?: string;
  /** True only when one complete goods record is larger than the target cap. */
  oversizedSingleton?: boolean;
}

export interface RecipeShardAsset extends ImmutableAsset {
  kind: 'recipeShard';
  recipeTypeId: string;
  recipeTypeOrder: number;
  part: number;
  recipeCount: number;
  /** Hash-prefix partition; `part` remains presentation metadata. */
  prefix: string;
  logicalId: string;
  /** True only when one complete recipe record is larger than the target cap. */
  oversizedSingleton?: boolean;
}

interface IconSheetAsset extends ImmutableAsset {
  encoding: 'identity';
  mediaType: 'image/webp';
  kind: 'iconSheet';
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
  prefix: string;
  logicalId: string;
  /** True only when one complete special record is larger than the target cap. */
  oversizedSingleton?: boolean;
}

export interface GeneratedPackManifest {
  formatVersion: 6;
  datasetId: string;
  gtnhVersion: string;
  revision: string;
  displayName: string;
  source: {
    formatVersion: 5;
    dataSha256: string;
    atlasSha256: string;
    /** Digest of the validated exporter input; the raw sidecar is not published. */
    specialDataSha256?: string;
  };
  catalogAssets: CatalogAsset[];
  recipeShards: RecipeShardAsset[];
  iconSheets: IconSheetAsset[];
  specialDataShards: SpecialDataShardAsset[];
  recordPages: ImmutableAsset[];
  /** All assets live in the immutable global SHA-256 object store. */
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
    prefixes: SharedPrefixLayoutManifest;
  };
  totals: {
    searchableEntries: number;
    recipes: number;
    specialRecords: number;
    assets: number;
    offlineBytes: number;
  };
}
