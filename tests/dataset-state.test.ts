import { describe, expect, it } from 'vitest';
import { assetDigest, verifyAssetBytes } from '../src/lib/integrity';
import { activeDatasetSnapshot, unreferencedDatasetAssets } from '../src/lib/storage';
import type { DatasetState } from '../src/lib/types';

function state(datasetId: string, active: boolean, assetHashes: string[]): DatasetState {
  return {
    datasetId,
    gtnhVersion: datasetId,
    revision: 'fixture',
    displayName: datasetId,
    manifestUrl: `./${datasetId}/manifest.json`,
    status: 'partial',
    storedBytes: assetHashes.length,
    totalBytes: 10,
    active,
    assetHashes,
    updatedAt: 1
  };
}

describe('offline dataset state', () => {
  it('switches exactly one of two installed versions active', () => {
    const switched = activeDatasetSnapshot([
      state('2.8.0-r1', true, ['catalog-a']),
      state('2.8.0-r2', false, ['catalog-b'])
    ], '2.8.0-r2', 42);

    expect(switched.map(({ datasetId, active }) => [datasetId, active])).toEqual([
      ['2.8.0-r1', false],
      ['2.8.0-r2', true]
    ]);
    expect(switched.every((dataset) => dataset.updatedAt === 42)).toBe(true);
  });

  it('deletes only assets not shared with another installed version', () => {
    const datasets = [
      state('2.8.0-r1', false, ['shared', 'only-a']),
      state('2.8.0-r2', true, ['shared', 'only-b'])
    ];

    expect(unreferencedDatasetAssets(datasets, '2.8.0-r1')).toEqual(['only-a']);
    expect(unreferencedDatasetAssets(datasets, 'missing')).toEqual([]);
  });

  it('rejects malformed asset sizes and hashes', () => {
    const bytes = new TextEncoder().encode('verified fixture');
    const asset = {
      id: 'catalog',
      bytes: bytes.byteLength,
      sha256: assetDigest(bytes)
    };
    expect(() => verifyAssetBytes(asset, bytes)).not.toThrow();
    expect(() => verifyAssetBytes({ ...asset, bytes: bytes.byteLength + 1 }, bytes))
      .toThrow('size mismatch');
    expect(() => verifyAssetBytes({ ...asset, sha256: '0'.repeat(64) }, bytes))
      .toThrow('integrity check failed');
  });
});
