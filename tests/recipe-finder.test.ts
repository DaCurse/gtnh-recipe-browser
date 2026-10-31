import { describe, expect, it, vi } from 'vitest';
import { DatasetRepository } from '../src/lib/dataset';
import { matchesRecipeConstraints } from '../src/lib/recipeFinder';
import { finderFromUrl, finderUrl, itemListUrl } from '../src/lib/navigation';
import type { CatalogEntry, Recipe } from '../src/lib/types';

const recipe: Recipe = {
  id: 'alloy', type: 'Alloy Smelter', inputs: [
    { id: 'group:iron', kind: 'oreDict', ingredientGroupId: 'group:iron', alternatives: ['iron-a', 'iron-b'] },
    { id: 'carbon', amount: 2 }, { id: 'water', kind: 'fluid' }
  ], outputs: [{ id: 'steel' }, { id: 'slag', chance: 0.1 }],
  layout: { itemInputs: { rows: 1, columns: 2 }, fluidInputs: { rows: 1, columns: 1 },
    itemOutputs: { rows: 1, columns: 2 }, fluidOutputs: { rows: 0, columns: 0 } }
};

describe('recipe subset matching', () => {
  it('requires every chosen identity on its correct side while allowing extra ingredients', () => {
    expect(matchesRecipeConstraints(recipe, { inputs: ['iron-b', 'water'], outputs: ['steel'] })).toBe(true);
    expect(matchesRecipeConstraints(recipe, { inputs: ['group:iron', 'carbon'], outputs: ['slag'] })).toBe(true);
    expect(matchesRecipeConstraints(recipe, { inputs: ['steel'], outputs: [] })).toBe(false);
    expect(matchesRecipeConstraints(recipe, { inputs: ['iron-b', 'missing'], outputs: ['steel'] })).toBe(false);
    expect(matchesRecipeConstraints(recipe, { inputs: [], outputs: ['steel', 'missing'] })).toBe(false);
    expect(matchesRecipeConstraints(recipe, { inputs: [], outputs: ['steel', 'slag'] })).toBe(true);
  });
});

describe('recipe finder navigation', () => {
  it('round-trips exact NBT/fluid IDs, deduplicates, and removes item-only state', () => {
    const constraints = { inputs: ['i:thing:0?nbt=abc&x', 'water', 'water'], outputs: ['steel'] };
    const url = finderUrl('https://test/?version=release&item=old&view=usages&special=ore&recipe-filter=iron', constraints);
    expect(finderFromUrl(url)).toEqual({ inputs: constraints.inputs.slice(0, 2), outputs: ['steel'] });
    expect(url.searchParams.get('version')).toBe('release');
    expect(url.searchParams.has('item')).toBe(false);
    expect(url.searchParams.has('recipe-filter')).toBe(false);
    const home = itemListUrl(url);
    expect(finderFromUrl(home)).toBeNull();
    expect(home.searchParams.has('input')).toBe(false);
    expect(home.searchParams.has('output')).toBe(false);
  });
});

function repositoryFixture(entries: Record<string, Partial<CatalogEntry>>) {
  const repository: DatasetRepository = Object.create(DatasetRepository.prototype);
  const entryFor = vi.fn(async (id: string) => entries[id] ? { id, ...entries[id] } as CatalogEntry : undefined);
  const recipesFor = vi.fn(async (_id, _view, progress, signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const batch = [recipe, { ...recipe, id: 'wrong', outputs: [{ id: 'other' }] }];
    progress?.({ loadedShards: 1, totalShards: 1, batch });
    return batch;
  });
  Object.assign(repository, { entryFor, recipesFor });
  return { repository, entryFor, recipesFor };
}

describe('indexed recipe finder', () => {
  it('anchors on the narrowest candidate across both sides and filters progressive and final results', async () => {
    const { repository, recipesFor } = repositoryFixture({
      'iron-b': { usageShards: ['a', 'b', 'c'] }, steel: { productionShards: ['a'] }
    });
    const progress = vi.fn();
    const result = await repository.findRecipes({ inputs: ['iron-b'], outputs: ['steel'] }, progress);
    expect(recipesFor.mock.calls[0]!.slice(0, 2)).toEqual(['steel', 'recipes']);
    expect(result.map((r) => r.id)).toEqual(['alloy']);
    expect(progress.mock.calls[0]![0].batch.map((r: Recipe) => r.id)).toEqual(['alloy']);
  });

  it('uses fallback production shards without treating substitute output items as exact matches', async () => {
    const { repository, entryFor, recipesFor } = repositoryFixture({
      substitute: { productionOreDictionaryId: 'group' }, group: { productionShards: ['a'] }
    });
    expect(await repository.findRecipes({ inputs: [], outputs: ['substitute'] })).toEqual([]);
    expect(entryFor).toHaveBeenCalledWith('group', undefined);
    expect(recipesFor).toHaveBeenCalledTimes(1);
  });

  it('does not scan the entire dataset for empty, unavailable, or recipe-less constraints', async () => {
    const { repository, recipesFor } = repositoryFixture({ empty: {} });
    for (const inputs of [[], ['unknown'], ['empty']]) {
      expect(await repository.findRecipes({ inputs, outputs: [] })).toEqual([]);
    }
    expect(recipesFor).not.toHaveBeenCalled();
  });

  it('passes cancellation through the shared repository loader', async () => {
    const { repository, recipesFor } = repositoryFixture({ carbon: { usageShards: ['a'] } });
    const controller = new AbortController(); controller.abort();
    await expect(repository.findRecipes({ inputs: ['carbon'], outputs: [] }, undefined, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(recipesFor.mock.calls[0]![3]).toBe(controller.signal);
  });
});
