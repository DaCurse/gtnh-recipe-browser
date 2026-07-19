import type { CatalogEntry } from '../lib/types';
import { searchCatalog } from '../lib/search';

self.onmessage = (event: MessageEvent<{ id: number; query: string; catalog: CatalogEntry[] }>) => {
  const { id, query, catalog } = event.data;
  self.postMessage({ id, results: searchCatalog(catalog, query) });
};
