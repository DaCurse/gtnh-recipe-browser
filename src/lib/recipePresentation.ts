import type { GridDimensions } from './types';

export interface CrafterReference {
  id: string;
}

export interface RecipeTypeCrafterReferences {
  singleblocks: CrafterReference[];
  multiblocks: CrafterReference[];
  defaultCrafter: CrafterReference | null;
}

export function recipeCrafterId(
  type: RecipeTypeCrafterReferences,
  voltageTier?: number
): string | undefined {
  const tierCrafter = voltageTier === undefined ? undefined : type.singleblocks[voltageTier];
  return tierCrafter?.id ?? type.defaultCrafter?.id ?? type.multiblocks[0]?.id;
}

export function recipeTypeIconId(type: RecipeTypeCrafterReferences): string | undefined {
  return type.defaultCrafter?.id ?? type.multiblocks[0]?.id ?? type.singleblocks[0]?.id;
}

export function recipeItemInputLabel(
  typeName: string,
  shapeless: boolean | undefined,
  dimensions: GridDimensions
): string {
  if (!typeName.includes('Crafting')) return 'Items';
  return shapeless ? 'Shapeless' : `${dimensions.columns} × ${dimensions.rows} shaped`;
}

export function ingredientsByGridSlot<T extends { slot?: number }>(
  ingredients: readonly T[],
  dimensions: GridDimensions
): ReadonlyMap<number, T> {
  const cellCount = dimensions.columns * dimensions.rows;
  const slots = new Map<number, T>();
  for (const ingredient of ingredients) {
    const slot = ingredient.slot ?? 0;
    if (Number.isInteger(slot) && slot >= 0 && slot < cellCount && !slots.has(slot)) {
      slots.set(slot, ingredient);
    }
  }
  return slots;
}
