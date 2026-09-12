import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import {
  activateDataset,
  cacheAsset,
  cachedAssetSizes,
  cachedAssetStats,
  calculateDatasetStorageReport,
  getDataset,
  getCachedAsset,
  listDatasets,
  migrateObsoleteDatasetStates,
  removeDataset,
  recordDatasetAsset,
  removeCachedAsset,
  saveDataset,
} from '../src/lib/storage';
import { CURRENT_DATASET_CACHE_VERSION } from '../src/lib/datasetVersions';
import type { DatasetState } from '../src/lib/types';

const DATABASE_NAME = 'gtnh-recipe-browser';

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

function seedLegacyDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('datasets', { keyPath: 'datasetId' });
      db.createObjectStore('assets', { keyPath: 'sha256' }).put({
        sha256: 'legacy-hash',
        bytes: new Uint8Array([1, 2, 3]).buffer,
        byteLength: 3,
        cachedAt: 1
      });
      db.createObjectStore('metadata', { keyPath: 'key' });
      db.createObjectStore('catalogs', { keyPath: 'datasetId' }).put({
        datasetId: 'legacy-catalog',
        expanded: new Array(10).fill('duplicate')
      });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
}

function inspectDatabase(): Promise<{ storeNames: string[]; assetIndex: unknown }> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const storeNames = Array.from(db.objectStoreNames);
      const transaction = db.transaction('asset-index', 'readonly');
      const valueRequest = transaction.objectStore('asset-index').get('legacy-hash');
      let assetIndex: unknown;
      valueRequest.onsuccess = () => {
        assetIndex = valueRequest.result;
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
      transaction.oncomplete = () => {
        db.close();
        resolve({ storeNames, assetIndex });
      };
    };
  });
}

describe('IndexedDB dataset lifecycle', () => {
  it('reports physical, logical, shared, and per-dataset marginal storage', () => {
    const report = calculateDatasetStorageReport([
      dataset('usage-a', false, ['shared', 'only-a']),
      dataset('usage-b', false, ['shared', 'only-b'])
    ], new Map([
      ['shared', 10],
      ['only-a', 2],
      ['only-b', 3],
      ['orphan', 7]
    ]));

    expect(report).toMatchObject({
      logicalBytes: 25,
      referencedBytes: 15,
      sharedSavingsBytes: 10,
      untrackedBytes: 7,
      sharedAssets: 1,
      untrackedAssets: 1
    });
    expect(report.byDataset['usage-a']).toMatchObject({
      cachedBytes: 12,
      exclusiveBytes: 2,
      sharedBytes: 10,
      exclusiveAssets: 1,
      sharedAssets: 1
    });
    expect(report.byDataset['usage-b']).toMatchObject({
      cachedBytes: 13,
      exclusiveBytes: 3,
      sharedBytes: 10,
      exclusiveAssets: 1,
      sharedAssets: 1
    });
  });

  it('migrates legacy asset sizes into a compact index and drops catalog snapshots', async () => {
    await seedLegacyDatabase();

    expect(await cachedAssetSizes()).toEqual(new Map([['legacy-hash', 3]]));
    expect(await getCachedAsset('legacy-hash')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await inspectDatabase()).toEqual({
      storeNames: ['asset-index', 'assets', 'datasets', 'metadata'],
      assetIndex: { sha256: 'legacy-hash', byteLength: 3 }
    });

    await removeCachedAsset('legacy-hash');
  });

  it('reads asset sizes without loading blob values', async () => {
    await cacheAsset('indexed-size', new Uint8Array([1, 2, 3, 4]));
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    try {
      expect((await cachedAssetSizes()).get('indexed-size')).toBe(4);
      expect(getAll.mock.contexts.some((context) => (
        (context as unknown as IDBObjectStore).name === 'assets'
      ))).toBe(false);
    } finally {
      getAll.mockRestore();
      await removeCachedAsset('indexed-size');
    }
  });

  it('switches versions atomically and retains shared assets during deletion', async () => {
    await cacheAsset('shared', new Uint8Array([1]));
    await cacheAsset('only-a', new Uint8Array([2]));
    await cacheAsset('only-b', new Uint8Array([3]));
    expect(await cachedAssetStats()).toEqual({ bytes: 3, assets: 3 });
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
    expect(await cachedAssetStats()).toEqual({ bytes: 2, assets: 2 });

    await removeDataset('version-b');
    expect(await listDatasets()).toEqual([]);
    expect(await getCachedAsset('shared')).toBeNull();
    expect(await getCachedAsset('only-b')).toBeNull();
    expect(await cachedAssetStats()).toEqual({ bytes: 0, assets: 0 });
  });

  it('records only physically cached assets and merges concurrent ownership updates', async () => {
    const datasetId = 'recorded-assets-version';
    const firstHash = 'recorded-first';
    const secondHash = 'recorded-second';
    await saveDataset(dataset(datasetId, false, []));

    await recordDatasetAsset(datasetId, firstHash, 4);
    expect(await getDataset(datasetId)).toMatchObject({ assetHashes: [], storedBytes: 0 });

    await cacheAsset(firstHash, new Uint8Array([1, 2, 3, 4]));
    await cacheAsset(secondHash, new Uint8Array([5, 6]));
    await Promise.all([
      recordDatasetAsset(datasetId, firstHash, 4),
      recordDatasetAsset(datasetId, secondHash, 2),
      recordDatasetAsset(datasetId, firstHash, 4)
    ]);

    expect(await getDataset(datasetId)).toMatchObject({
      assetHashes: [firstHash, secondHash],
      storedBytes: 6,
      status: 'partial'
    });

    await removeCachedAsset(firstHash);
    expect((await cachedAssetSizes()).has(firstHash)).toBe(false);
  });

  it('prunes obsolete rows after replacement while retaining current shared blobs', async () => {
    await cacheAsset('migration-only', new Uint8Array([1]));
    await cacheAsset('migration-shared', new Uint8Array([2]));
    await cacheAsset('other-legacy-only', new Uint8Array([3]));
    await cacheAsset('current-only', new Uint8Array([4]));
    await cacheAsset('same-version-only', new Uint8Array([6]));
    await cacheAsset('untracked-old-object', new Uint8Array([5]));
    await saveDataset(dataset('migration-version', false, ['migration-only', 'migration-shared']));
    const otherLegacy = dataset('other-legacy-version', true, ['other-legacy-only', 'migration-shared']);
    otherLegacy.gtnhVersion = 'other-version';
    await saveDataset(otherLegacy);
    await saveDataset({
      ...dataset('current-version', false, ['migration-shared', 'current-only']),
      cacheVersion: CURRENT_DATASET_CACHE_VERSION
    });
    await saveDataset({
      ...dataset('migration-version', false, ['migration-shared']),
      cacheVersion: CURRENT_DATASET_CACHE_VERSION
    });
    const sameVersionObsolete = {
      ...dataset('same-version-obsolete', false, ['same-version-only']),
      gtnhVersion: 'migration-version',
      cacheVersion: CURRENT_DATASET_CACHE_VERSION
    };
    await saveDataset(sameVersionObsolete);

    await migrateObsoleteDatasetStates('migration-version', [
      dataset('migration-version', false, ['migration-only', 'migration-shared']),
      otherLegacy,
      sameVersionObsolete
    ]);

    expect(await getDataset('migration-version')).toMatchObject({
      cacheVersion: CURRENT_DATASET_CACHE_VERSION,
      assetHashes: ['migration-shared']
    });
    expect(await getDataset('other-legacy-version')).toBeNull();
    expect(await getDataset('same-version-obsolete')).toBeNull();
    expect(await getDataset('current-version')).not.toBeNull();
    expect(await getCachedAsset('migration-only')).toBeNull();
    expect(await getCachedAsset('other-legacy-only')).toBeNull();
    expect(await getCachedAsset('same-version-only')).toBeNull();
    expect(await getCachedAsset('untracked-old-object')).toBeNull();
    expect(await getCachedAsset('migration-shared')).toEqual(new Uint8Array([2]));
    expect(await getCachedAsset('current-only')).toEqual(new Uint8Array([4]));
  });
});
