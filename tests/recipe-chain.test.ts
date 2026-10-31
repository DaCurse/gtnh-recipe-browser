import { describe, expect, it } from 'vitest';
import { RecipeChainGraph, validateChainGraph, type ChainGraph, type ChainRecipe } from '../src/lib/recipeChain';
import { finderUrl, itemListUrl } from '../src/lib/navigation';

function fixture(ids: string[], recipes: Array<[number[], number[], number[]?]>, groups: ChainGraph['groups'] = []) {
  const graph: ChainGraph = { schemaVersion: 1, datasetId: 'release', manifestSha256: 'hash', ids, groups, shards: ['shard'],
    recipes: recipes.map(([inputs, outputs, tools], index): ChainRecipe => [0, index, inputs, outputs, tools ?? []]) };
  return new RecipeChainGraph(validateChainGraph(graph, 'release', 'hash'));
}
const options = { maxDepth: 12, allowExtras: true };
const records = (paths: Awaited<ReturnType<RecipeChainGraph['search']>>) => paths[0]!.steps.map((step) => step.record);

describe('recipe chain reachability', () => {
  it('follows real dust / liquid / solid conversions without equating isotopes or names', async () => {
    const graph = fixture(['dust241', 'liquid241', 'liquid239', 'dust239', 'other239'], [
      [[0], [1]], [[1], [2]], [[2], [3]]
    ]);
    expect(records(await graph.search(['dust241'], ['dust239'], options))).toEqual([0, 1, 2]);
    expect((await graph.search(['dust241'], ['other239'], options))[0]!.status).toBe('not-found');
  });
  it('accepts ingredient-group members but never turns one accepted alternative into another for free', async () => {
    const graph = fixture(['a', 'b', 'group', 'product'], [[[2], [3]]], [[2, [0, 1]]]);
    expect(records(await graph.search(['b'], ['product'], options))).toEqual([0]);
    expect((await graph.search(['a'], ['b'], options))[0]!.status).toBe('not-found');
    const producer = fixture(['a', 'b', 'group', 'seed'], [[[3], [2]]], [[2, [0, 1]]]);
    expect(records(await producer.search(['seed'], ['b'], options))).toEqual([0]);
  });
  it('does not use zero-quantity tools as conversion sources, and strict mode requires tools and side inputs', async () => {
    const graph = fixture(['ore', 'acid', 'circuit', 'product'], [[[0, 1], [3], [2]]]);
    expect((await graph.search(['circuit'], ['product'], options))[0]!.status).toBe('not-found');
    expect(records(await graph.search(['ore'], ['product'], options))).toEqual([0]);
    expect((await graph.search(['ore', 'acid'], ['product'], { ...options, allowExtras: false }))[0]!.status).toBe('not-found');
    expect(records(await graph.search(['ore', 'acid', 'circuit'], ['product'], { ...options, allowExtras: false }))).toEqual([0]);
  });
  it('constructs a complete topological proof for branching ingredient dependencies in strict mode', async () => {
    const graph = fixture(['a', 'b', 'c', 'd'], [[[0], [1]], [[0], [2]], [[1, 2], [3]]]);
    expect(records(await graph.search(['a'], ['d'], { ...options, allowExtras: false }))).toEqual([0, 1, 2]);
    expect(records(await graph.search(['a'], ['d'], options))).toEqual([0, 2]);
  });
  it('does not consume a queued future ingredient before its depth in strict mode', async () => {
    const graph = fixture(['a', 'b', 'c'], [[[0], [1]], [[0, 1], [2]]]);
    expect((await graph.search(['a'], ['c'], { maxDepth: 1, allowExtras: false }))[0]!.status).toBe('not-found');
    expect(records(await graph.search(['a'], ['c'], { maxDepth: 2, allowExtras: false }))).toEqual([0, 1]);
  });
  it('rejects borrowed tungsten recovered after mixing instead of crediting it to the source', async () => {
    const graph = fixture(['pu241', 'tungsten', 'mixture', 'pu239'], [
      [[0, 1], [2]], [[2], [1]], [[1], [3]]
    ]);
    expect((await graph.search(['pu241'], ['pu239'], options))[0]!.status).toBe('not-found');
  });
  it('rejects recovery through a different form when the extras alone can make the target', async () => {
    const graph = fixture(['source', 'borrowedDust', 'mixture', 'borrowedFluid', 'target'], [
      [[0, 1], [2]], [[2], [3]], [[3], [4]], [[1], [3]]
    ]);
    expect((await graph.search(['source'], ['target'], options))[0]!.status).toBe('not-found');
  });
  it('keeps a genuine alternative history through the same intermediate', async () => {
    const graph = fixture(['source', 'borrowed', 'intermediate', 'newForm'], [
      [[0, 1], [2]], [[2], [1]], [[0], [3]], [[3], [2]]
    ]);
    const paths = await graph.search(['source'], ['borrowed'], options);
    expect(paths[0]!.status).toBe('found');
    expect(records(paths)).toEqual([2, 3, 1]);
  });
  it('does not count non-consumed molds as borrowed source material', async () => {
    const graph = fixture(['molten', 'mold', 'ingot', 'dust'], [
      [[0], [2], [1]], [[2], [3]], [[1], [2]]
    ]);
    expect(records(await graph.search(['molten'], ['dust'], options))).toEqual([0, 1]);
  });
  it('rejects the oil -> recovered cell -> externally supplied diesel detour', async () => {
    const graph = fixture(['oil', 'lubricant', 'waterCell', 'stone', 'drillingFluid', 'emptyCell', 'diesel', 'dieselCell', 'additive', 'boosted'], [
      [[0], [1]], [[1, 2, 3], [4, 5]], [[5, 6], [7]], [[7, 8], [9]], [[2], [5]]
    ]);
    expect((await graph.search(['oil'], ['boosted'], options))[0]!.status).toBe('not-found');
  });
  it('can process sibling fractions before combining them in a source-dependent refinery route', async () => {
    const graph = fixture(['oil', 'sulfurHeavy', 'sulfurLight', 'hydrogen', 'heavy', 'light', 'diesel', 'additive', 'boosted'], [
      [[0], [1, 2]], [[1, 3], [4]], [[2, 3], [5]], [[4, 5], [6]], [[6, 7], [8]]
    ]);
    const [path] = await graph.search(['oil'], ['boosted'], options);
    expect(path!.status).toBe('found');
    const routes = [path!.steps, ...(path!.alternatives ?? [])].map((route) => route.map((step) => step.record));
    expect(routes.some((route) => route.includes(1) && route.includes(2))).toBe(true);
  });
  it('does not disqualify a shown conversion because an unrelated multi-reactant synthesis also exists', async () => {
    const graph = fixture(['source', 'reagent', 'coInput', 'target'], [
      [[0, 1, 2], [3]], [[1, 2], [3]]
    ]);
    expect(records(await graph.search(['source'], ['target'], options))).toEqual([0]);
  });
  it('reports distinct alternatives in both extra-ingredient and strict modes', async () => {
    const graph = fixture(['a', 'b', 'c'], [[[0], [1]], [[0], [1]], [[0], [2]], [[2], [1]]]);
    for (const allowExtras of [true, false]) {
      const [path] = await graph.search(['a'], ['b'], { ...options, allowExtras });
      expect(path!.status).toBe('found');
      const routes = [path!.steps, ...(path!.alternatives ?? [])];
      expect(routes.length).toBeGreaterThan(1);
      expect(new Set(routes.map((route) => JSON.stringify(route))).size).toBe(routes.length);
      expect(routes.length).toBeLessThanOrEqual(10);
      expect(path!.steps).toHaveLength(1);
    }
  });
  it('finds more than five reconverging routes and widens the requested result count', async () => {
    const recipes: Array<[number[], number[]]> = Array.from({ length: 18 }, () => [[0], [1]]);
    recipes.push([[1], [2]]);
    const graph = fixture(['source', 'shared', 'target'], recipes);
    const first = (await graph.search(['source'], ['target'], { ...options, routeLimit: 10 }))[0]!;
    const wider = (await graph.search(['source'], ['target'], { ...options, routeLimit: 25 }))[0]!;
    const count = (path: typeof first) => path.status === 'found' ? 1 + (path.alternatives?.length ?? 0) : 0;
    expect(count(first)).toBeGreaterThan(5);
    expect(count(wider)).toBeGreaterThan(count(first));
    expect(count(wider)).toBe(18);
    expect(new Set([wider.steps, ...(wider.alternatives ?? [])].map((route) => JSON.stringify(route))).size).toBe(18);
  });
  it('enumerates strict alternatives beyond replacing a single step of the first proof', async () => {
    const graph = fixture(['source', 'target'], Array.from({ length: 15 }, () => [[0], [1]]));
    const [path] = await graph.search(['source'], ['target'], { ...options, allowExtras: false, routeLimit: 25 });
    expect(1 + path!.alternatives!.length).toBe(15);
  });
  it('handles cycles, supplied outputs, depth bounds, unknown identities, and multiple targets', async () => {
    const graph = fixture(['a', 'b', 'c'], [[[0], [1]], [[1], [0]], [[1], [2]]]);
    const paths = await graph.search(['a'], ['a', 'c', 'missing'], options);
    expect(paths.map((path) => [path.status, path.steps.length])).toEqual([['found', 0], ['found', 2], ['not-found', 0]]);
    expect((await graph.search(['a'], ['c'], { ...options, maxDepth: 1 }))[0]!.status).toBe('not-found');
    expect(records(await graph.search(['a'], ['c'], { ...options, maxDepth: 2 }))).toEqual([0, 2]);
  });
  it('cancels cooperatively and reports exploration progress', async () => {
    const graph = fixture(['a', 'b'], [[[0], [1]]]);
    const controller = new AbortController(); controller.abort();
    await expect(graph.search(['a'], ['b'], options, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const progress: number[] = [];
    await graph.search(['a'], ['b'], options, undefined, (value) => progress.push(value.visited));
    expect(progress.length).toBeGreaterThan(0);
  });
});

describe('recipe graph validation and navigation', () => {
  it('rejects cross-release identity, invalid node references, and nested groups', () => {
    const graph: ChainGraph = { schemaVersion: 1, datasetId: 'release', manifestSha256: 'hash', ids: ['a', 'group'], groups: [], shards: ['s'], recipes: [[0, 0, [0], [1], []]] };
    expect(() => validateChainGraph(graph, 'other-release', 'hash')).toThrow();
    expect(() => validateChainGraph({ ...graph, recipes: [[0, 0, [9], [1], []]] }, 'release', 'hash')).toThrow();
    expect(() => validateChainGraph({ ...graph, groups: [[1, [1]]] }, 'release', 'hash')).toThrow();
  });
  it('shares the chain mode and exact constraints without leaking mode into item navigation', () => {
    const url = finderUrl('https://test/?version=release', { inputs: ['dust'], outputs: ['fluid'] }, 'chain');
    expect(url.searchParams.get('finder-mode')).toBe('chain');
    expect(itemListUrl(url).searchParams.has('finder-mode')).toBe(false);
    expect(finderUrl(url, { inputs: [], outputs: [] }).searchParams.has('finder-mode')).toBe(false);
  });
});
