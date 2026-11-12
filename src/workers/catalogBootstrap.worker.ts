import { prepareBootstrapCatalog } from '../lib/catalogBootstrap';
import type { DatasetManifest } from '../lib/datasetSchema';

self.onmessage = async (event: MessageEvent<{ manifest: DatasetManifest; manifestUrl: string }>) => {
  self.onmessage = null;
  try {
    const prepared = await prepareBootstrapCatalog(event.data.manifest, event.data.manifestUrl,
      (percent, stage) => self.postMessage({ type: 'progress', percent, stage }));
    const groups = [...prepared.resolved.ingredientGroups];
    self.postMessage({ type: 'header', counts: { entries: prepared.resolved.entries.length, groups: groups.length, browse: prepared.browseRows.length },
      recipeTypes: [...prepared.resolved.recipeTypes], specialViewTypes: prepared.specialViewTypes, specialServiceIcons: prepared.specialServiceIcons });
    // Bounded messages avoid a giant structured clone on the UI thread.
    for (const [type, rows] of [['entries', prepared.resolved.entries], ['groups', groups], ['browse', prepared.browseRows]] as const) {
      for (let start = 0; start < rows.length; start += 256) {
        // Backpressure keeps worker messages from flooding the UI event queue.
        const received = new Promise<void>(resolve => self.addEventListener('message', () => resolve(), { once: true }));
        self.postMessage({ type, rows: rows.slice(start, start + 256) });
        await received;
      }
    }
    self.postMessage({ type: 'done' });
  } catch (error) {
    self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};
