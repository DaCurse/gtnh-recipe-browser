import { catalogNameForId, withCatalogName, namesForIds } from './catalogNames';
import { decorateSpecialRecord } from './specialRecords';
import {
  buildRecipeSearchDocument,
  recipeSearchTerms,
  toRecipeSearchCatalogEntry,
  toRecipeSearchRecord,
} from '../recipes/recipeSearch';
import { specialSearchText, type SpecialRecord } from '../special/specialData';
import type { CatalogEntry, Ingredient, Recipe, RecipeView } from '../types';

const BROWSER_EXPORT_SCHEMA_VERSION = 1 as const;

type BrowserExportKind = 'recipes' | 'special';
type BrowserExportScope = 'pane' | 'machine' | 'special-global';

interface BrowserExportDataset {
  datasetId: string;
  gtnhVersion: string;
  revision: string;
}

interface BrowserExportSelection {
  id: string;
  name: string;
  kind: CatalogEntry['kind'];
}

interface BrowserExportFilter {
  query: string;
  applied: boolean;
}

interface BrowserExportSpecialViewType {
  id: string;
  label: string;
}

export interface BrowserExportEnvelope<
  TRecord extends Recipe | SpecialRecord = Recipe | SpecialRecord,
> {
  schemaVersion: typeof BROWSER_EXPORT_SCHEMA_VERSION;
  kind: BrowserExportKind;
  dataset: BrowserExportDataset;
  selection: BrowserExportSelection;
  view: RecipeView;
  scope: BrowserExportScope;
  recipeType: string | null;
  specialViewType: BrowserExportSpecialViewType | null;
  filter: BrowserExportFilter;
  records: TRecord[];
}

export interface BrowserExportRepository {
  datasetId: string;
  gtnhVersion: string;
  revision: string;
  entries: readonly CatalogEntry[];
}

interface BrowserExportBaseOptions {
  repository: BrowserExportRepository;
  selected: BrowserExportSelection | CatalogEntry;
  view: RecipeView;
  scope: BrowserExportScope;
  recipeType?: string | null;
  specialViewType?: BrowserExportSpecialViewType | null;
  query?: string;
  applied?: boolean;
}

export interface RecipeExportOptions extends BrowserExportBaseOptions {
  kind?: 'recipes';
  records: readonly Recipe[];
}

export interface SpecialExportOptions extends BrowserExportBaseOptions {
  kind?: 'special';
  records: readonly SpecialRecord[];
}

function compareStableOrder(
  left: { id: string; order?: number },
  right: { id: string; order?: number },
): number {
  return (
    (left.order ?? 0) - (right.order ?? 0) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

function ordered<T extends { id: string; order?: number }>(records: readonly T[]): T[] {
  return [...records].sort(compareStableOrder);
}

function selectionOf(selected: BrowserExportSelection | CatalogEntry): BrowserExportSelection {
  return {
    id: selected.id,
    name: selected.name,
    kind: selected.kind,
  };
}

function filterOf(query: string | undefined, applied: boolean | undefined): BrowserExportFilter {
  const normalizedQuery = query ?? '';
  return {
    query: normalizedQuery,
    applied: applied ?? normalizedQuery.trim().length > 0,
  };
}

function datasetOf(repository: BrowserExportRepository): BrowserExportDataset {
  return {
    datasetId: repository.datasetId,
    gtnhVersion: repository.gtnhVersion,
    revision: repository.revision,
  };
}

function catalogNames(repository: BrowserExportRepository): ReadonlyMap<string, string> {
  return new Map(
    repository.entries
      .filter((entry) => entry.name.trim().length > 0)
      .map((entry) => [entry.id, entry.name]),
  );
}

function decorateIngredient(
  ingredient: Ingredient,
  names: ReadonlyMap<string, string>,
): Ingredient {
  return {
    ...withCatalogName(ingredient, ingredient.id, names),
    ...(ingredient.ingredientGroupId
      ? { ingredientGroupName: catalogNameForId(ingredient.ingredientGroupId, names) }
      : {}),
    ...(ingredient.alternatives !== undefined
      ? { alternativeNames: namesForIds(ingredient.alternatives, names) }
      : {}),
  };
}

function decorateRecipe(recipe: Recipe, names: ReadonlyMap<string, string>): Recipe {
  return {
    ...recipe,
    inputs: recipe.inputs.map((ingredient) => decorateIngredient(ingredient, names)),
    outputs: recipe.outputs.map((ingredient) => decorateIngredient(ingredient, names)),
    ...(recipe.crafterId !== undefined
      ? { crafterName: catalogNameForId(recipe.crafterId, names) }
      : {}),
    ...(recipe.crafters !== undefined
      ? { crafters: recipe.crafters.map((crafter) => withCatalogName(crafter, crafter.id, names)) }
      : {}),
    ...(recipe.typeIconId !== undefined
      ? { typeIconName: catalogNameForId(recipe.typeIconId, names) }
      : {}),
  };
}

export function createRecipeExport(options: RecipeExportOptions): BrowserExportEnvelope<Recipe> {
  const names = catalogNames(options.repository);
  return {
    schemaVersion: BROWSER_EXPORT_SCHEMA_VERSION,
    kind: 'recipes',
    dataset: datasetOf(options.repository),
    selection: selectionOf(options.selected),
    view: options.view,
    scope: options.scope,
    recipeType: options.recipeType ?? null,
    specialViewType: null,
    filter: filterOf(options.query, options.applied),
    records: ordered(options.records).map((recipe) => decorateRecipe(recipe, names)),
  };
}

export function createSpecialExport(
  options: SpecialExportOptions,
): BrowserExportEnvelope<SpecialRecord> {
  const names = catalogNames(options.repository);
  return {
    schemaVersion: BROWSER_EXPORT_SCHEMA_VERSION,
    kind: 'special',
    dataset: datasetOf(options.repository),
    selection: selectionOf(options.selected),
    view: options.view,
    scope: options.scope,
    recipeType: null,
    specialViewType: options.specialViewType ?? null,
    filter: filterOf(options.query, options.applied),
    records: ordered(options.records).map((record) => decorateSpecialRecord(record, names)),
  };
}

function recipeSearchDocuments(repository: BrowserExportRepository, records: readonly Recipe[]) {
  const catalog = new Map(
    repository.entries.map((entry) => [entry.id, toRecipeSearchCatalogEntry(entry)]),
  );
  return new Map(
    records.map((recipe) => [
      recipe.id,
      buildRecipeSearchDocument(toRecipeSearchRecord(recipe), catalog),
    ]),
  );
}

/** Select complete or filtered materialized recipe records for a download. */
export function recipeRecordsForExport(
  repository: BrowserExportRepository,
  records: readonly Recipe[],
  recipeType: string | null,
  query: string,
  applied: boolean,
): Recipe[] {
  const source = ordered(records);
  if (!applied) return source;
  const terms = recipeSearchTerms(query);
  const documents = recipeSearchDocuments(repository, source);
  return source.filter((recipe) => {
    if (recipeType !== null && recipe.type !== recipeType) return false;
    const document = documents.get(recipe.id);
    return document !== undefined && terms.every((term) => document.haystack.includes(term));
  });
}

/** Select complete or filtered materialized special records for a download. */
export function specialRecordsForExport(
  records: readonly SpecialRecord[],
  query: string,
  applied: boolean,
): SpecialRecord[] {
  const source = ordered(records);
  if (!applied) return source;
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return source.filter((record) => {
    const text = specialSearchText(record);
    return terms.every((term) => text.includes(term));
  });
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value === null || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, stableJsonValue(object[key])]),
  );
}

/** Serialize an export with deterministic object-key and record ordering. */
export function serializeBrowserExport(value: BrowserExportEnvelope): string {
  return `${JSON.stringify(stableJsonValue(value), null, 2)}\n`;
}

function sanitizeExportFilename(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return normalized || 'export';
}

const RECIPE_VIEW_FILENAME: Record<RecipeView, string> = {
  recipes: 'recipes',
  usages: 'usages',
  machineUsages: 'machine-usages',
};

export function browserExportFilename(value: BrowserExportEnvelope): string {
  if (value.scope === 'special-global') {
    const view = sanitizeExportFilename(value.specialViewType?.id ?? 'special');
    return `gtnh-special-global-${view}.json`;
  }
  const selection = sanitizeExportFilename(value.selection.name || value.selection.id);
  const recipeSubject =
    value.kind === 'recipes' && value.recipeType
      ? sanitizeExportFilename(value.recipeType)
      : selection;
  const view =
    value.kind === 'special'
      ? sanitizeExportFilename(value.specialViewType?.id ?? 'special')
      : RECIPE_VIEW_FILENAME[value.view];
  return `gtnh-${recipeSubject}-${view}.json`;
}

/** Download through a short-lived JSON Blob so packed shard bytes never leak into the export. */
export function downloadBrowserExport(
  value: BrowserExportEnvelope,
  filename = browserExportFilename(value),
): string {
  const blob = new Blob([serializeBrowserExport(value)], {
    type: 'application/json;charset=utf-8',
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = sanitizeExportFilename(filename.replace(/\.json$/i, '')) + '.json';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  return anchor.download;
}
