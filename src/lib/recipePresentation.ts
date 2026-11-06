import type { GridDimensions, Ingredient, MachineRecipeCapability } from './types';

export function ingredientTooltipNotes(ingredient: Ingredient | undefined, fluid: boolean, output: boolean): string[] {
  if (!ingredient) return [];
  const notes: string[] = [];
  if (ingredient.amount !== undefined) {
    notes.push(ingredient.amount === 0 && !output ? 'Not consumed'
      : `${fluid ? 'Amount' : 'Count'}: ${ingredient.amount.toLocaleString('en-US', { maximumFractionDigits: 10 })}${fluid ? ' L' : ''}`);
  }
  if (output && ingredient.chance !== undefined && ingredient.chance < 1) {
    notes.push(`Chance: ${(ingredient.chance * 100).toLocaleString('en-US', { maximumFractionDigits: 10 })}%`);
  }
  return [...notes, ...(ingredient.notes ?? [])];
}

interface CrafterReference {
  id: string;
}

export interface RecipeTypeCrafterReferences {
  singleblocks: CrafterReference[];
  multiblocks: CrafterReference[];
  defaultCrafter: CrafterReference | null;
}

export interface MachineCapability {
  id: string;
  maxVoltageTier?: number;
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

export function recipeTypeCrafters(type: RecipeTypeCrafterReferences): Array<{
  id: string;
  role: 'singleblock' | 'multiblock' | 'default';
}> {
  const crafters: Array<{ id: string; role: 'singleblock' | 'multiblock' | 'default' }> = [];
  const seen = new Set<string>();
  const add = (id: string | undefined, role: 'singleblock' | 'multiblock' | 'default') => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    crafters.push({ id, role });
  };
  type.singleblocks.forEach((crafter) => add(crafter.id, 'singleblock'));
  type.multiblocks.forEach((crafter) => add(crafter.id, 'multiblock'));
  add(type.defaultCrafter?.id, 'default');
  return crafters;
}

export function recipeTypeMachineCapabilities(
  type: RecipeTypeCrafterReferences
): MachineCapability[] {
  const capabilities: MachineCapability[] = [];
  const seen = new Set<string>();
  type.singleblocks.forEach((crafter, maxVoltageTier) => {
    if (seen.has(crafter.id)) return;
    seen.add(crafter.id);
    capabilities.push({ id: crafter.id, maxVoltageTier });
  });
  for (const crafter of type.multiblocks) {
    if (seen.has(crafter.id)) continue;
    seen.add(crafter.id);
    capabilities.push({ id: crafter.id });
  }
  if (type.defaultCrafter && !seen.has(type.defaultCrafter.id)) {
    capabilities.push({ id: type.defaultCrafter.id });
  }
  return capabilities;
}

export function machineCanProcessVoltage(
  capability: Pick<MachineRecipeCapability, 'maxVoltageTier'>,
  recipeVoltageTier?: number
): boolean {
  // MessagePack encodes an explicit undefined property as null. Both mean
  // unrestricted voltage for multiblocks, rather than a zero-voltage ceiling.
  return capability.maxVoltageTier == null
    || recipeVoltageTier === undefined
    || recipeVoltageTier <= capability.maxVoltageTier;
}

export function propagateOreMachineCapabilities(
  directCapabilities: ReadonlyMap<string, readonly MachineRecipeCapability[]>,
  oreDictionaries: ReadonlyArray<{ id: string; itemIds: string[] }>
): Map<string, MachineRecipeCapability[]> {
  const propagated = new Map<string, MachineRecipeCapability[]>(
    [...directCapabilities].map(([id, capabilities]) => [
      id,
      capabilities.map((capability) => ({ ...capability, recipeShards: [...capability.recipeShards] }))
    ])
  );
  const merge = (id: string, incoming: readonly MachineRecipeCapability[]): boolean => {
    const current = propagated.get(id) ?? [];
    let changed = false;
    for (const capability of incoming) {
      const existing = current.find((candidate) => candidate.recipeTypeId === capability.recipeTypeId);
      if (!existing) {
        current.push({ ...capability, recipeShards: [...capability.recipeShards] });
        changed = true;
      } else if (
        existing.maxVoltageTier != null
        && (
          capability.maxVoltageTier == null
          || capability.maxVoltageTier > existing.maxVoltageTier
        )
      ) {
        existing.maxVoltageTier = capability.maxVoltageTier;
        changed = true;
      }
    }
    if (changed) propagated.set(id, current);
    return changed;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const ore of oreDictionaries) {
      const ids = [ore.id, ...ore.itemIds];
      const union = ids.flatMap((id) => propagated.get(id) ?? []);
      if (union.length === 0) continue;
      for (const id of ids) changed = merge(id, union) || changed;
    }
  }
  return propagated;
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

export function boundedPage<T>(
  values: readonly T[],
  page: number,
  pageSize: number
): T[] {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError('Page size must be a positive integer');
  }
  const safePage = Math.max(0, Math.floor(page));
  return values.slice(safePage * pageSize, (safePage + 1) * pageSize);
}
