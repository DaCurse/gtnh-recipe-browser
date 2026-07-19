import { openDB } from 'idb';
import type { DatasetState } from './types';

const DB_NAME = 'gtnh-recipe-browser';
const STORE = 'datasets';

function database() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE, { keyPath: 'datasetId' });
    }
  });
}

export async function listDatasets(): Promise<DatasetState[]> {
  if (!('indexedDB' in globalThis)) return [];
  return (await database()).getAll(STORE);
}

export async function saveDataset(dataset: DatasetState): Promise<void> {
  await (await database()).put(STORE, dataset);
}

export async function removeDataset(datasetId: string): Promise<void> {
  await (await database()).delete(STORE, datasetId);
}

export async function estimateStorage() {
  return navigator.storage?.estimate?.() ?? {};
}
