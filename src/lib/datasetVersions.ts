import type {
  DatasetState,
  DatasetVersion,
  ManagedDataset
} from './types';

export function reconcileDatasetVersions(
  available: readonly DatasetVersion[],
  stored: readonly DatasetState[]
): ManagedDataset[] {
  const publishedIds = new Set(available.map((version) => version.datasetId));
  const versions = new Map(available.map((version) => [version.datasetId, version]));

  for (const state of stored) {
    if (!versions.has(state.datasetId)) {
      versions.set(state.datasetId, {
        datasetId: state.datasetId,
        gtnhVersion: state.gtnhVersion,
        revision: state.revision,
        packManifestUrl: state.manifestUrl,
        offlineBytes: state.totalBytes
      });
    }
  }

  const active = stored.find((state) => state.active);
  const latestPublished = active
    ? available.find((version) => version.gtnhVersion === active.gtnhVersion)
    : undefined;
  const publishedReplacement = latestPublished?.datasetId !== active?.datasetId
    ? latestPublished
    : undefined;

  return [...versions.values()].map((version): ManagedDataset => {
    const state = stored.find((record) => record.datasetId === version.datasetId);
    return {
      version,
      state,
      stale: Boolean(state && !publishedIds.has(version.datasetId)),
      newRevisionAvailable: publishedReplacement?.datasetId === version.datasetId
    };
  });
}

export function hasRevisionUpdate(
  available: readonly DatasetVersion[],
  stored: readonly DatasetState[],
  datasetId?: string
): boolean {
  if (!datasetId) return false;
  const current = stored.find((state) => state.datasetId === datasetId);
  if (!current) return false;
  const latestPublished = available.find(
    (version) => version.gtnhVersion === current.gtnhVersion
  );
  return Boolean(latestPublished && latestPublished.datasetId !== current.datasetId);
}
