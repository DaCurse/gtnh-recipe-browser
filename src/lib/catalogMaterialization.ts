import { fluidRecipeScope } from './fluidContainers';
import { minecraftHtmlPlainText } from './minecraftText';
import { productionFallbackDictionary } from './oreDictionary';
import { propagateOreMachineCapabilities, recipeTypeMachineCapabilities } from './recipePresentation';
import type {
  DatasetManifest,
  PackedCatalog,
  PackedGoods,
  PackedIngredientGroup,
  PackedOreDictionary,
  PackedRecipeType
} from './datasetSchema';
import type { CatalogEntry } from './types';

export interface MaterializedCatalog {
  entries: CatalogEntry[];
  goods: Map<string, PackedGoods>;
  recipeTypes: Map<string, PackedRecipeType>;
  oreDictionaries: Map<string, PackedOreDictionary>;
  ingredientGroups: Map<string, PackedOreDictionary | PackedIngredientGroup>;
  productionFallbacks: Map<string, PackedOreDictionary>;
}

/**
 * The materialized catalog is intentionally kept as arrays at the IndexedDB
 * boundary.  Maps are cheap to rebuild, while arrays are portable across
 * browsers and make the snapshot format explicit and inspectable.
 */
export interface MaterializedCatalogSnapshot {
  entries: CatalogEntry[];
  productionFallbacks: Array<[string, PackedOreDictionary]>;
}

export function snapshotMaterializedCatalog(
  materialized: MaterializedCatalog
): MaterializedCatalogSnapshot {
  return {
    entries: materialized.entries,
    productionFallbacks: [...materialized.productionFallbacks.entries()]
  };
}

export function restoreMaterializedCatalog(
  snapshot: MaterializedCatalogSnapshot,
  catalog: PackedCatalog
): MaterializedCatalog {
  const ingredientGroups = [
    ...catalog.oreDictionaries,
    ...(catalog.ingredientGroups ?? [])
  ];
  return {
    entries: snapshot.entries,
    goods: new Map(catalog.goods.map((goods) => [goods.id, goods])),
    recipeTypes: new Map(catalog.recipeTypes.map((type) => [type.id, type])),
    oreDictionaries: new Map(catalog.oreDictionaries.map((ore) => [ore.id, ore])),
    ingredientGroups: new Map(ingredientGroups.map((group) => [group.id, group])),
    productionFallbacks: new Map(snapshot.productionFallbacks)
  };
}

export function materializeCatalog(
  manifest: DatasetManifest,
  manifestUrl: string,
  catalog: PackedCatalog
): MaterializedCatalog {
  const sheets = new Map(manifest.iconSheets.map((sheet) => [sheet.id, sheet]));
  const goodsById = new Map(catalog.goods.map((goods) => [goods.id, goods]));
  const recipeTypes = new Map(catalog.recipeTypes.map((type) => [type.id, type]));
  const oreDictionaries = new Map(catalog.oreDictionaries.map((ore) => [ore.id, ore]));
  const anonymousGroups = catalog.ingredientGroups ?? [];
  const ingredientGroups = new Map<string, PackedOreDictionary | PackedIngredientGroup>([
    ...catalog.oreDictionaries.map((group) => [group.id, group] as const),
    ...anonymousGroups.map((group) => [group.id, group] as const)
  ]);
  const itemOres = new Map<string, PackedOreDictionary[]>();
  for (const ore of catalog.oreDictionaries) {
    for (const itemId of ore.itemIds) {
      const memberships = itemOres.get(itemId) ?? [];
      memberships.push(ore);
      itemOres.set(itemId, memberships);
    }
  }

  const productionFallbacks = new Map<string, PackedOreDictionary>();
  for (const goods of catalog.goods) {
    if (goods.kind !== 'item' || goods.productionCount !== 0) continue;
    const fallback = productionFallbackDictionary(
      goods.id,
      itemOres.get(goods.id) ?? [],
      (itemId) => (goodsById.get(itemId)?.productionCount ?? 0) > 0
    );
    if (fallback) productionFallbacks.set(goods.id, fallback);
  }

  const shardsByRecipeType = new Map<string, string[]>();
  for (const shard of manifest.recipeShards) {
    const shardIds = shardsByRecipeType.get(shard.recipeTypeId) ?? [];
    shardIds.push(shard.id);
    shardsByRecipeType.set(shard.recipeTypeId, shardIds);
  }
  const directCapabilities = new Map<string, NonNullable<CatalogEntry['machineCapabilities']>>();
  for (const type of catalog.recipeTypes) {
    for (const machine of recipeTypeMachineCapabilities(type)) {
      const capabilities = directCapabilities.get(machine.id) ?? [];
      capabilities.push({
        recipeTypeId: type.id,
        recipeTypeName: type.name,
        recipeShards: shardsByRecipeType.get(type.id) ?? [],
        maxVoltageTier: machine.maxVoltageTier
      });
      directCapabilities.set(machine.id, capabilities);
    }
  }
  const capabilitiesByMachine = propagateOreMachineCapabilities(
    directCapabilities,
    [...catalog.oreDictionaries, ...anonymousGroups]
  );

  const goodsEntries = catalog.goods.map((goods): CatalogEntry => {
    const sheet = goods.icon ? sheets.get(goods.icon.sheetId) : undefined;
    const name = minecraftHtmlPlainText(goods.name).trim();
    const productionFallback = productionFallbacks.get(goods.id);
    const fluidScope = fluidRecipeScope(goods.id, goodsById);
    const recipeScopeIds = fluidScope?.memberIds ?? productionFallback?.itemIds;
    const productionShards = recipeScopeIds
      ? [...new Set([...recipeScopeIds].flatMap((itemId) =>
          goodsById.get(itemId)?.productionShards ?? []))].sort()
      : goods.productionShards;
    const usageShards = fluidScope
      ? [...new Set([...fluidScope.memberIds].flatMap((itemId) =>
          goodsById.get(itemId)?.usageShards ?? []))].sort()
      : goods.usageShards;
    return {
      id: goods.id,
      name,
      rawName: goods.name,
      mod: goods.mod,
      kind: goods.kind,
      internalName: goods.internalName,
      unlocalizedName: goods.unlocalizedName,
      numericId: goods.numericId,
      damage: goods.damage,
      nbt: goods.nbt,
      searchMask: goods.searchMask,
      rawTooltip: goods.tooltip,
      tooltip: [],
      color: '#aeb3b8',
      glyph: goods.kind === 'fluid' ? '≈' : '□',
      searchable: goods.searchable,
      icon: goods.icon && sheet ? {
        id: sheet.id,
        url: new URL(sheet.url, manifestUrl).href,
        index: goods.icon.index,
        columns: sheet.columns,
        sha256: sheet.sha256,
        bytes: sheet.bytes,
        encoding: sheet.encoding,
        datasetId: manifest.datasetId
      } : undefined,
      productionShards,
      usageShards,
      productionCount: recipeScopeIds ? undefined : goods.productionCount,
      usageCount: fluidScope ? undefined : goods.usageCount,
      specialProductionShards: goods.specialProductionShards,
      specialUsageShards: goods.specialUsageShards,
      specialProductionLookupIds: goods.specialProductionLookupIds,
      specialUsageLookupIds: goods.specialUsageLookupIds,
      specialProductionCount: goods.specialProductionCount,
      specialUsageCount: goods.specialUsageCount,
      productionOreDictionaryId: fluidScope ? undefined : productionFallback?.id,
      oreDictionaryIds: (itemOres.get(goods.id) ?? []).map((ore) => ore.id),
      container: goods.container,
      containerItemIds: goods.containerItemIds,
      machineCapabilities: capabilitiesByMachine.get(goods.id)
    };
  });

  const goodsEntriesById = new Map(goodsEntries.map((entry) => [entry.id, entry]));
  const groupEntries = [...catalog.oreDictionaries, ...anonymousGroups].map((group): CatalogEntry => {
    const members = group.itemIds
      .map((id) => goodsEntriesById.get(id))
      .filter((entry) => entry !== undefined);
    const representative = members[0];
    const productionShards = new Set<string>();
    const usageShards = new Set<string>();
    const specialProductionShards = new Set(group.specialProductionShards ?? []);
    const specialUsageShards = new Set(group.specialUsageShards ?? []);
    const specialProductionLookupIds = new Set(group.specialProductionLookupIds ?? []);
    const specialUsageLookupIds = new Set(group.specialUsageLookupIds ?? []);
    let specialProductionCount = group.specialProductionCount ?? 0;
    let specialUsageCount = group.specialUsageCount ?? 0;
    for (const memberId of group.itemIds) {
      const member = goodsById.get(memberId);
      member?.productionShards.forEach((id) => productionShards.add(id));
      member?.usageShards.forEach((id) => usageShards.add(id));
      member?.specialProductionShards?.forEach((id) => specialProductionShards.add(id));
      member?.specialUsageShards?.forEach((id) => specialUsageShards.add(id));
      member?.specialProductionLookupIds?.forEach((id) => specialProductionLookupIds.add(id));
      member?.specialUsageLookupIds?.forEach((id) => specialUsageLookupIds.add(id));
      specialProductionCount += member?.specialProductionCount ?? 0;
      specialUsageCount += member?.specialUsageCount ?? 0;
    }
    const namedDictionary = group.id.startsWith('o:');
    const dictionaryName = namedDictionary ? group.id.slice(2) : '';
    return {
      id: group.id,
      name: namedDictionary ? `Ore dictionary: ${dictionaryName}` : 'Interchangeable ingredients',
      mod: namedDictionary ? 'Ore Dictionary' : 'Recipe Alternatives',
      kind: namedDictionary ? 'oreDict' : 'itemGroup',
      tooltip: [
        `${group.itemIds.length.toLocaleString('en-US')} interchangeable item${group.itemIds.length === 1 ? '' : 's'}`,
        'All listed members are valid recipe ingredients.'
      ],
      color: '#aeb3b8',
      glyph: '◇',
      searchable: false,
      icon: representative?.icon,
      productionShards: [...productionShards].sort(),
      usageShards: [...usageShards].sort(),
      specialProductionShards: [...specialProductionShards].sort(),
      specialUsageShards: [...specialUsageShards].sort(),
      specialProductionLookupIds: [...specialProductionLookupIds].sort(),
      specialUsageLookupIds: [...specialUsageLookupIds].sort(),
      specialProductionCount,
      specialUsageCount,
      members: group.itemIds,
      machineCapabilities: capabilitiesByMachine.get(group.id)
    };
  });

  return {
    entries: [...goodsEntries, ...groupEntries],
    goods: goodsById,
    recipeTypes,
    oreDictionaries,
    ingredientGroups,
    productionFallbacks
  };
}
