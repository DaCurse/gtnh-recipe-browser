import { describe, expect, it } from 'vitest';
import { recipeViewCount } from '../src/lib/recipeCounts';
import type { CatalogEntry } from '../src/lib/types';

const entry = { id: 'i:test:ore:0', productionCount: 0, usageCount: 7,
  specialProductionCounts: { 'crop-breeding': 1, 'gt-ore-processing': 8 },
  specialUsageCounts: { 'crop-output': 2, 'crop-breeding': 3 } } as unknown as CatalogEntry;

describe('recipe direction counts', () => {
  it('counts special-only production and excludes disabled pages', () => {
    expect(recipeViewCount(entry, 'recipes')).toBe(1);
  });
  it('combines ordinary and special usages, including after ordinary shards load', () => {
    expect(recipeViewCount(entry, 'usages')).toBe(12);
    expect(recipeViewCount(entry, 'usages', 9)).toBe(14);
    expect(recipeViewCount(entry, 'recipes', 0)).toBe(1);
  });
  it('keeps machine usage counts independent of special pages', () => {
    expect(recipeViewCount(entry, 'machineUsages')).toBeUndefined();
    expect(recipeViewCount(entry, 'machineUsages', 42)).toBe(42);
  });
  it('supports old datasets and unknown counts', () => {
    expect(recipeViewCount({ specialProductionCount: 4 } as CatalogEntry, 'recipes')).toBe(4);
    expect(recipeViewCount({} as CatalogEntry, 'recipes')).toBeUndefined();
    expect(recipeViewCount({ productionCount: 0 } as CatalogEntry, 'recipes')).toBe(0);
  });
});
