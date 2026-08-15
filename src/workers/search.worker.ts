import {
  buildCatalogSearchDocument,
  catalogDocumentMatches,
  parseCatalogSearchQuery,
  scoreCatalogDocument,
  type CatalogSearchDocument,
  type CatalogSearchEntry
} from '../lib/catalogSearch';

type WorkerRequest =
  | { type: 'init'; generation: number }
  | { type: 'append'; generation: number; catalog: CatalogSearchEntry[]; completed: number; total: number }
  | { type: 'appendDocuments'; generation: number; documents: CatalogSearchDocument[]; completed: number; total: number }
  | { type: 'finish'; generation: number }
  | { type: 'search'; generation: number; id: number; query: string; offset: number; limit: number };

let generation = 0;
let catalog: CatalogSearchDocument[] = [];
let lastQuery: string | null = null;
let lastMatches: CatalogSearchDocument[] = [];
let searchToken = 0;

function yieldToNewerRequests(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function search(
  request: Extract<WorkerRequest, { type: 'search' }>,
  token: number
): Promise<void> {
  if (request.query !== lastQuery) {
    const query = parseCatalogSearchQuery(request.query);
    const matches: CatalogSearchDocument[] = [];
    for (let start = 0; start < catalog.length; start += 1_000) {
      const end = Math.min(start + 1_000, catalog.length);
      for (let index = start; index < end; index += 1) {
        const entry = catalog[index]!;
        if (catalogDocumentMatches(entry, query)) matches.push(entry);
      }
      if (end < catalog.length) {
        await yieldToNewerRequests();
        if (token !== searchToken || request.generation !== generation) return;
      }
    }
    matches.sort((left, right) =>
      scoreCatalogDocument(right, query) - scoreCatalogDocument(left, query)
      || left.name.localeCompare(right.name)
    );
    if (token !== searchToken || request.generation !== generation) return;
    lastQuery = request.query;
    lastMatches = matches;
  }

  self.postMessage({
    type: 'results',
    generation: request.generation,
    id: request.id,
    offset: request.offset,
    total: lastMatches.length,
    ids: lastMatches
      .slice(request.offset, request.offset + request.limit)
      .map((entry) => entry.id)
  });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'init') {
    generation = request.generation;
    catalog = [];
    lastQuery = null;
    lastMatches = [];
    searchToken += 1;
    return;
  }
  if (request.generation !== generation) return;
  if (request.type === 'append') {
    catalog.push(...request.catalog.map(buildCatalogSearchDocument));
    self.postMessage({
      type: 'progress',
      generation,
      completed: request.completed,
      total: request.total
    });
    return;
  }
  if (request.type === 'appendDocuments') {
    catalog.push(...request.documents);
    self.postMessage({
      type: 'progress',
      generation,
      completed: request.completed,
      total: request.total
    });
    return;
  }
  if (request.type === 'finish') {
    self.postMessage({ type: 'ready', generation });
    return;
  }
  const token = ++searchToken;
  void search(request, token);
};
