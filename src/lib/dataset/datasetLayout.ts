import type { DatasetAsset, DatasetManifest } from './datasetSchema';
import { recordPageSelections } from './recordPages';

type SharedPrefixFamily = 'goods' | 'oreDictionaries' | 'recipeTypes' | 'specialViews';

export function sharedPrefixIsPublished(
  manifest: DatasetManifest,
  family: SharedPrefixFamily,
  namespace: string,
  prefix: unknown,
): boolean {
  if (typeof prefix !== 'string') return false;
  const prefixes = manifest.sharedLayout?.prefixes;
  if (!prefixes) return false;
  const list =
    family === 'recipeTypes' || family === 'specialViews'
      ? prefixes[family]?.[namespace]
      : prefixes[family];
  return Array.isArray(list) && list.includes(prefix);
}

export function physicalDescriptorsFor(
  asset: DatasetAsset,
  recordPages: readonly DatasetAsset[],
): DatasetAsset[] {
  if (!asset.segments) return [asset];
  const pages = new Map(recordPages.map((page, index) => [index, page]));
  const result: DatasetAsset[] = [];
  const seen = new Set<string>();
  for (const [pageIndex] of recordPageSelections(asset)) {
    const page = pages.get(pageIndex);
    if (!page)
      throw new Error(
        `${asset.id}: record page index ${String(pageIndex)} is absent from the manifest`,
      );
    if (seen.has(page.sha256)) continue;
    result.push(page);
    seen.add(page.sha256);
  }
  return result;
}
