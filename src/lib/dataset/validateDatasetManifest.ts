import type { DatasetAsset, DatasetManifest } from './datasetSchema';
import { recordPageSelections } from './recordPages';

function validSharedPrefixMap(value: unknown): value is Record<string, string[]> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value as Record<string, unknown>).every(
      ([namespace, prefixes]) =>
        namespace.length > 0 &&
        Array.isArray(prefixes) &&
        prefixes.length > 0 &&
        prefixes.every((prefix) => typeof prefix === 'string' && /^[0-9a-f]{0,8}$/.test(prefix)) &&
        new Set(prefixes).size === prefixes.length,
    )
  );
}

function validSharedPrefixList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((prefix) => typeof prefix === 'string' && /^[0-9a-f]{0,8}$/.test(prefix)) &&
    new Set(value).size === value.length
  );
}

function isLogicalRecordAsset(asset: DatasetAsset): boolean {
  return asset.segments !== undefined;
}

export function validateDatasetManifest(manifest: DatasetManifest, datasetId: string): void {
  if (manifest.formatVersion !== 7) {
    throw new Error(
      `Unsupported pack manifest format ${String(manifest.formatVersion)}; only format 7 is supported`,
    );
  }
  if (!Array.isArray(manifest.recordPages) || manifest.recordPages.length === 0) {
    throw new Error(`Format-${manifest.formatVersion} manifest has no record pages`);
  }
  if (
    manifest.formatVersion === 7 &&
    (!Array.isArray(manifest.goodsDetailShards) ||
      !Array.isArray(manifest.ingredientGroupShards) ||
      manifest.goodsDetailShards.length === 0)
  )
    throw new Error('Format-7 manifest is missing lazy detail families');
  if (
    manifest.catalogAssets.some((asset) => !isLogicalRecordAsset(asset)) ||
    (manifest.goodsDetailShards ?? []).some((asset) => !isLogicalRecordAsset(asset)) ||
    (manifest.ingredientGroupShards ?? []).some((asset) => !isLogicalRecordAsset(asset)) ||
    manifest.recipeShards.some((asset) => !isLogicalRecordAsset(asset)) ||
    manifest.specialDataShards.some((asset) => !isLogicalRecordAsset(asset))
  ) {
    throw new Error(
      `Format-${manifest.formatVersion} logical assets must use record-page segments`,
    );
  }
  const recordPageHashes = new Set(manifest.recordPages.map((asset) => asset.sha256));
  if (
    recordPageHashes.size !== manifest.recordPages.length ||
    manifest.recordPages.some(
      (asset) =>
        !/^[a-f0-9]{64}$/.test(asset.sha256) ||
        !Number.isSafeInteger(asset.bytes) ||
        asset.bytes < 0 ||
        asset.encoding !== 'gzip' ||
        typeof asset.url !== 'string' ||
        asset.url.length === 0 ||
        asset.segments !== undefined,
    )
  ) {
    throw new Error(`Format-${manifest.formatVersion} manifest has invalid physical record pages`);
  }
  for (const asset of [
    ...manifest.catalogAssets,
    ...(manifest.goodsDetailShards ?? []),
    ...(manifest.ingredientGroupShards ?? []),
    ...manifest.recipeShards,
    ...manifest.specialDataShards,
  ]) {
    if (
      asset.encoding !== 'identity' ||
      asset.url !== '' ||
      !recordPageSelections(asset).every(
        ([pageIndex, first, count]) =>
          Number.isSafeInteger(pageIndex) &&
          pageIndex >= 0 &&
          pageIndex < manifest.recordPages.length &&
          Number.isSafeInteger(first) &&
          Number.isSafeInteger(count) &&
          first >= 0 &&
          count >= 1,
      )
    ) {
      throw new Error(`${asset.id}: invalid record-page logical descriptor`);
    }
  }
  if (manifest.formatVersion === 7) {
    const expectedFamilies = new Map<DatasetAsset, DatasetAsset['family']>([
      ...manifest.catalogAssets.map((asset) => [asset, 'bootstrap'] as const),
      ...manifest.goodsDetailShards!.map((asset) => [asset, 'goods-details'] as const),
      ...manifest.ingredientGroupShards!.map((asset) => [asset, 'ingredient-groups'] as const),
      ...manifest.recipeShards.map((asset) => [asset, 'recipes'] as const),
      ...manifest.specialDataShards.map((asset) => [asset, 'special'] as const),
    ]);
    for (const [asset, family] of expectedFamilies) {
      if (asset.family !== family) throw new Error(`${asset.id}: invalid load family`);
      for (const [pageIndex] of recordPageSelections(asset)) {
        if (manifest.recordPages[pageIndex]?.family !== family) {
          throw new Error(`${asset.id}: record page crosses load-family boundary`);
        }
      }
    }
  }
  {
    const layout = manifest.sharedLayout;
    if (
      !layout ||
      manifest.assetStore !== 'global-sha256' ||
      layout.schemaVersion !== 1 ||
      !/^[a-f0-9]{64}$/.test(layout.layoutSha256) ||
      !validSharedPrefixMap(layout.prefixes.recipeTypes) ||
      !validSharedPrefixList(layout.prefixes.goods) ||
      !validSharedPrefixList(layout.prefixes.oreDictionaries) ||
      !validSharedPrefixMap(layout.prefixes.specialViews)
    ) {
      throw new Error('Manifest is missing shared object-store metadata');
    }
    if (Object.values(layout.targets).some((bytes) => !Number.isInteger(bytes) || bytes < 1024)) {
      throw new Error('Manifest has invalid shared-layout targets');
    }
  }
  if (manifest.datasetId !== datasetId) throw new Error('Manifest dataset identity mismatch');
}
