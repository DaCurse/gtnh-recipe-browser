import type {
  DatasetState,
  DatasetVersion,
  ManagedDataset
} from './types';

/** Bumped for format-6 physical-page ownership and removal of catalog snapshots. */
export const CURRENT_DATASET_CACHE_VERSION = 2;

/** Old browser rows predate explicit cache-format bookkeeping. */
export function isLegacyDatasetState(state: Pick<DatasetState, 'cacheVersion'>): boolean {
  return state.cacheVersion !== CURRENT_DATASET_CACHE_VERSION;
}

/**
 * Find legacy rows by semantic GTNH version, not by a hard-coded dataset ID or
 * a particular historical pack format. Revisions may change their IDs.
 */
export function legacyDatasetStatesFor(
  stored: readonly DatasetState[],
  gtnhVersion: string
): DatasetState[] {
  return stored.filter((state) =>
    state.gtnhVersion === gtnhVersion && isLegacyDatasetState(state)
  );
}

/** Preserve active ownership when a semantic version is replaced by a new dataset ID. */
export function replacementDatasetActive(
  previous: Pick<DatasetState, 'active'> | undefined,
  legacyStates: readonly Pick<DatasetState, 'active'>[],
  installed: readonly Pick<DatasetState, 'active'>[]
): boolean {
  return previous?.active ?? (
    legacyStates.some((state) => state.active)
    || installed.every((state) => !state.active)
  );
}

/** Select a published same-version replacement unless the caller requested an explicit dataset. */
export function preferredDatasetId(
  available: readonly DatasetVersion[],
  stored: readonly DatasetState[],
  requested?: string
): string | undefined {
  if (requested && available.some((version) => version.datasetId === requested)) return requested;
  if (requested) {
    const requestedState = stored.find((state) => state.datasetId === requested);
    const replacement = requestedState
      ? available.find((version) => version.gtnhVersion === requestedState.gtnhVersion)
      : undefined;
    return replacement?.datasetId ?? requested;
  }
  const active = stored.find((state) => state.active);
  const replacement = active
    ? available.find((version) => version.gtnhVersion === active.gtnhVersion)
    : undefined;
  return replacement?.datasetId ?? active?.datasetId ?? available[0]?.datasetId;
}

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
