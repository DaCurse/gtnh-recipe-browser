export interface FluidContainerReference {
  fluidId: string;
  amount: number;
  emptyItemId: string | null;
}

export interface FluidContainerGoodsReference {
  id: string;
  kind: 'item' | 'fluid';
  container?: FluidContainerReference | null;
  containerItemIds?: string[];
}

export interface FluidRecipeScope {
  fluidId: string;
  memberIds: ReadonlySet<string>;
  selectedContainer: FluidContainerReference | null;
}

/**
 * Mirrors ShadowTheAge's GetAllFluidRecipes behavior. Fluids and filled
 * containers share recipe/usage results; empty containers remain metadata.
 */
export function fluidRecipeScope(
  entryId: string,
  goods: ReadonlyMap<string, FluidContainerGoodsReference>
): FluidRecipeScope | null {
  const selected = goods.get(entryId);
  if (!selected) return null;
  const fluidId = selected.kind === 'fluid' ? selected.id : selected.container?.fluidId;
  if (!fluidId) return null;
  const fluid = goods.get(fluidId);
  if (!fluid || fluid.kind !== 'fluid') return null;

  return {
    fluidId,
    memberIds: new Set([fluidId, ...(fluid.containerItemIds ?? []), entryId]),
    selectedContainer: selected.kind === 'item' ? selected.container ?? null : null
  };
}
