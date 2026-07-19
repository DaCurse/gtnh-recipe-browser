import {
  buildRecipeSearchDocument,
  matchesRecipeSearch,
  recipeSearchTerms,
  type RecipeSearchCatalogEntry,
  type RecipeSearchDocument,
  type RecipeSearchRecord
} from '../lib/recipeSearch';

type WorkerRequest =
  | { type: 'init'; generation: number; catalog: RecipeSearchCatalogEntry[] }
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
let documents: RecipeSearchDocument[] = [];
let documentsDirty = false;
let searchToken = 0;

function sortedDocuments(): RecipeSearchDocument[] {
  if (documentsDirty) {
    documents = [...documentsById.values()].sort(
      (left, right) => left.order - right.order || left.id.localeCompare(right.id)
    );
    documentsDirty = false;
  }
  return documents;
}

function yieldToNewerRequests(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function search(
  request: Extract<WorkerRequest, { type: 'search' }>,
  token: number
): Promise<void> {
  const source = sortedDocuments();
  const terms = recipeSearchTerms(request.query);
  const offset = Math.max(0, request.offset);
  const limit = Math.max(0, request.limit);
  const ids: string[] = [];
  let total = 0;

  for (let start = 0; start < source.length; start += 2_000) {
    const end = Math.min(start + 2_000, source.length);
    for (let index = start; index < end; index += 1) {
      const document = source[index]!;
      if (!matchesRecipeSearch(document, request.recipeType, terms)) continue;
      if (total >= offset && ids.length < limit) ids.push(document.id);
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
    generation = request.generation;
    catalog = new Map(request.catalog.map((entry) => [entry.id, entry]));
    documentsById = new Map();
    documents = [];
    documentsDirty = false;
    searchToken += 1;
    return;
  }
  if (request.type === 'reset') {
    generation = request.generation;
    documentsById = new Map();
    documents = [];
    documentsDirty = false;
    searchToken += 1;
    return;
  }
  if (request.generation !== generation) return;
  if (request.type === 'append') {
    for (const recipe of request.recipes) {
      documentsById.set(recipe.id, buildRecipeSearchDocument(recipe, catalog));
    }
    documentsDirty = true;
    searchToken += 1;
    return;
  }

  const token = ++searchToken;
  void search(request, token);
};
