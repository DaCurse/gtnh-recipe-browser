import { describe, expect, it } from 'vitest';
import {
  hasRevisionUpdate,
  preferredDatasetId,
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
    status: 'complete',
    storedBytes: 100,
    totalBytes: 100,
    active,
    assetHashes: [],
    updatedAt: 1
  };
}

describe('dataset revision availability', () => {
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
