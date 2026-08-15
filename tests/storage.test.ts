import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  activateDataset,
  cacheAsset,
  getCatalogSnapshot,
  getCachedAsset,
  listDatasets,
  removeDataset,
  saveCatalogSnapshot,
  saveDataset,
  type CachedCatalogSnapshot
} from '../src/lib/storage';
import type { DatasetState } from '../src/lib/types';

function dataset(datasetId: string, active: boolean, assetHashes: string[]): DatasetState {
  return {
    datasetId,
    gtnhVersion: datasetId,
    revision: 'fixture',
    displayName: datasetId,
    manifestUrl: `https://example.test/${datasetId}/manifest.json`,
    status: 'partial',
    storedBytes: assetHashes.length,
    totalBytes: 3,
    active,
    assetHashes,
    updatedAt: 1
  };
}

describe('IndexedDB dataset lifecycle', () => {
  it('switches versions atomically and retains shared assets during deletion', async () => {
    await cacheAsset('shared', new Uint8Array([1]));
    await cacheAsset('only-a', new Uint8Array([2]));
    await cacheAsset('only-b', new Uint8Array([3]));
    await saveDataset(dataset('version-a', true, ['shared', 'only-a']));
    await saveDataset(dataset('version-b', false, ['shared', 'only-b']));

    await activateDataset('version-b');
    expect((await listDatasets()).map(({ datasetId, active }) => [datasetId, active]))
      .toEqual([
        ['version-a', false],
        ['version-b', true]
      ]);

    await removeDataset('version-a');
    expect(await getCachedAsset('only-a')).toBeNull();
    expect(await getCachedAsset('shared')).toEqual(new Uint8Array([1]));
    expect(await getCachedAsset('only-b')).toEqual(new Uint8Array([3]));

    await removeDataset('version-b');
    expect(await listDatasets()).toEqual([]);
    expect(await getCachedAsset('shared')).toBeNull();
    expect(await getCachedAsset('only-b')).toBeNull();
  });

  it('persists and removes a decoded catalog snapshot with its dataset', async () => {
    const snapshot: CachedCatalogSnapshot = {
      cacheVersion: 1,
      datasetId: 'snapshot-version',
      formatVersion: 3,
      manifestUrl: 'https://example.test/snapshot/manifest.json',
      catalogHashes: ['catalog-hash'],
      catalog: {
        datasetId: 'snapshot-version',
        goods: [],
        recipeTypes: [],
        oreDictionaries: [],
        ingredientGroups: []
      },
      materialized: {
        entries: [],
        productionFallbacks: []
      },
      browseEntries: [],
      searchDocuments: [],
      cachedAt: Date.now()
    };
    await saveCatalogSnapshot(snapshot);
    expect(await getCatalogSnapshot(snapshot.datasetId)).toMatchObject({
      datasetId: snapshot.datasetId,
      catalogHashes: ['catalog-hash']
    });
    await saveDataset(dataset(snapshot.datasetId, false, ['catalog-hash']));
    await cacheAsset('catalog-hash', new Uint8Array([4]));
    await removeDataset(snapshot.datasetId);
    expect(await getCatalogSnapshot(snapshot.datasetId)).toBeNull();
  });
});
