import { describe, expect, it } from 'vitest';
import {
  buildRecipeSearchDocument,
  searchRecipeDocuments,
  toRecipeSearchRecord,
  type RecipeSearchCatalogEntry,
  type RecipeSearchDocument
} from '../src/lib/recipeSearch';
import type { Recipe } from '../src/lib/types';

const catalog = new Map<string, RecipeSearchCatalogEntry>([
  ['i:test:charcoal', {
    id: 'i:test:charcoal',
    name: 'Charcoal',
    mod: 'Minecraft',
    tooltip: ['Burn time: 1,600 ticks']
  }],
  ['i:test:treated_plank', {
    id: 'i:test:treated_plank',
    name: 'Treated Wood Planks',
    mod: 'Immersive Engineering',
    tooltip: ['Resists decay']
  }]
]);

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'recipe:test',
    type: 'Crafting Table',
    inputs: [{ id: 'o:plankWood', alternatives: ['i:test:treated_plank'] }],
    outputs: [{ id: 'i:test:charcoal' }],
    layout: {
      itemInputs: { columns: 3, rows: 3 },
      fluidInputs: { columns: 0, rows: 0 },
      itemOutputs: { columns: 1, rows: 1 },
      fluidOutputs: { columns: 0, rows: 0 }
    },
    metadata: ['Low gravity'],
    order: 4,
    ...overrides
  };
}

describe('recipe search indexing', () => {
  it('indexes ingredient names, mods, tooltips, alternatives, and metadata', () => {
    const document = buildRecipeSearchDocument(toRecipeSearchRecord(recipe()), catalog);

    expect(document.haystack).toContain('immersive engineering');
    expect(document.haystack).toContain('resists decay');
    expect(document.haystack).toContain('burn time: 1 600 ticks');
    expect(document.haystack).toContain('low gravity');
  });

  it('filters within the selected machine type and returns a requested page', () => {
    const documents = [
      buildRecipeSearchDocument(toRecipeSearchRecord(recipe({ id: 'craft:1', order: 1 })), catalog),
      buildRecipeSearchDocument(toRecipeSearchRecord(recipe({ id: 'craft:2', order: 2 })), catalog),
      buildRecipeSearchDocument(toRecipeSearchRecord(recipe({
        id: 'furnace:1',
        type: 'Electric Furnace',
        order: 3
      })), catalog)
    ];

    expect(searchRecipeDocuments(documents, 'Crafting Table', 'treated wood', 1, 1)).toEqual({
      ids: ['craft:2'],
      total: 2
    });
    expect(searchRecipeDocuments(documents, 'Electric Furnace', 'treated', 0, 20)).toEqual({
      ids: ['furnace:1'],
      total: 1
    });
  });

  it('keeps large result sets bounded to the visible page', () => {
    const documents: RecipeSearchDocument[] = Array.from({ length: 30_000 }, (_, index) => ({
      id: `craft:${index}`,
      type: 'Crafting Table',
      order: index,
      haystack: `crafting table charcoal variant ${index}`
    }));

    const result = searchRecipeDocuments(documents, 'Crafting Table', 'charcoal', 12_340, 20);

    expect(result.total).toBe(30_000);
    expect(result.ids).toHaveLength(20);
    expect(result.ids[0]).toBe('craft:12340');
    expect(result.ids.at(-1)).toBe('craft:12359');
  });

  it('matches every normalized query term', () => {
    const document = buildRecipeSearchDocument(toRecipeSearchRecord(recipe()), catalog);

    expect(searchRecipeDocuments([document], 'Crafting Table', 'CHARCOAL minecraft', 0, 20).total).toBe(1);
    expect(searchRecipeDocuments([document], 'Crafting Table', 'charcoal furnace', 0, 20).total).toBe(0);
  });
});
