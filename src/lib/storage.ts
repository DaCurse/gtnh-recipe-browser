import { openDB } from 'idb';
import type { DatasetState } from './types';

const DB_NAME = 'gtnh-recipe-browser';
const DATASET_STORE = 'datasets';
const ASSET_STORE = 'assets';
const METADATA_STORE = 'metadata';

interface CachedAsset {
  sha256: string;
  bytes: ArrayBuffer;
  byteLength: number;
  cachedAt: number;
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

function database() {
  databasePromise ??= openDB(DB_NAME, 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(DATASET_STORE)) {
        db.createObjectStore(DATASET_STORE, { keyPath: 'datasetId' });
      }
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE, { keyPath: 'sha256' });
      }
      if (!db.objectStoreNames.contains(METADATA_STORE)) {
        db.createObjectStore(METADATA_STORE, { keyPath: 'key' });
      }
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
  return (await database()).get(DATASET_STORE, datasetId) ?? null;
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
  const transaction = db.transaction([DATASET_STORE, ASSET_STORE], 'readwrite');
  const datasets = await transaction.objectStore(DATASET_STORE).getAll() as DatasetState[];
  for (const hash of unreferencedDatasetAssets(datasets, datasetId)) {
    await transaction.objectStore(ASSET_STORE).delete(hash);
  }
  await transaction.objectStore(DATASET_STORE).delete(datasetId);
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

export async function hasCachedAsset(sha256: string, byteLength?: number): Promise<boolean> {
  if (!('indexedDB' in globalThis)) return false;
  try {
    const record = await (await database()).get(ASSET_STORE, sha256) as CachedAsset | undefined;
    return record !== undefined && (byteLength === undefined || record.byteLength === byteLength);
  } catch {
    return false;
  }
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
  await (await database()).put(ASSET_STORE, {
    sha256,
    bytes: stored,
    byteLength: bytes.byteLength,
    cachedAt: Date.now()
  } satisfies CachedAsset);
}

export async function removeCachedAsset(sha256: string): Promise<void> {
  if (!('indexedDB' in globalThis)) return;
  try {
    await (await database()).delete(ASSET_STORE, sha256);
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
