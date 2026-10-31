import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetState, DatasetVersion } from '../src/lib/types';

const mocks = vi.hoisted(() => ({ index: vi.fn(), installed: vi.fn(), metadata: vi.fn(), cache: vi.fn() }));
vi.mock('../src/lib/datasetAssets', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/datasetAssets')>(),
  fetchJsonNetworkFirst: mocks.index
}));
vi.mock('../src/lib/storage', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/storage')>(),
  listDatasets: mocks.installed,
  getCachedMetadata: mocks.metadata,
  cacheMetadata: mocks.cache
}));
import { DatasetRepository } from '../src/lib/dataset';

const previous: DatasetVersion = { datasetId: 'rc1', gtnhVersion: '2.9.0-RC-1', revision: 'old', packManifestUrl: './rc1.json' };
const target: DatasetVersion = { datasetId: 'final', gtnhVersion: '2.9.0', revision: 'new', packManifestUrl: './final.json' };
const beta: DatasetVersion = { ...previous, datasetId: 'beta', gtnhVersion: '2.9.0-beta-3' };
const stored: DatasetState = { ...previous, displayName: 'RC1', manifestUrl: previous.packManifestUrl,
  status: 'complete', active: true, storedBytes: 100, totalBytes: 100, assetHashes: [], updatedAt: 1 };
const index = { schemaVersion: 1, versions: [target, previous, beta], rollout: { epoch: 3, targetDatasetId: target.datasetId } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('document', { baseURI: 'https://fixture/' });
  mocks.installed.mockResolvedValue([stored]);
  mocks.metadata.mockResolvedValue({ value: 2 });
  mocks.index.mockResolvedValue({ url: 'https://fixture/versions-v7.json', value: index });
});

afterEach(() => vi.unstubAllGlobals());

describe('background startup rollout', () => {
  it('uses the original startup intent after a delayed policy without acknowledging before activation', async () => {
    let release!: (value: { url: string; value: typeof index }) => void;
    mocks.index.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const pending = DatasetRepository.startupRollout(previous.datasetId);
    await vi.waitFor(() => expect(mocks.index).toHaveBeenCalled());
    // Activation changes local state while the request is pending. The original
    // saved-selection URL must still mean startup rather than a new explicit link.
    mocks.installed.mockResolvedValue([{ ...stored, datasetId: 'other-active' }]);
    release({ url: 'https://fixture/versions-v7.json', value: index });
    await expect(pending).resolves.toEqual({ ...target, rolloutEpoch: 3 });
    expect(mocks.cache).not.toHaveBeenCalled();
  });

  it('keeps an explicit different version link when the late policy arrives', async () => {
    await expect(DatasetRepository.startupRollout(beta.datasetId)).resolves.toEqual({ ...beta, rolloutEpoch: 3 });
  });

  it('does not switch again after the rollout epoch has been applied', async () => {
    mocks.metadata.mockResolvedValue({ value: 3 });
    await expect(DatasetRepository.startupRollout(previous.datasetId)).resolves.toBeUndefined();
  });

  it('never lowers an acknowledged epoch when a stale request finishes', async () => {
    const repository: DatasetRepository = Object.create(DatasetRepository.prototype);
    const manifestUrl = 'https://fixture/manifest.json';
    Object.defineProperty(repository, 'manifestUrl', { value: manifestUrl });
    mocks.metadata.mockResolvedValue({ value: 4 });
    await repository.acknowledgeRollout(3);
    expect(mocks.cache).not.toHaveBeenCalled();
    mocks.metadata.mockResolvedValue({ value: 2 });
    await repository.acknowledgeRollout(3);
    expect(mocks.cache).toHaveBeenCalledWith('dataset-rollout-epoch', manifestUrl, 3);
  });
});
