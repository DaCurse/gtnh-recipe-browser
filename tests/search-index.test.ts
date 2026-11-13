import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatasetRepository } from '../src/lib/dataset';
import { buildCatalogBrowseEntries } from '../src/lib/catalogVariants';
import {
  catalogDocumentMatches,
  parseCatalogSearchQuery,
  type CatalogSearchDocument,
} from '../src/lib/catalogSearch';
import type { CatalogEntry } from '../src/lib/types';

const cache = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('../src/lib/preparedCatalogCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/preparedCatalogCache')>()),
  getPreparedSearch: cache.read,
  cachePreparedSearch: cache.write,
}));

function fixture() {
  const entries: CatalogEntry[] = [
    {
      id: 'i:fixture:metal:0',
      name: 'Iron',
      mod: 'fixture',
      kind: 'item',
      color: '#fff',
      glyph: 'x',
      tooltip: [],
    },
  ];
  const groups = vi.fn().mockResolvedValue([
    { id: 'o:ingotIron', itemIds: [entries[0]!.id] },
    { id: 'a:anonymous', itemIds: [entries[0]!.id] },
  ]);
  const repository: DatasetRepository = Object.create(DatasetRepository.prototype);
  Object.assign(repository, {
    datasetId: 'search-fixture',
    runtimeCacheKey: 'runtime-fixture',
    entries,
    entriesById: new Map(entries.map((entry) => [entry.id, entry])),
    browseEntries: buildCatalogBrowseEntries(entries),
    searchDocumentsPromises: new Map(),
    manifest: { ingredientGroupShards: [{ id: 'groups', prefix: '' }] },
    groupShard: groups,
  });
  return { repository, groups };
}

beforeEach(() => {
  vi.clearAllMocks();
  cache.read.mockResolvedValue(null);
  cache.write.mockResolvedValue(undefined);
});

describe('lazy ore-dictionary search projection', () => {
  it('loads membership only for an enriched index and shares concurrent builds', async () => {
    const { repository, groups } = fixture();
    const base = await repository.loadSearchDocuments();
    expect(groups).not.toHaveBeenCalled();
    expect(catalogDocumentMatches(base[0]!, parseCatalogSearchQuery('$ingotIron'))).toBe(false);
    const first = repository.loadSearchDocuments(true);
    expect(repository.loadSearchDocuments(true)).toBe(first);
    const enriched = await first;
    expect(groups).toHaveBeenCalledTimes(1);
    expect(catalogDocumentMatches(enriched[0]!, parseCatalogSearchQuery('$ingotIron'))).toBe(true);
    expect(catalogDocumentMatches(enriched[0]!, parseCatalogSearchQuery('$anonymous'))).toBe(false);
    expect(catalogDocumentMatches(enriched[0]!, parseCatalogSearchQuery('ingotIron'))).toBe(false);
    expect(await repository.loadSearchDocuments()).toBe(base);
    expect(cache.write.mock.calls.map((call) => call[1])).toEqual([
      'runtime-fixture:search-syntax-v1:base',
      'runtime-fixture:search-syntax-v1:ore',
    ]);
  });
  it('reuses persisted enriched documents without downloading membership again', async () => {
    const original = fixture();
    const saved = await original.repository.loadSearchDocuments(true);
    cache.read.mockImplementation((_id: string, key: string) =>
      Promise.resolve(key.endsWith(':ore') ? saved : null),
    );
    const fresh = fixture();
    expect(await fresh.repository.loadSearchDocuments(true)).toBe(saved);
    expect(fresh.groups).not.toHaveBeenCalled();
    expect(cache.read).toHaveBeenLastCalledWith(
      'search-fixture',
      'runtime-fixture:search-syntax-v1:ore',
      1,
    );
  });
  it('allows a failed membership download to be retried and preserves the base index', async () => {
    const { repository, groups } = fixture();
    const base: CatalogSearchDocument[] = await repository.loadSearchDocuments();
    groups.mockRejectedValueOnce(new Error('offline'));
    await expect(repository.loadSearchDocuments(true)).rejects.toThrow('offline');
    expect(await repository.loadSearchDocuments()).toBe(base);
    const retried = await repository.loadSearchDocuments(true);
    expect(catalogDocumentMatches(retried[0]!, parseCatalogSearchQuery('$ingotIron'))).toBe(true);
    expect(groups).toHaveBeenCalledTimes(2);
  });
});
