import type { CatalogEntry } from './types';
import { buildCatalogSearchDocument, catalogDocumentMatches, parseCatalogSearchQuery, scoreCatalogDocument } from './catalogSearch';
export { normalize } from './searchNormalization';

export function searchCatalog(catalog: CatalogEntry[], rawQuery: string): CatalogEntry[] {
  const query = parseCatalogSearchQuery(rawQuery);
  return catalog.map(entry => ({ entry, document: buildCatalogSearchDocument({
    id: entry.id, name: entry.name, mod: entry.mod, members: [entry]
  }) })).filter(({ document }) => catalogDocumentMatches(document, query))
    .sort((a, b) => scoreCatalogDocument(b.document, query) - scoreCatalogDocument(a.document, query)
      || a.entry.name.localeCompare(b.entry.name))
    .map(({ entry }) => entry);
}
