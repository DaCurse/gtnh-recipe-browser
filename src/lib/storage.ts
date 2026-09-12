import { openDB, type IDBPTransaction } from 'idb';
import type {
  DatasetState,
  DatasetStorageReport,
  DatasetStorageUsage
} from './types';
import { CURRENT_DATASET_CACHE_VERSION } from './datasetVersions';

const DB_NAME = 'gtnh-recipe-browser';
const DATASET_STORE = 'datasets';
const ASSET_STORE = 'assets';
const METADATA_STORE = 'metadata';
const ASSET_INDEX_STORE = 'asset-index';
const LEGACY_CATALOG_STORE = 'catalogs';
const DATABASE_VERSION = 4;

interface CachedAsset {
  sha256: string;
  bytes: ArrayBuffer;
  byteLength: number;
  cachedAt: number;
}

interface CachedAssetIndexEntry {
  sha256: string;
  byteLength: number;
}

interface CachedMetadata {
  key: string;
  url: string;
  value: unknown;
  cachedAt: number;
}

let databasePromise: ReturnType<typeof openDB> | undefined;

export function activeDatasetSnapshot(
  datasets: readonly DatasetState[],
  datasetId: string,
  updatedAt = Date.now()
): DatasetState[] {
  return datasets.map((dataset) => ({
    ...dataset,
    active: dataset.datasetId === datasetId,
    updatedAt: dataset.active === (dataset.datasetId === datasetId) ? dataset.updatedAt : updatedAt
  }));
}

export function unreferencedDatasetAssets(
  datasets: readonly DatasetState[],
  datasetId: string
): string[] {
  const target = datasets.find((dataset) => dataset.datasetId === datasetId);
  if (!target) return [];
  const retainedHashes = new Set(datasets
    .filter((dataset) => dataset.datasetId !== datasetId)
    .flatMap((dataset) => dataset.assetHashes ?? []));
  return (target.assetHashes ?? []).filter((hash) => !retainedHashes.has(hash));
}

export function calculateDatasetStorageReport(
  datasets: readonly Pick<DatasetState, 'datasetId' | 'assetHashes'>[],
  assetSizes: ReadonlyMap<string, number>
): DatasetStorageReport {
  const references = new Map<string, Set<string>>();
  const hashesByDataset = new Map<string, Set<string>>();
  for (const dataset of datasets) {
    const hashes = new Set(dataset.assetHashes ?? []);
    hashesByDataset.set(dataset.datasetId, hashes);
    for (const hash of hashes) {
      const owners = references.get(hash) ?? new Set<string>();
      owners.add(dataset.datasetId);
      references.set(hash, owners);
    }
  }

  const usageFor = (hashes: ReadonlySet<string>): DatasetStorageUsage => {
    let cachedBytes = 0;
    let cachedAssets = 0;
    let exclusiveBytes = 0;
    let exclusiveAssets = 0;
    let sharedBytes = 0;
    let sharedAssets = 0;
    for (const hash of hashes) {
      const bytes = assetSizes.get(hash);
      if (bytes === undefined) continue;
      cachedBytes += bytes;
      cachedAssets++;
      const owners = references.get(hash);
      if (owners?.size === 1) {
        exclusiveBytes += bytes;
        exclusiveAssets++;
      } else if ((owners?.size ?? 0) > 1) {
        sharedBytes += bytes;
        sharedAssets++;
      }
    }
    return {
      cachedBytes,
      cachedAssets,
      exclusiveBytes,
      exclusiveAssets,
      sharedBytes,
      sharedAssets
    };
  };

  const byDataset: Record<string, DatasetStorageUsage> = {};
  let logicalBytes = 0;
  for (const [datasetId, hashes] of hashesByDataset) {
    const usage = usageFor(hashes);
    byDataset[datasetId] = usage;
    logicalBytes += usage.cachedBytes;
  }

  let referencedBytes = 0;
  let sharedSavingsBytes = 0;
  let sharedAssets = 0;
  for (const [hash, owners] of references) {
    const bytes = assetSizes.get(hash);
    if (bytes === undefined) continue;
    referencedBytes += bytes;
    if (owners.size > 1) {
      sharedAssets++;
      sharedSavingsBytes += bytes * (owners.size - 1);
    }
  }

  let untrackedBytes = 0;
  let untrackedAssets = 0;
  for (const [hash, bytes] of assetSizes) {
    if (!references.has(hash)) {
      untrackedBytes += bytes;
      untrackedAssets++;
    }
  }

  return {
    logicalBytes,
    referencedBytes,
    sharedSavingsBytes,
    untrackedBytes,
    sharedAssets,
    untrackedAssets,
    byDataset
  };
}

function assetByteLength(record: unknown): number | undefined {
  if (record === null || typeof record !== 'object') return undefined;
  const value = record as { bytes?: unknown; byteLength?: unknown };
  const bytes = value.bytes;
  const actualLength = bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes)
    ? bytes.byteLength
    : undefined;
  if (actualLength === undefined) return undefined;
  if (Number.isSafeInteger(value.byteLength) && value.byteLength === actualLength) {
    return value.byteLength;
  }
  return actualLength;
}

function assetIndexEntry(record: unknown): CachedAssetIndexEntry | undefined {
  if (record === null || typeof record !== 'object') return undefined;
  const value = record as { sha256?: unknown };
  const byteLength = assetByteLength(record);
  return typeof value.sha256 === 'string'
    && byteLength !== undefined
    ? { sha256: value.sha256, byteLength }
    : undefined;
}

async function migrateAssetIndex(
  transaction: IDBPTransaction<unknown, string[], 'versionchange'>
): Promise<void> {
  const assets = transaction.objectStore(ASSET_STORE);
  const index = transaction.objectStore(ASSET_INDEX_STORE);
  let cursor = await assets.openCursor();
  while (cursor) {
    const entry = assetIndexEntry(cursor.value);
    if (entry) await index.put(entry);
    cursor = await cursor.continue();
  }
}

function database() {
  databasePromise ??= openDB(DB_NAME, DATABASE_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (!db.objectStoreNames.contains(DATASET_STORE)) {
        db.createObjectStore(DATASET_STORE, { keyPath: 'datasetId' });
      }
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE, { keyPath: 'sha256' });
      }
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        db.createObjectStore(METADATA_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(ASSET_INDEX_STORE)) {
        db.createObjectStore(ASSET_INDEX_STORE, { keyPath: 'sha256' });
      }
      if (db.objectStoreNames.contains(LEGACY_CATALOG_STORE)) {
        db.deleteObjectStore(LEGACY_CATALOG_STORE);
      }
      if (oldVersion < DATABASE_VERSION) void migrateAssetIndex(transaction);
    }
  });
  return databasePromise;
}

export async function listDatasets(): Promise<DatasetState[]> {
  if (!('indexedDB' in globalThis)) return [];
  return (await database()).getAll(DATASET_STORE);
}

export async function getDataset(datasetId: string): Promise<DatasetState | null> {
  if (!('indexedDB' in globalThis)) return null;
  return await (await database()).get(DATASET_STORE, datasetId) ?? null;
}

export async function saveDataset(dataset: DatasetState): Promise<void> {
  await (await database()).put(DATASET_STORE, dataset);
}

export async function activateDataset(datasetId: string): Promise<void> {
  const db = await database();
  const transaction = db.transaction(DATASET_STORE, 'readwrite');
  const store = transaction.objectStore(DATASET_STORE);
  const datasets = await store.getAll() as DatasetState[];
  for (const dataset of activeDatasetSnapshot(datasets, datasetId)) await store.put(dataset);
  await transaction.done;
}

export async function removeDataset(datasetId: string): Promise<void> {
  const db = await database();
  const transaction = db.transaction([DATASET_STORE, ASSET_STORE, ASSET_INDEX_STORE], 'readwrite');
  const datasets = await transaction.objectStore(DATASET_STORE).getAll() as DatasetState[];
  for (const hash of unreferencedDatasetAssets(datasets, datasetId)) {
    await transaction.objectStore(ASSET_STORE).delete(hash);
    await transaction.objectStore(ASSET_INDEX_STORE).delete(hash);
  }
  await transaction.objectStore(DATASET_STORE).delete(datasetId);
  await transaction.done;
}

/**
 * Remove candidate blobs which no longer belong to any installed dataset.
 *
 * This is separate from removeDataset because a legacy state can have the
 * same dataset ID as its replacement. In that case the replacement must be
 * written first, then the old state's hashes can be pruned without touching
 * blobs the new manifest still references.
 */
async function removeUnreferencedAssets(candidateHashes?: readonly string[]): Promise<void> {
  if (!('indexedDB' in globalThis)) return;
  const db = await database();
  const transaction = db.transaction([DATASET_STORE, ASSET_STORE, ASSET_INDEX_STORE], 'readwrite');
  const datasets = await transaction.objectStore(DATASET_STORE).getAll() as DatasetState[];
  const referenced = new Set(datasets.flatMap((dataset) => dataset.assetHashes ?? []));
  const candidates = candidateHashes ?? (await transaction.objectStore(ASSET_STORE).getAllKeys())
    .filter((key): key is string => typeof key === 'string');
  for (const hash of new Set(candidates)) {
    if (!referenced.has(hash)) {
      await transaction.objectStore(ASSET_STORE).delete(hash);
      await transaction.objectStore(ASSET_INDEX_STORE).delete(hash);
    }
  }
  await transaction.done;
}

/**
 * Finish the one-time replacement of every pre-current dataset row. The
 * caller must save the selected replacement row first so same-ID upgrades
 * retain its shared blobs. Other obsolete rows are removed, while hashes
 * owned by any current-format dataset remain referenced and cannot be pruned.
 */
export async function migrateLegacyDatasetStates(
  replacementDatasetId: string,
  legacyStates: readonly Pick<DatasetState, 'datasetId' | 'assetHashes'>[]
): Promise<void> {
  if (legacyStates.length === 0) return;
  for (const legacy of legacyStates) {
    if (legacy.datasetId !== replacementDatasetId) await removeDataset(legacy.datasetId);
  }
  // The app-specific object store may also contain blobs written by versions
  // whose old rows predate assetHashes bookkeeping. Once the replacement row
  // exists, every unowned blob is obsolete and can be removed safely.
  await removeUnreferencedAssets();
}

/** Record an on-demand asset in the owning dataset for accounting and cleanup. */
export async function recordDatasetAsset(
  datasetId: string,
  sha256: string,
  byteLength: number
): Promise<void> {
  if (!('indexedDB' in globalThis)
    || !Number.isSafeInteger(byteLength)
    || byteLength < 0) return;
  const db = await database();
  const transaction = db.transaction([DATASET_STORE, ASSET_STORE, ASSET_INDEX_STORE], 'readwrite');
  const asset = await transaction.objectStore(ASSET_STORE).get(sha256) as CachedAsset | undefined;
  const dataset = await transaction.objectStore(DATASET_STORE).get(datasetId) as DatasetState | undefined;
  const actualByteLength = assetByteLength(asset);
  if (!asset || actualByteLength !== byteLength || asset.sha256 !== sha256 || !dataset) {
    await transaction.done;
    return;
  }

  await transaction.objectStore(ASSET_INDEX_STORE).put({
    sha256,
    byteLength: actualByteLength
  } satisfies CachedAssetIndexEntry);
  const assetHashes = dataset.assetHashes ?? [];
  if (!assetHashes.includes(sha256)) {
    await transaction.objectStore(DATASET_STORE).put({
      ...dataset,
      cacheVersion: CURRENT_DATASET_CACHE_VERSION,
      status: dataset.status === 'catalog' ? 'partial' : dataset.status,
      storedBytes: dataset.storedBytes + actualByteLength,
      assetHashes: [...assetHashes, sha256],
      updatedAt: Date.now()
    });
  }
  await transaction.done;
}

export async function estimateStorage() {
  return navigator.storage?.estimate?.() ?? {};
}

export async function requestPersistentStorage(): Promise<boolean | undefined> {
  return navigator.storage?.persist?.();
}

export async function storageIsPersistent(): Promise<boolean | undefined> {
  return navigator.storage?.persisted?.();
}

export async function getCachedAsset(sha256: string): Promise<Uint8Array | null> {
  if (!('indexedDB' in globalThis)) return null;
  try {
    const record = await (await database()).get(ASSET_STORE, sha256) as CachedAsset | undefined;
    return record ? new Uint8Array(record.bytes) : null;
  } catch {
    return null;
  }
}

export async function cacheAsset(sha256: string, bytes: Uint8Array): Promise<void> {
  if (!('indexedDB' in globalThis)) throw new Error('IndexedDB is unavailable');
  const stored = Uint8Array.from(bytes).buffer;
  const db = await database();
  const transaction = db.transaction([ASSET_STORE, ASSET_INDEX_STORE], 'readwrite');
  await transaction.objectStore(ASSET_STORE).put({
    sha256,
    bytes: stored,
    byteLength: stored.byteLength,
    cachedAt: Date.now()
  } satisfies CachedAsset);
  await transaction.objectStore(ASSET_INDEX_STORE).put({
    sha256,
    byteLength: stored.byteLength
  } satisfies CachedAssetIndexEntry);
  await transaction.done;
}

/** Physical bytes currently held by the global SHA-keyed browser asset cache. */
export async function cachedAssetStats(): Promise<{ bytes: number; assets: number }> {
  const sizes = await cachedAssetSizes();
  let bytes = 0;
  for (const value of sizes.values()) bytes += value;
  return { bytes, assets: sizes.size };
}

export async function cachedAssetSizes(): Promise<Map<string, number>> {
  if (!('indexedDB' in globalThis)) return new Map();
  try {
    const db = await database();
    const transaction = db.transaction([ASSET_INDEX_STORE, ASSET_STORE], 'readonly');
    const [records, physicalKeys] = await Promise.all([
      transaction.objectStore(ASSET_INDEX_STORE).getAll() as Promise<CachedAssetIndexEntry[]>,
      transaction.objectStore(ASSET_STORE).getAllKeys() as Promise<IDBValidKey[]>
    ]);
    await transaction.done;
    const physical = new Set(physicalKeys.filter((key): key is string => typeof key === 'string'));
    return new Map(records
      .filter((record) => physical.has(record.sha256)
        && Number.isSafeInteger(record.byteLength)
        && record.byteLength >= 0)
      .map((record) => [record.sha256, record.byteLength]));
  } catch {
    return new Map();
  }
}

export async function removeCachedAsset(sha256: string): Promise<void> {
  if (!('indexedDB' in globalThis)) return;
  try {
    const db = await database();
    const transaction = db.transaction([ASSET_STORE, ASSET_INDEX_STORE], 'readwrite');
    await transaction.objectStore(ASSET_STORE).delete(sha256);
    await transaction.objectStore(ASSET_INDEX_STORE).delete(sha256);
    await transaction.done;
  } catch {
    // A corrupt cache entry will simply be ignored on subsequent loads.
  }
}

export async function getCachedMetadata<T>(key: string): Promise<{ url: string; value: T } | null> {
  if (!('indexedDB' in globalThis)) return null;
  try {
    const record = await (await database()).get(METADATA_STORE, key) as CachedMetadata | undefined;
    return record ? { url: record.url, value: record.value as T } : null;
  } catch {
    return null;
  }
}

export async function cacheMetadata(key: string, url: string, value: unknown): Promise<void> {
  if (!('indexedDB' in globalThis)) return;
  try {
    await (await database()).put(METADATA_STORE, {
      key,
      url,
      value,
      cachedAt: Date.now()
    } satisfies CachedMetadata);
  } catch (error) {
    console.warn('Unable to persist dataset metadata', error);
  }
}
