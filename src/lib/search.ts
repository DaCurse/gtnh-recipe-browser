import type { CatalogEntry } from './types';
import {
  buildCatalogSearchDocument,
  catalogDocumentMatches,
  parseCatalogSearchQuery,
} from './catalogSearch';
import { compareCatalogOrder } from './catalogOrder';
export { normalize } from './searchNormalization';

export function searchCatalog(catalog: CatalogEntry[], rawQuery: string): CatalogEntry[] {
  const query = parseCatalogSearchQuery(rawQuery);
  return catalog
    .map((entry) => ({
      entry,
      document: buildCatalogSearchDocument({
        ...entry,
        members: [entry],
      }),
    }))
    .filter(({ document }) => catalogDocumentMatches(document, query))
    .sort((a, b) => compareCatalogOrder(a.entry, b.entry))
    .map(({ entry }) => entry);
}
