import { fluidRecipeScope } from './fluidContainers';
import { parseMinecraftHtml } from './minecraftText';
import { productionFallbackDictionary } from './oreDictionary';
import { propagateOreMachineCapabilities, recipeTypeMachineCapabilities } from './recipePresentation';
import type {
  DatasetManifest,
  PackedCatalog,
  PackedGoods,
  PackedOreDictionary,
  PackedRecipeType
} from './datasetSchema';
import type { CatalogEntry } from './types';

interface MaterializedCatalog {
  entries: CatalogEntry[];
  goods: Map<string, PackedGoods>;
  recipeTypes: Map<string, PackedRecipeType>;
  oreDictionaries: Map<string, PackedOreDictionary>;
  productionFallbacks: Map<string, PackedOreDictionary>;
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
    catalog.oreDictionaries
  );

  const goodsEntries = catalog.goods.map((goods): CatalogEntry => {
    const sheet = goods.icon ? sheets.get(goods.icon.sheetId) : undefined;
    const formattedName = parseMinecraftHtml(goods.name);
    const parsedTooltip = parseMinecraftHtml(goods.tooltip);
    const formattedTooltip = goods.tooltip ? parsedTooltip.lines : [];
    const tooltip = formattedTooltip
      .map((line) => line.segments.map((segment) => segment.text).join('').trim())
      .filter(Boolean);
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
      name: formattedName.plainText.trim(),
      mod: goods.mod,
      kind: goods.kind,
      tooltip,
      formattedName: formattedName.lines,
      formattedTooltip,
      color: '#aeb3b8',
      glyph: goods.kind === 'fluid' ? '≈' : '□',
      searchable: goods.searchable,
      icon: goods.icon && sheet ? {
        url: new URL(sheet.url, manifestUrl).href,
        index: goods.icon.index,
        columns: sheet.columns,
        sha256: sheet.sha256
      } : undefined,
      productionShards,
      usageShards,
      productionCount: recipeScopeIds ? undefined : goods.productionCount,
      usageCount: fluidScope ? undefined : goods.usageCount,
      productionOreDictionaryId: fluidScope ? undefined : productionFallback?.id,
      container: goods.container,
      containerItemIds: goods.containerItemIds,
      machineCapabilities: capabilitiesByMachine.get(goods.id)
    };
  });

  const goodsEntriesById = new Map(goodsEntries.map((entry) => [entry.id, entry]));
  const oreEntries = catalog.oreDictionaries.map((ore): CatalogEntry => {
    const members = ore.itemIds
      .map((id) => goodsEntriesById.get(id))
      .filter((entry) => entry !== undefined);
    const representative = members[0];
    const productionShards = new Set<string>();
    const usageShards = new Set<string>();
    for (const memberId of ore.itemIds) {
      const member = goodsById.get(memberId);
      member?.productionShards.forEach((id) => productionShards.add(id));
      member?.usageShards.forEach((id) => usageShards.add(id));
    }
    const dictionaryName = ore.id.startsWith('o:') ? ore.id.slice(2) : ore.id;
    return {
      id: ore.id,
      name: `Ore dictionary: ${dictionaryName}`,
      mod: 'Ore Dictionary',
      kind: 'oreDict',
      tooltip: [
        `${ore.itemIds.length.toLocaleString('en-US')} interchangeable item${ore.itemIds.length === 1 ? '' : 's'}`,
        'All listed members are valid recipe ingredients.'
      ],
      color: '#aeb3b8',
      glyph: '◇',
      searchable: false,
      icon: representative?.icon,
      productionShards: [...productionShards].sort(),
      usageShards: [...usageShards].sort(),
      members: ore.itemIds,
      machineCapabilities: capabilitiesByMachine.get(ore.id)
    };
  });

  return {
    entries: [...goodsEntries, ...oreEntries],
    goods: goodsById,
    recipeTypes,
    oreDictionaries,
    productionFallbacks
  };
}
