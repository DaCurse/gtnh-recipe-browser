import {
  recipeTypeMachineCapabilities,
  type AdditionalCrafter,
  type RecipeTypeCrafterReferences,
} from './recipePresentation';

export interface MachineCrafterSource {
  schemaVersion: 1;
  sourceScriptSha256: string;
  types: Record<string, AdditionalCrafter[]>;
}
export function parseMachineCrafters(value: unknown): MachineCrafterSource {
  const source = value as MachineCrafterSource;
  if (
    source?.schemaVersion !== 1 ||
    !/^[a-f0-9]{64}$/.test(source.sourceScriptSha256) ||
    !source.types ||
    typeof source.types !== 'object' ||
    Array.isArray(source.types)
  )
    throw new Error('Invalid machine-crafter source');
  for (const [type, crafters] of Object.entries(source.types)) {
    if (!type.startsWith('recipeType:') || !Array.isArray(crafters))
      throw new Error('Invalid machine-crafter category');
    const ids = new Set<string>();
    for (const crafter of crafters) {
      if (
        !crafter ||
        !/^i:/.test(crafter.id) ||
        ids.has(crafter.id) ||
        !['singleblock', 'multiblock'].includes(crafter.role) ||
        (crafter.role === 'singleblock' &&
          (!Number.isInteger(crafter.maxVoltageTier) ||
            crafter.maxVoltageTier! < 0 ||
            crafter.maxVoltageTier! > 13)) ||
        (crafter.role === 'multiblock' && crafter.maxVoltageTier !== undefined)
      )
        throw new Error(`Invalid machine crafter for ${type}`);
      ids.add(crafter.id);
    }
  }
  return source;
}
export function addRecipeTypeCrafters<T extends RecipeTypeCrafterReferences & { id: string }>(
  type: T,
  candidates: readonly AdditionalCrafter[],
  goodsIds: ReadonlySet<string>,
): T {
  const known = new Map(
    recipeTypeMachineCapabilities(type).map((crafter) => [crafter.id, crafter]),
  );
  const additional = new Map(
    (type.additionalCrafters ?? []).map((crafter) => [crafter.id, crafter]),
  );
  for (const crafter of candidates) {
    if (!goodsIds.has(crafter.id))
      throw new Error(`Machine crafter is missing from the catalogue: ${crafter.id}`);
    if (known.has(crafter.id) && known.get(crafter.id)!.maxVoltageTier === crafter.maxVoltageTier)
      continue;
    known.set(crafter.id, crafter);
    additional.set(crafter.id, { ...crafter });
  }
  return additional.size ? { ...type, additionalCrafters: [...additional.values()] } : type;
}
