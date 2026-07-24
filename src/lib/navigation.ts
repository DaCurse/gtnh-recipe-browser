import type { RecipeView } from './types';

export function itemListUrl(currentUrl: string | URL): URL {
  const url = new URL(currentUrl);
  url.searchParams.delete('item');
  url.searchParams.delete('view');
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
