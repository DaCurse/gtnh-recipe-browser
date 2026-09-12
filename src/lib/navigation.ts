import type { RecipeView, SpecialScope } from './types';

export interface SpecialNavigation {
  specialType: string;
  specialScope: SpecialScope;
}

export function catalogSearchFromUrl(
  currentUrl: string | URL | URLSearchParams
): string {
  const params = currentUrl instanceof URLSearchParams
    ? currentUrl
    : new URL(currentUrl).searchParams;
  return params.get('search') ?? '';
}

export function catalogSearchUrl(
  currentUrl: string | URL,
  query: string
): URL {
  const url = new URL(currentUrl);
  const normalizedQuery = query.trim();
  if (normalizedQuery) url.searchParams.set('search', normalizedQuery);
  else url.searchParams.delete('search');
  return url;
}

export function recipeFilterFromUrl(
  currentUrl: string | URL | URLSearchParams
): string {
  const params = currentUrl instanceof URLSearchParams
    ? currentUrl
    : new URL(currentUrl).searchParams;
  return params.get('recipe-filter') ?? '';
}

export function recipeFilterUrl(
  currentUrl: string | URL,
  query: string
): URL {
  const url = new URL(currentUrl);
  const normalizedQuery = query.trim();
  if (normalizedQuery) url.searchParams.set('recipe-filter', normalizedQuery);
  else url.searchParams.delete('recipe-filter');
  return url;
}

export function itemListUrl(currentUrl: string | URL): URL {
  const url = new URL(currentUrl);
  url.searchParams.delete('item');
  url.searchParams.delete('view');
  url.searchParams.delete('special');
  url.searchParams.delete('special-scope');
  url.searchParams.delete('recipe-filter');
  return url;
}

export function recipeViewUrlValue(view: RecipeView): string {
  return view === 'machineUsages' ? 'machine-usages' : view;
}

export function recipeViewFromUrl(value: string | null): RecipeView {
  if (value === 'usages') return 'usages';
  if (value === 'machine-usages') return 'machineUsages';
  return 'recipes';
}

function specialTypeFromUrl(value: string | null): string {
  return value?.trim() ?? '';
}

function specialTypeUrlValue(value: string): string {
  return value.trim();
}

function specialScopeFromUrl(value: string | null): SpecialScope {
  return value === 'all' ? 'all' : 'item';
}

function specialScopeUrlValue(value: SpecialScope): string | undefined {
  return value === 'all' ? 'all' : undefined;
}

export function specialNavigationFromUrl(
  currentUrl: string | URL | URLSearchParams
): SpecialNavigation {
  const params = currentUrl instanceof URLSearchParams
    ? currentUrl
    : new URL(currentUrl).searchParams;
  const specialType = specialTypeFromUrl(params.get('special'));
  return {
    specialType,
    specialScope: specialType ? specialScopeFromUrl(params.get('special-scope')) : 'item'
  };
}

export function specialNavigationUrl(
  currentUrl: string | URL,
  specialType: string,
  specialScope: SpecialScope = 'item'
): URL {
  const url = new URL(currentUrl);
  const normalizedType = specialTypeUrlValue(specialType);
  if (!normalizedType) {
    url.searchParams.delete('special');
    url.searchParams.delete('special-scope');
    return url;
  }
  url.searchParams.set('special', normalizedType);
  const scope = specialScopeUrlValue(specialScope);
  if (scope) url.searchParams.set('special-scope', scope);
  else url.searchParams.delete('special-scope');
  return url;
}
