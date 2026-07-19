import { normalize } from './search';
import type { CatalogEntry, Recipe } from './types';

export interface RecipeSearchCatalogEntry {
  id: string;
  name: string;
  mod: string;
  tooltip: string[];
}

export interface RecipeSearchRecord {
  id: string;
  type: string;
  order: number;
  ingredientIds: string[];
  details: Array<string | number>;
}

export interface RecipeSearchDocument {
  id: string;
  type: string;
  order: number;
  haystack: string;
}

export interface RecipeSearchResult {
  ids: string[];
  total: number;
}

export function toRecipeSearchCatalogEntry(entry: CatalogEntry): RecipeSearchCatalogEntry {
  return {
    id: entry.id,
    name: entry.name,
    mod: entry.mod,
    tooltip: entry.tooltip
  };
}

export function toRecipeSearchRecord(recipe: Recipe): RecipeSearchRecord {
  return {
    id: recipe.id,
    type: recipe.type,
    order: recipe.order ?? 0,
    ingredientIds: [...new Set(
      [...recipe.inputs, ...recipe.outputs].flatMap(
        (ingredient) => [ingredient.id, ...(ingredient.alternatives ?? [])]
      )
    )],
    details: [
      recipe.id,
      recipe.type,
      recipe.duration ?? '',
      recipe.voltage ?? '',
      recipe.voltageExact ?? '',
      recipe.amperage ?? '',
      recipe.eu ?? '',
      recipe.euExact ?? '',
      recipe.euPerTick ?? '',
      recipe.euPerTickExact ?? '',
      ...(recipe.metadata ?? []),
      recipe.note ?? '',
      recipe.specialValue ?? ''
    ]
  };
}

export function buildRecipeSearchDocument(
  recipe: RecipeSearchRecord,
  catalog: ReadonlyMap<string, RecipeSearchCatalogEntry>
): RecipeSearchDocument {
  const ingredients = recipe.ingredientIds.flatMap((id) => {
    const entry = catalog.get(id);
    return entry ? [id, entry.name, entry.mod, ...entry.tooltip] : [id];
  });
  return {
    id: recipe.id,
    type: recipe.type,
    order: recipe.order,
    haystack: normalize([...recipe.details, ...ingredients].join(' '))
  };
}

export function recipeSearchTerms(rawQuery: string): string[] {
  return normalize(rawQuery).split(/\s+/).filter(Boolean);
}

export function matchesRecipeSearch(
  document: RecipeSearchDocument,
  recipeType: string,
  terms: readonly string[]
): boolean {
  return document.type === recipeType && terms.every((term) => document.haystack.includes(term));
}

export function searchRecipeDocuments(
  documents: readonly RecipeSearchDocument[],
  recipeType: string,
  rawQuery: string,
  offset: number,
  limit: number
): RecipeSearchResult {
  const terms = recipeSearchTerms(rawQuery);
  const safeOffset = Math.max(0, offset);
  const safeLimit = Math.max(0, limit);
  const ids: string[] = [];
  let total = 0;
  for (const document of documents) {
    if (!matchesRecipeSearch(document, recipeType, terms)) continue;
    if (total >= safeOffset && ids.length < safeLimit) ids.push(document.id);
    total += 1;
  }
  return { ids, total };
}
