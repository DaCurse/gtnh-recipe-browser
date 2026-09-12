import { describe, expect, it } from 'vitest';
import {
  hasRevisionUpdate,
  CURRENT_DATASET_CACHE_VERSION,
  isLegacyDatasetState,
  legacyDatasetStatesFor,
  preferredDatasetId,
  replacementDatasetActive,
  reconcileDatasetVersions
} from '../src/lib/datasetVersions';
import type { DatasetState, DatasetVersion } from '../src/lib/types';

function version(datasetId: string, gtnhVersion = '2.9.0-beta-2'): DatasetVersion {
  return {
    datasetId,
    gtnhVersion,
    revision: datasetId.split('-r').at(-1) ?? datasetId,
    packManifestUrl: `./data/${datasetId}/pack-manifest.json`
  };
}

function stored(datasetId: string, active = false): DatasetState {
  const published = version(datasetId);
  return {
    ...published,
    displayName: published.gtnhVersion,
    manifestUrl: published.packManifestUrl,
    cacheVersion: CURRENT_DATASET_CACHE_VERSION,
    status: 'complete',
    storedBytes: 100,
    totalBytes: 100,
    active,
    assetHashes: [],
    updatedAt: 1
  };
}

describe('dataset revision availability', () => {
  it('transfers active state when a semantic version gets a new dataset ID', () => {
    expect(replacementDatasetActive(undefined, [{ active: true }], [{ active: true }])).toBe(true);
    expect(replacementDatasetActive(undefined, [{ active: false }], [{ active: false }])).toBe(true);
    expect(replacementDatasetActive(undefined, [{ active: false }], [{ active: true }])).toBe(false);
    expect(replacementDatasetActive({ active: false }, [{ active: true }], [{ active: true }])).toBe(false);
  });

  it('detects legacy cache rows generically, regardless of their old pack format', () => {
    const current = stored('current', true);
    const missingMarker = { ...stored('old-missing-marker'), cacheVersion: undefined };
    const oldCacheVersion = { ...stored('old-cache-version'), cacheVersion: CURRENT_DATASET_CACHE_VERSION - 1 };

    expect(isLegacyDatasetState(current)).toBe(false);
    expect(isLegacyDatasetState(missingMarker)).toBe(true);
    expect(isLegacyDatasetState(oldCacheVersion)).toBe(true);
    expect(legacyDatasetStatesFor(
      [current, missingMarker, oldCacheVersion],
      current.gtnhVersion
    ).map((state) => state.datasetId)).toEqual([
      'old-missing-marker',
      'old-cache-version'
    ]);
  });

  it('automatically selects the published replacement for a stale active revision', () => {
    const oldDataset = stored('2.9.0-beta-2-rold', true);
    const latest = version('2.9.0-beta-2-rnew');

    expect(preferredDatasetId([latest], [oldDataset])).toBe(latest.datasetId);
  });

  it('updates stale explicit links to the published replacement', () => {
    const oldDataset = stored('2.9.0-beta-2-rold', true);
    const latest = version('2.9.0-beta-2-rnew');

    expect(preferredDatasetId([latest], [oldDataset], oldDataset.datasetId)).toBe(latest.datasetId);
    expect(preferredDatasetId([latest], [oldDataset], latest.datasetId)).toBe(latest.datasetId);
  });

  it('marks a locally retained revision as stale and its replacement as new', () => {
    const oldDataset = stored('2.9.0-beta-2-rold', true);
    const latest = version('2.9.0-beta-2-rnew');
    const managed = reconcileDatasetVersions([latest], [oldDataset]);

    expect(managed).toHaveLength(2);
    expect(managed.find(({ version }) => version.datasetId === oldDataset.datasetId))
      .toMatchObject({ stale: true, newRevisionAvailable: false });
    expect(managed.find(({ version }) => version.datasetId === latest.datasetId))
      .toMatchObject({ stale: false, newRevisionAvailable: true });
    expect(hasRevisionUpdate([latest], [oldDataset], oldDataset.datasetId)).toBe(true);
  });

  it('does not flag another GTNH release as a revision update', () => {
    const current = stored('2.8.0-rold', true);
    current.gtnhVersion = '2.8.0';
    const nextRelease = version('2.9.0-beta-2-rnew');

    expect(hasRevisionUpdate([nextRelease], [current], current.datasetId)).toBe(false);
  });

  it('does not show attention state after switching to the published revision', () => {
    const oldDataset = stored('2.9.0-beta-2-rold');
    const latestState = stored('2.9.0-beta-2-rnew', true);
    const latest = version(latestState.datasetId);
    const stillPublishedOldRevision = version(oldDataset.datasetId);
    const managed = reconcileDatasetVersions(
      [latest, stillPublishedOldRevision],
      [oldDataset, latestState]
    );

    expect(managed.find(({ version }) => version.datasetId === latest.datasetId))
      .toMatchObject({ stale: false, newRevisionAvailable: false });
    expect(hasRevisionUpdate(
      [latest, stillPublishedOldRevision],
      [oldDataset, latestState],
      latest.datasetId
    )).toBe(false);
  });
});
