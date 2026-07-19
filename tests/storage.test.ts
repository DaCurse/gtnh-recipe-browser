import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  activateDataset,
  cacheAsset,
  getCachedAsset,
  listDatasets,
  removeDataset,
  saveDataset
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
});
