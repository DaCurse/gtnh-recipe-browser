export type RecipeIoKind = 'item' | 'oreDict' | 'fluid';

interface DecodedGridDimensions {
  columns: number;
  rows: number;
}

interface DecodedCrafter {
  id: string;
  name: string;
  iconId: number;
}

export interface DecodedRecipeType {
  id: string;
  order: number;
  name: string;
  category: string;
  dimensions: {
    itemInputs: DecodedGridDimensions;
    fluidInputs: DecodedGridDimensions;
    itemOutputs: DecodedGridDimensions;
    fluidOutputs: DecodedGridDimensions;
  };
  shapeless: boolean;
  singleblocks: DecodedCrafter[];
  multiblocks: DecodedCrafter[];
  defaultCrafter: DecodedCrafter | null;
}

export interface DecodedRecipeIo {
  kind: RecipeIoKind;
  goodsId: string;
  slot: number;
  amount: number;
  probability: number;
}

interface DecodedGtMetadata {
  key: string;
  value: number;
}

export interface DecodedGtRecipe {
  voltage: number;
  durationTicks: number;
  amperage: number;
  voltageTier: number;
  metadata: DecodedGtMetadata[];
  circuitConflicts: number;
  specialValue: number;
}

export interface DecodedRecipe {
  id: string;
  searchMask: number[];
  recipeTypeId: string;
  inputs: DecodedRecipeIo[];
  outputs: DecodedRecipeIo[];
  gt: DecodedGtRecipe | null;
}

export interface DecodedFluidContainer {
  fluidId: string;
  amount: number;
  emptyItemId: string | null;
}

export interface DecodedGoodsBase {
  id: string;
  name: string;
  mod: string;
  internalName: string;
  numericId: number;
  iconId: number;
  tooltip: string | null;
  unlocalizedName: string;
  nbt: string | null;
  searchMask: number[];
  productionRecipeIds: string[];
  usageRecipeIds: string[];
  /** False for valid recipe/crafter objects intentionally omitted from the upstream searchable root list. */
  searchable: boolean;
}

export interface DecodedItem extends DecodedGoodsBase {
  kind: 'item';
  stackSize: number;
  damage: number;
  container: DecodedFluidContainer | null;
}

export interface DecodedFluid extends DecodedGoodsBase {
  kind: 'fluid';
  isGas: boolean;
  containerItemIds: string[];
}

export interface DecodedOreDictionary {
  id: string;
  searchMask: number[];
  itemIds: string[];
}

export interface DecodedRepository {
  formatVersion: 5;
  items: DecodedItem[];
  fluids: DecodedFluid[];
  oreDictionaries: DecodedOreDictionary[];
  recipeTypes: DecodedRecipeType[];
  recipes: DecodedRecipe[];
  serviceItemIds: string[];
  obsoleteRecipeRemaps: Record<string, string>;
}
