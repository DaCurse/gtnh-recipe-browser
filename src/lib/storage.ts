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

export async function saveDataset(dataset: DatasetState): Promise<void> {
  await (await database()).put(DATASET_STORE, dataset);
}

export async function removeDataset(datasetId: string): Promise<void> {
  await (await database()).delete(DATASET_STORE, datasetId);
}

export async function estimateStorage() {
  return navigator.storage?.estimate?.() ?? {};
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
  if (!('indexedDB' in globalThis)) return;
  try {
    const stored = Uint8Array.from(bytes).buffer;
    await (await database()).put(ASSET_STORE, {
      sha256,
      bytes: stored,
      byteLength: bytes.byteLength,
      cachedAt: Date.now()
    } satisfies CachedAsset);
  } catch (error) {
    console.warn('Unable to persist verified dataset asset', error);
  }
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
