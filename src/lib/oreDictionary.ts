import type { Ingredient } from './types';

export interface RecipeIngredientReference {
  kind: 'item' | 'fluid' | 'oreDict';
  goodsId: string;
  slot: number;
  amount: number;
  probability: number;
}

export interface OreDictionaryReference {
  itemIds: string[];
}

export interface OreDictionaryDefinition extends OreDictionaryReference {
  id: string;
}

/**
 * Selects the narrowest ore dictionary which can supply production recipes for
 * an item with no direct outputs. Broad dictionaries remain available through
 * their own entries, but do not eclipse a material-specific dictionary.
 */
export function productionFallbackDictionary(
  entryId: string,
  dictionaries: Iterable<OreDictionaryDefinition>,
  hasProduction: (itemId: string) => boolean
): OreDictionaryDefinition | undefined {
  return [...dictionaries]
    .filter((dictionary) =>
      dictionary.itemIds.includes(entryId) &&
      dictionary.itemIds.some((itemId) => itemId !== entryId && hasProduction(itemId)))
    .sort((left, right) =>
      left.itemIds.length - right.itemIds.length || left.id.localeCompare(right.id))[0];
}

export function ingredientMatchesEntry(
  ingredient: RecipeIngredientReference,
  entryId: string,
  selectedMembers: ReadonlySet<string> | null,
  dictionaries: ReadonlyMap<string, OreDictionaryReference>
): boolean {
  if (selectedMembers) {
    if (ingredient.kind !== 'oreDict') return selectedMembers.has(ingredient.goodsId);
    return dictionaries.get(ingredient.goodsId)?.itemIds.some((id) => selectedMembers.has(id)) ?? false;
  }
  if (ingredient.goodsId === entryId) return true;
  return ingredient.kind === 'oreDict' &&
    (dictionaries.get(ingredient.goodsId)?.itemIds.includes(entryId) ?? false);
}

export function materializeIngredient(
  ingredient: RecipeIngredientReference,
  dictionaries: ReadonlyMap<string, OreDictionaryReference>
): Ingredient {
  const alternatives = ingredient.kind === 'oreDict'
    ? dictionaries.get(ingredient.goodsId)?.itemIds ?? []
    : undefined;
  return {
    id: ingredient.goodsId,
    amount: ingredient.amount,
    chance: ingredient.probability,
    slot: ingredient.slot,
    kind: ingredient.kind,
    oreDictionaryId: ingredient.kind === 'oreDict' ? ingredient.goodsId : undefined,
    alternatives
  };
}
