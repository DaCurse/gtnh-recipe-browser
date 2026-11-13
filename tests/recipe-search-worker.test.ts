import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeSearchRecord } from '../src/lib/recipeSearch';
const mocks = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock('../src/lib/recipeSearch', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/recipeSearch')>();
  return {
    ...original,
    buildRecipeSearchDocument: mocks.build.mockImplementation(original.buildRecipeSearchDocument),
  };
});
let scope: {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage?: (event: { data: unknown }) => void;
};
const send = (data: unknown) => scope.onmessage!({ data });
const record = (id: string, ingredient: string, order: number): RecipeSearchRecord => ({
  id,
  order,
  type: 'Assembler',
  ingredientIds: [ingredient],
  details: ['32 EU/t'],
});
const query = (id: number, text = '', offset = 0) =>
  send({
    type: 'search',
    generation: 1,
    id,
    query: text,
    recipeType: 'Assembler',
    offset,
    limit: 1,
  });
beforeEach(async () => {
  vi.resetModules();
  mocks.build.mockClear();
  scope = { postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  await import('../src/workers/recipeSearch.worker');
  send({ type: 'init', generation: 1 });
  send({
    type: 'appendCatalog',
    generation: 1,
    catalog: [
      { id: 'copper', name: 'Copper Ingot', mod: 'GregTech', tooltip: ['Conductive'] },
      { id: 'iron', name: 'Iron Ingot', mod: 'Minecraft', tooltip: [] },
    ],
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('lazy recipe search worker', () => {
  it('pages unfiltered records without building search text, then retains ingredient and metadata filtering', async () => {
    send({
      type: 'append',
      generation: 1,
      recipes: [record('copper-recipe', 'copper', 2), record('iron-recipe', 'iron', 1)],
    });
    query(1);
    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 1, ids: ['iron-recipe'], total: 2 }),
    );
    expect(mocks.build).not.toHaveBeenCalled();
    query(2, 'conductive');
    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 2, ids: ['copper-recipe'], total: 1 }),
    );
    expect(mocks.build).toHaveBeenCalledTimes(2);
    query(3, '32 eu/t');
    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 3, ids: ['iron-recipe'], total: 2 }),
    );
    expect(mocks.build).toHaveBeenCalledTimes(2);
    query(4, '', 1);
    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 4, ids: ['copper-recipe'], total: 2 }),
    );
    send({ type: 'reset', generation: 2 });
    send({ type: 'append', generation: 2, recipes: [record('next', 'copper', 0)] });
    send({
      type: 'search',
      generation: 2,
      id: 5,
      query: 'conductive',
      recipeType: 'Assembler',
      offset: 0,
      limit: 20,
    });
    expect(scope.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 5, ids: ['next'], total: 1 }),
    );
  });

  it('cancels obsolete searches and ignores stale appends after a new item context', async () => {
    send({
      type: 'append',
      generation: 1,
      recipes: Array.from({ length: 2500 }, (_, i) => record(`old-${i}`, 'copper', i)),
    });
    query(1, 'copper');
    send({ type: 'reset', generation: 2 });
    send({ type: 'append', generation: 1, recipes: [record('stale', 'copper', 0)] });
    send({ type: 'append', generation: 2, recipes: [record('current', 'iron', 0)] });
    send({
      type: 'search',
      generation: 2,
      id: 2,
      query: 'iron',
      recipeType: 'Assembler',
      offset: 0,
      limit: 20,
    });
    await vi.waitFor(() =>
      expect(scope.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 2, ids: ['current'], total: 1 }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      scope.postMessage.mock.calls.some(
        ([message]) => message.type === 'results' && message.id === 1,
      ),
    ).toBe(false);
  });
});
