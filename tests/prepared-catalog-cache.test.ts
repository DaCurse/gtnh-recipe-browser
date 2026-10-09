import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { cachePreparedCatalog, cachePreparedSearch, getPreparedCatalog, getPreparedSearch, preparedCatalogKey, type PreparedCatalog } from '../src/lib/preparedCatalogCache';
import { cacheRuntimeData, removeDataset, saveDataset } from '../src/lib/storage';
import type { DatasetManifest } from '../src/lib/datasetSchema';
import type { DatasetState } from '../src/lib/types';

const datasetId = 'prepared-fixture';
const key = 'prepared-v5:fixture';
const state: DatasetState = { datasetId, gtnhVersion: 'fixture', revision: '1', displayName: 'Fixture',
  manifestUrl: 'https://example.test/manifest.json', status: 'catalog', storedBytes: 0, totalBytes: 1,
  active: false, assetHashes: [], updatedAt: 1 };
const prepared: PreparedCatalog = {
  resolved: { entries: Array.from({ length: 2_005 }, (_, index) => ({ id: `item:${index}`, name: `Item ${index}`,
    mod: 'fixture', kind: 'item', tooltip: [], color: '#fff', glyph: 'x' })), recipeTypes: new Map(), ingredientGroups: new Map() },
  browseRows: [{ id: 'variants:first', variantIds: ['item:0', 'item:1'], variantCount: 2, variantKind: 'exact' }],
  specialViewTypes: [], specialServiceIcons: []
};

describe('prepared catalog projections', () => {
  it('round-trips chunked catalogs and search documents and ignores incomplete or corrupt cache records', async () => {
    prepared.resolved.entries[0]!.icon = { url: 'https://example.test/sheet.webp', index: 12, columns: 16, sha256: 'sheet-hash', bytes: 42, encoding: 'identity', datasetId };
    await saveDataset(state);
    expect(await getPreparedCatalog(datasetId, key)).toBeNull();
    await cachePreparedCatalog(datasetId, key, prepared);
    expect(await getPreparedCatalog(datasetId, key)).toEqual(prepared);
    await cacheRuntimeData(datasetId, `${key}:entries:1`, 'invalid JSON');
    expect(await getPreparedCatalog(datasetId, key)).toBeNull();
    await cachePreparedCatalog(datasetId, key, prepared);
    const documents = prepared.resolved.entries.map((entry) => ({ id: entry.id, name: entry.name, normalizedName: entry.name, members: [] }));
    await cachePreparedSearch(datasetId, key, documents);
    expect(await getPreparedSearch(datasetId, key, documents.length)).toEqual(documents);
    expect(await getPreparedSearch(datasetId, key, documents.length + 1)).toBeNull();
    await cacheRuntimeData(datasetId, `${key}:search:2000`, 'null');
    expect(await getPreparedSearch(datasetId, key, documents.length)).toBeNull();
    await removeDataset(datasetId);
    // Background persistence must not recreate data after the user removes its dataset.
    await cachePreparedCatalog(datasetId, key, prepared);
    expect(await getPreparedCatalog(datasetId, key)).toBeNull();
  });

  it('invalidates projections for changed manifests and asset bases', () => {
    const manifest = { datasetId, revision: '1', catalogAssets: [{ sha256: 'old' }] } as unknown as DatasetManifest;
    const original = preparedCatalogKey(manifest, 'https://example.test/a/manifest.json');
    expect(preparedCatalogKey({ ...manifest, revision: '2' }, 'https://example.test/a/manifest.json')).not.toBe(original);
    expect(preparedCatalogKey(manifest, 'https://example.test/b/manifest.json')).not.toBe(original);
  });
});
