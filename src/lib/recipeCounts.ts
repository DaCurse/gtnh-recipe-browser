import { isSpecialViewEnabled } from './specialData';
import type { CatalogEntry, RecipeView } from './types';

/** Counts describe the whole direction, including its enabled NEI pages. */
export function recipeViewCount(
  entry: CatalogEntry,
  view: RecipeView,
  ordinaryCount?: number,
  nativeOreCount = 0,
): number | undefined {
  if (view === 'machineUsages') return ordinaryCount;
  const ordinary = ordinaryCount ?? (view === 'recipes' ? entry.productionCount : entry.usageCount);
  const categories = view === 'recipes' ? entry.specialProductionCounts : entry.specialUsageCounts;
  const special = categories
    ? Object.entries(categories).reduce(
        (total, [id, count]) => total + (isSpecialViewEnabled(id) ? count : 0),
        0,
      )
    : ((view === 'recipes' ? entry.specialProductionCount : entry.specialUsageCount) ?? 0);
  const totalSpecial = special + nativeOreCount;
  return ordinary === undefined
    ? totalSpecial > 0
      ? totalSpecial
      : undefined
    : ordinary + totalSpecial;
}
