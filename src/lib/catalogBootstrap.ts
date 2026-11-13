import { applyCatalogOrder } from './catalogOrderIndex';
import { decode } from '@msgpack/msgpack';
import { decompress, decodePhysicalRecordPage, fetchVerified } from './datasetAssets';
import { goodsIdentityFromId } from './goodsIdentity';
import { physicalDescriptorsFor, sharedPrefixIsPublished } from './datasetLayout';
import { mapProgressively } from './progressive';
import { materializeCatalog } from './catalogMaterialization';
import { buildCatalogBrowseEntries } from './catalogVariants';
import type { PreparedCatalog } from './preparedCatalogCache';
import type { CatalogEntry } from './types';
import type {
  DatasetAsset,
  DatasetManifest,
  PackedCatalog,
  PackedCatalogCore,
  PackedCatalogGoods,
  PackedCatalogGoodsSearch,
  PackedCatalogRecipeRemaps,
  PackedCatalogRecipeTypes,
  PackedCatalogSpecialMetadata,
  PackedGoods,
} from './datasetSchema';

/** Bootstrap rows deliberately omit relations until their detail shards are requested. */
function clearBootstrapRelations(entries: CatalogEntry[]): void {
  for (const entry of entries) {
    entry.productionShards = undefined;
    entry.usageShards = undefined;
    entry.productionCount = undefined;
    entry.usageCount = undefined;
    entry.specialProductionShards = undefined;
    entry.specialUsageShards = undefined;
    entry.specialProductionLookupIds = undefined;
    entry.specialUsageLookupIds = undefined;
    entry.specialProductionCount = undefined;
    entry.specialUsageCount = undefined;
    entry.productionOreDictionaryId = undefined;
    entry.oreDictionaryIds = undefined;
    entry.machineCapabilities = undefined;
    entry.members = undefined;
  }
}

export async function prepareBootstrapCatalog(
  manifest: DatasetManifest,
  manifestUrl: string,
  report: (percent: number, stage: string) => void,
  readAsset?: (asset: DatasetAsset) => Promise<Uint8Array>,
): Promise<PreparedCatalog> {
  const { catalog } = await loadCatalogBootstrap(manifest, manifestUrl, report, readAsset);
  report(92, 'Preparing items');
  const resolved = materializeCatalog(manifest, manifestUrl, catalog, false);
  await applyCatalogOrder(resolved.entries, manifest, manifestUrl);
  clearBootstrapRelations(resolved.entries);
  const browse = buildCatalogBrowseEntries(resolved.entries);
  return {
    resolved: {
      entries: resolved.entries,
      recipeTypes: resolved.recipeTypes,
      ingredientGroups: resolved.ingredientGroups,
    },
    browseRows: browse.map(({ id, variantIds, variantCount, variantKind, variantLabels }) => ({
      id,
      variantIds,
      variantCount,
      variantKind,
      variantLabels,
    })),
    specialViewTypes: catalog.specialViewTypes,
    specialServiceIcons: catalog.specialServiceIcons,
  };
}

type DecodedBootstrapAsset =
  | PackedCatalogCore
  | PackedCatalogGoods
  | PackedCatalogGoodsSearch
  | PackedCatalogRecipeTypes
  | PackedCatalogRecipeRemaps
  | PackedCatalogSpecialMetadata;

async function decodeAssetPayload(asset: DatasetAsset, bytes: Uint8Array): Promise<unknown> {
  return decode(asset.encoding === 'gzip' ? await decompress(bytes) : bytes);
}

async function loadCatalogBootstrap(
  manifest: DatasetManifest,
  manifestUrl: string,
  report: (percent: number, stage: string) => void,
  readAsset?: (asset: DatasetAsset) => Promise<Uint8Array>,
): Promise<{ catalog: PackedCatalog }> {
  if (manifest.catalogAssets.length === 0) throw new Error('Pack manifest has no bootstrap assets');
  const assetsToDecode = manifest.catalogAssets;
  const pages = [
    ...new Map(
      assetsToDecode
        .flatMap((asset) => physicalDescriptorsFor(asset, manifest.recordPages))
        .map((page) => [page.sha256, page] as const),
    ).values(),
  ];
  const loaded = new Array(pages.length).fill(0) as number[];
  const totalBytes = pages.reduce((total, page) => total + page.bytes, 0);
  if (!readAsset)
    await mapProgressively(
      pages,
      3,
      async (page, index) =>
        decodePhysicalRecordPage(page, manifestUrl, ({ loaded: count, cached }) => {
          loaded[index] = Math.max(loaded[index]!, Math.min(page.bytes, count));
          const ratio = loaded.reduce((total, value) => total + value, 0) / Math.max(1, totalBytes);
          report(
            12 + Math.round(ratio * 58),
            cached ? 'Reading bootstrap data' : 'Downloading bootstrap data',
          );
        }),
      ({ completed, total }) =>
        report(
          12 + Math.round((completed / Math.max(1, total)) * 58),
          `Loading bootstrap page ${completed.toLocaleString()} of ${total.toLocaleString()}`,
        ),
    );
  const decoded = await mapProgressively(
    manifest.catalogAssets,
    3,
    async (asset) => {
      const value = (await decodeAssetPayload(
        asset,
        await (readAsset
          ? readAsset(asset)
          : fetchVerified(asset, manifestUrl, undefined, undefined, manifest)),
      )) as DecodedBootstrapAsset;
      if (
        value.schemaVersion !== 6 ||
        value.kind !== asset.role ||
        value.logicalId !== asset.logicalId
      ) {
        throw new Error(`${asset.id}: bootstrap logical identity mismatch`);
      }
      if (
        (asset.role === 'goods' || asset.role === 'goodsSearch') &&
        (('prefix' in value ? value.prefix : undefined) !== asset.prefix ||
          !sharedPrefixIsPublished(manifest, 'goods', 'goods', asset.prefix))
      ) {
        throw new Error(`${asset.id}: bootstrap partition identity mismatch`);
      }
      return value;
    },
    ({ completed, total }) =>
      report(
        71 + Math.round((completed / Math.max(1, total)) * 20),
        'Preparing browse and search data',
      ),
  );
  const exactlyOne = (kind: DecodedBootstrapAsset['kind']): DecodedBootstrapAsset => {
    const values = decoded.filter((value) => value.kind === kind);
    if (values.length !== 1) throw new Error(`Bootstrap requires exactly one ${kind} asset`);
    return values[0]!;
  };
  const core = exactlyOne('core') as PackedCatalogCore;
  const recipeTypes = exactlyOne('recipeTypes') as PackedCatalogRecipeTypes;
  const recipeRemaps = exactlyOne('recipeRemaps') as PackedCatalogRecipeRemaps;
  const specialMetadata = exactlyOne('specialMetadata') as PackedCatalogSpecialMetadata;
  const goodsAssets = decoded.filter(
    (value): value is PackedCatalogGoods => value.kind === 'goods',
  );
  if (goodsAssets.length === 0) throw new Error('Bootstrap requires at least one goods asset');
  const searchAssets = decoded.filter(
    (value): value is PackedCatalogGoodsSearch => value.kind === 'goodsSearch',
  );
  const tooltips = new Map(
    searchAssets.flatMap((asset) => asset.tooltips.map((value) => [value.id, value.text] as const)),
  );
  for (const value of goodsAssets.flatMap((asset) => asset.goods)) {
    if (value.tooltipId && !tooltips.has(value.tooltipId))
      throw new Error(`${value.id}: missing search tooltip`);
  }
  const goods = goodsAssets.flatMap((asset) =>
    asset.goods.map((value): PackedGoods => {
      const identity = goodsIdentityFromId(value.id);
      return {
        ...identity,
        ...value,
        tooltip: tooltips.get(value.tooltipId ?? '') ?? null,
        numericId: value.numericId,
        damage: value.damage ?? identity.damage ?? 0,
        unlocalizedName: value.unlocalizedName ?? '',
        searchMask: value.searchMask ?? [],
        productionShards: [],
        usageShards: [],
        productionCount: 0,
        usageCount: 0,
      };
    }),
  );
  return {
    catalog: {
      datasetId: manifest.datasetId,
      goods,
      recipeTypes: recipeTypes.recipeTypes,
      oreDictionaries: [],
      ingredientGroups: core.ingredientGroups ?? [],
      serviceItemIds: core.serviceItemIds,
      obsoleteRecipeRemaps: recipeRemaps.obsoleteRecipeRemaps,
      specialViewTypes: specialMetadata.specialViewTypes,
      specialServiceIcons: specialMetadata.specialServiceIcons,
    },
  };
}
