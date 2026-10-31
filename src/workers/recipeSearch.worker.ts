import {
  buildRecipeSearchDocument,
  matchesRecipeSearch,
  recipeSearchTerms,
  type RecipeSearchCatalogEntry,
  type RecipeSearchDocument,
  type RecipeSearchRecord
} from '../lib/recipeSearch';

type WorkerRequest =
  | { type: 'init'; generation: number }
  | { type: 'appendCatalog'; generation: number; catalog: RecipeSearchCatalogEntry[] }
  | { type: 'finishCatalog'; generation: number }
  | { type: 'reset'; generation: number }
  | { type: 'append'; generation: number; recipes: RecipeSearchRecord[] }
  | {
      type: 'search';
      generation: number;
      id: number;
      query: string;
      recipeType: string;
      offset: number;
      limit: number;
    };

let generation = 0;
let catalog = new Map<string, RecipeSearchCatalogEntry>();
let documentsById = new Map<string, RecipeSearchDocument>();
let recordsById = new Map<string, RecipeSearchRecord>();
let records: RecipeSearchRecord[] = [];
let recordsDirty = false;
let searchToken = 0;

function sortedRecords(): RecipeSearchRecord[] {
  if (recordsDirty) {
    records = [...recordsById.values()].sort(
      (left, right) => left.order - right.order || left.id.localeCompare(right.id)
    );
    recordsDirty = false;
  }
  return records;
}

function yieldToNewerRequests(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function search(
  request: Extract<WorkerRequest, { type: 'search' }>,
  token: number
): Promise<void> {
  const source = sortedRecords();
  const terms = recipeSearchTerms(request.query);
  const offset = Math.max(0, request.offset);
  const limit = Math.max(0, request.limit);
  const ids: string[] = [];
  let total = 0;

  for (let start = 0; start < source.length; start += 2_000) {
    const end = Math.min(start + 2_000, source.length);
    for (let index = start; index < end; index += 1) {
      const record = source[index]!;
      if (record.type !== request.recipeType) continue;
      if (terms.length) {
        let document = documentsById.get(record.id);
        if (!document) {
          document = buildRecipeSearchDocument(record, catalog);
          documentsById.set(record.id, document);
        }
        if (!matchesRecipeSearch(document, request.recipeType, terms)) continue;
      }
      if (total >= offset && ids.length < limit) ids.push(record.id);
      total += 1;
    }
    if (end < source.length) {
      await yieldToNewerRequests();
      if (token !== searchToken || request.generation !== generation) return;
    }
  }

  if (token !== searchToken || request.generation !== generation) return;
  self.postMessage({
    type: 'results',
    generation: request.generation,
    id: request.id,
    total,
    ids
  });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'init') {
    if (request.generation < generation) return;
    generation = request.generation;
    catalog = new Map();
    documentsById = new Map();
    recordsById = new Map();
    records = [];
    recordsDirty = false;
    searchToken += 1;
    return;
  }
  if (request.type === 'reset') {
    if (request.generation < generation) return;
    generation = request.generation;
    documentsById = new Map();
    recordsById = new Map();
    records = [];
    recordsDirty = false;
    searchToken += 1;
    return;
  }
  if (request.generation !== generation) return;
  if (request.type === 'appendCatalog') {
    for (const entry of request.catalog) catalog.set(entry.id, entry);
    return;
  }
  if (request.type === 'finishCatalog') {
    self.postMessage({ type: 'catalogReady', generation });
    return;
  }
  if (request.type === 'append') {
    for (const recipe of request.recipes) {
      recordsById.set(recipe.id, recipe);
      documentsById.delete(recipe.id);
    }
    recordsDirty = true;
    searchToken += 1;
    return;
  }

  const token = ++searchToken;
  void search(request, token);
};
