import type {
  DecodedAnonymousIngredientGroup,
  DecodedGoodsBase,
  DecodedItem,
  DecodedOreDictionary,
  DecodedRepository
} from './model';
import type { SpecialData, SpecialRecord } from '../data-export/special';

/**
 * Ore prefixes that PluginGT5OreBase accepts when resolving a selected
 * processing product back to its GT material.  The generic `ore<Material>`
 * dictionary is deliberately handled separately: it contains unrelated
 * vanilla/Galacticraft blocks which are not GTNEIOrePlugin inputs.
 */
const GT_PROCESSING_GROUP_PREFIXES = [
  'dust',
  'dustPure',
  'dustImpure',
  'crushed',
  'crushedPurified',
  'crushedCentrifuged',
  'rawOre',
  'gem',
  'gemChipped',
  'gemFlawed',
  'gemFlawless',
  'gemExquisite'
] as const;

const GT_ORE_CATEGORIES = new Set(['gt-ore-vein', 'gt-small-ore']);

type IngredientGroup = DecodedOreDictionary | DecodedAnonymousIngredientGroup;

function recordMaterials(record: SpecialRecord): string[] {
  const result = new Set<string>();
  const payload = record.payload;
  if (typeof payload.material === 'string' && payload.material.trim()) {
    result.add(payload.material.trim());
  }
  if (Array.isArray(payload.layers)) {
    for (const layer of payload.layers) {
      if (!layer || typeof layer !== 'object' || Array.isArray(layer)) continue;
      const material = (layer as Record<string, unknown>).material;
      if (typeof material === 'string' && material.trim()) result.add(material.trim());
    }
  }
  return [...result].sort((left, right) => left.localeCompare(right));
}

function isGtHostOre(entry: DecodedGoodsBase | undefined): entry is DecodedItem {
  const item = entry as DecodedItem | undefined;
  return item?.kind === 'item'
    && item.mod.toLocaleLowerCase() === 'gregtech'
    && /^gt\.blockores\d*$/i.test(item.internalName);
}

function groupMap(repository: DecodedRepository): Map<string, IngredientGroup> {
  return new Map(
    [...repository.oreDictionaries, ...repository.ingredientGroups]
      .map((group) => [group.id.toLocaleLowerCase(), group] as const)
  );
}

/**
 * Add the exact GT host-stone variants and the processing-prefix groups that
 * the embedded NEI plugin resolves for each vein/small-ore material.  This
 * runs at pack build time so an older runtime sidecar is upgraded
 * deterministically without another client export; a newer exporter that
 * already emitted these references is idempotent here.
 */
export function expandGtOreSpecialData(
  data: SpecialData,
  repository: DecodedRepository
): SpecialData {
  const groups = groupMap(repository);
  const goodsById = new Map(
    [...repository.items, ...repository.fluids].map((entry) => [entry.id, entry] as const)
  );

  const records = data.records.map((record) => {
    if (!GT_ORE_CATEGORIES.has(record.category)) return record;
    const aliases = new Set(record.goodsIds);
    for (const material of recordMaterials(record)) {
      const materialKey = material.toLocaleLowerCase();
      const oreGroup = groups.get(`o:ore${materialKey}`);
      // NEI can display every GT host stone for a material, but unrelated
      // mod ore blocks in the same Forge dictionary are not GT vein inputs.
      oreGroup?.itemIds
        .filter((itemId) => isGtHostOre(goodsById.get(itemId)))
        .forEach((itemId) => aliases.add(itemId));

      for (const prefix of GT_PROCESSING_GROUP_PREFIXES) {
        const group = groups.get(`o:${prefix.toLocaleLowerCase()}${materialKey}`);
        if (group) aliases.add(group.id);
      }
    }
    if (aliases.size === record.goodsIds.length) return record;
    const sortedAliases = [...aliases].sort();
    const addedAliases = sortedAliases.filter((goodsId) => !record.goodsIds.includes(goodsId));
    const expanded: SpecialRecord = {
      ...record,
      goodsIds: sortedAliases
    };
    for (const key of ['productionGoodsIds', 'usageGoodsIds'] as const) {
      const value = record[key];
      if (!Array.isArray(value)) continue;
      expanded[key] = [...new Set([...value, ...addedAliases])].sort();
    }
    return expanded;
  });
  return { ...data, records };
}
