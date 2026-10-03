import type { VersionsIndex } from './datasetSchema';
import type {
  DatasetState,
  DatasetVersion,
  ManagedDataset
} from './types';

/** Bumped for format-7 bootstrap/detail/group ownership and generic v6 migration. */
export const CURRENT_DATASET_CACHE_VERSION = 3;

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

// Frozen bridge IDs are metadata only; their manifests must never enter the v7 loader.
const legacyVersions: Readonly<Record<string, string>> = {
  '2.9.0-beta-3-v6-rd5d4ec826817': '2.9.0-beta-3',
  '2.9.0-beta-2-v6-rfd81b2eed8b0': '2.9.0-beta-2',
  '2.8.0-v6-r6d351536': '2.8.0'
};

/** Resolve legacy links and cache rows before choosing a manifest. */
export function preferredDatasetId(
  available: readonly DatasetVersion[],
  stored: readonly DatasetState[],
  requested?: string
): string | undefined {
  if (requested && available.some((version) => version.datasetId === requested)) return requested;
  const active = stored.find((state) => state.active);
  const source = requested ? stored.find((state) => state.datasetId === requested) : active;
  const semanticVersion = (requested ? legacyVersions[requested] : undefined) ?? source?.gtnhVersion;
  const replacement = available.find((version) => version.gtnhVersion === semanticVersion);
  if (replacement) return replacement.datasetId;
  if (source && !isLegacyDatasetState(source) && !source.datasetId.includes('-v6-')) return source.datasetId;
  // Unsupported explicit links fail without fetching an obsolete manifest.
  if (requested) return undefined;
  return available[0]?.datasetId;
}

/** A URL repeating the saved selection is startup state, not a deliberate version override. */
export function startupDatasetSelection(
  index: VersionsIndex,
  stored: readonly DatasetState[],
  requested: string | undefined,
  appliedEpoch: number | undefined
): { datasetId?: string; rolloutEpoch?: number } {
  const policy = index.rollout;
  const pending = policy && Number.isSafeInteger(policy.epoch) && policy.epoch > 0
    && policy.epoch > (appliedEpoch ?? 0)
    && index.versions.some((version) => version.datasetId === policy.targetDatasetId);
  const active = stored.find((state) => state.active);
  const explicit = requested && requested !== active?.datasetId;
  return {
    datasetId: pending && !explicit ? policy.targetDatasetId
      : preferredDatasetId(index.versions, stored, requested),
    // Successful explicit startup choices also acknowledge the epoch, preserving that choice.
    rolloutEpoch: pending ? policy.epoch : undefined
  };
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
