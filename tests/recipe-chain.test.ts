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
