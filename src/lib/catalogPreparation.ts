import type { DatasetManifest } from './datasetSchema';
import type { PreparedCatalog } from './preparedCatalogCache';
import type { CatalogBrowseEntry, CatalogEntry } from './types';
import { yieldToBrowser } from './datasetAssets';

export interface PreparedCatalogIndexes {
  entriesById: Map<string, CatalogEntry>;
  goodsIds: Set<string>;
  browseEntries: CatalogBrowseEntry[];
  browseById: Map<string, CatalogBrowseEntry>;
}

export async function catalogIndexes(prepared: PreparedCatalog): Promise<PreparedCatalogIndexes> {
  const entriesById = new Map<string, CatalogEntry>();
  const goodsIds = new Set<string>();
  const browseEntries: CatalogBrowseEntry[] = [];
  const browseById = new Map<string, CatalogBrowseEntry>();
  const batchSize = 512;
  let resumedAt = performance.now();
  const yieldIfBusy = async () => {
    if (performance.now() - resumedAt < 8) return;
    await yieldToBrowser();
    resumedAt = performance.now();
  };
  for (let start = 0; start < prepared.resolved.entries.length; start += batchSize) {
    for (const entry of prepared.resolved.entries.slice(start, start + batchSize)) {
      entriesById.set(entry.id, entry);
      if (entry.kind === 'item' || entry.kind === 'fluid') goodsIds.add(entry.id);
    }
    await yieldIfBusy();
  }
  for (let start = 0; start < prepared.browseRows.length; start += batchSize) {
    for (const row of prepared.browseRows.slice(start, start + batchSize)) {
      const representative = entriesById.get(row.variantIds[0]!);
      if (!representative) throw new Error(`Unknown catalogue representative: ${row.id}`);
      const entry = { ...representative, ...row };
      browseEntries.push(entry);
      browseById.set(entry.id, entry);
    }
    await yieldIfBusy();
  }
  return { entriesById, goodsIds, browseEntries, browseById };
}

/** The dataset owns this job; switching views must never cancel it. */
export async function prepareCatalog(
  manifest: DatasetManifest,
  manifestUrl: string,
  report: (percent: number, stage: string) => void,
): Promise<PreparedCatalog> {
  if (typeof Worker === 'undefined') {
    const { prepareBootstrapCatalog } = await import('./catalogBootstrap');
    return prepareBootstrapCatalog(manifest, manifestUrl, report);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/catalogBootstrap.worker.ts', import.meta.url), {
      type: 'module',
    });
    let prepared: PreparedCatalog | undefined;
    let counts: { entries: number; groups: number; browse: number } | undefined;
    const fail = (error: unknown) => {
      worker.terminate();
      reject(error);
    };
    worker.onerror = (event) =>
      fail(new Error(event.message || 'Catalogue preparation worker failed'));
    worker.onmessageerror = () => fail(new Error('Unable to read prepared catalogue'));
    worker.onmessage = (event) => {
      const message = event.data;
      try {
        if (message.type === 'progress') {
          report(message.percent, message.stage);
          return;
        }
        if (message.type === 'error') {
          fail(new Error(message.error));
          return;
        }
        if (message.type === 'header') {
          counts = message.counts;
          prepared = {
            resolved: {
              entries: [],
              recipeTypes: new Map(message.recipeTypes),
              ingredientGroups: new Map(),
            },
            browseRows: [],
            specialViewTypes: message.specialViewTypes,
            specialServiceIcons: message.specialServiceIcons,
          };
          return;
        }
        if (!prepared || !counts) throw new Error('Missing catalogue preparation header');
        if (message.type === 'entries') prepared.resolved.entries.push(...message.rows);
        else if (message.type === 'browse') prepared.browseRows.push(...message.rows);
        else if (message.type === 'groups')
          for (const [id, group] of message.rows) prepared.resolved.ingredientGroups.set(id, group);
        else if (message.type === 'done') {
          if (
            prepared.resolved.entries.length !== counts.entries ||
            prepared.browseRows.length !== counts.browse ||
            prepared.resolved.ingredientGroups.size !== counts.groups
          )
            throw new Error('Incomplete prepared catalogue');
          worker.terminate();
          resolve(prepared);
          return;
        } else throw new Error('Unexpected catalogue preparation response');
        // Let input, paint, and timers run before accepting another batch.
        setTimeout(() => worker.postMessage({ type: 'next' }), 0);
      } catch (error) {
        fail(error);
      }
    };
    worker.postMessage({ manifest, manifestUrl });
  });
}
