import type { AssetDescriptor, CatalogEntry } from '../types';
import type { SpecialGoods } from '../specialData';
import type { Quest } from './types';

export interface QuestPreviewRepository {
  readonly quests: ReadonlyMap<string, Quest>;
  readonly items: ReadonlyMap<string, CatalogEntry>;
}
export interface QuestItemRelations {
  recipes: string[];
  usages: string[];
  goods?: Record<string, { recipes: SpecialGoods[]; usages: SpecialGoods[] }>;
}
export interface QuestLinksData {
  schemaVersion: 1;
  version: string;
  recipeDatasetId: string;
  bookId: string;
  quests: Quest[];
  items: CatalogEntry[];
  chapters: Record<string, { id: string; name: string }[]>;
  buckets: Record<string, AssetDescriptor>;
  all: QuestItemRelations;
}
export interface QuestLinksVersions {
  schemaVersion: 1;
  versions: Array<{ recipeDatasetId: string; version: string; root: AssetDescriptor }>;
}
