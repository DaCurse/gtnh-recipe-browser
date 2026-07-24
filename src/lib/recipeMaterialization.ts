import { materializeIngredient } from './oreDictionary';
import { formatGtMetadata, hasRelevantPower, voltageTierName } from './recipeMetadata';
import {
  recipeCrafterId,
  recipeTypeCrafters,
  recipeTypeIconId
} from './recipePresentation';
import type {
  PackedOreDictionary,
  PackedRecipe,
  PackedRecipeType
} from './datasetSchema';
import type { Recipe } from './types';

function duration(ticks: number): string {
  const seconds = ticks / 20;
  if (seconds < 60) return `${Number(seconds.toFixed(2))} s`;
  return `${Number((seconds / 60).toFixed(2))} m`;
}

function amount(value: number): string {
  if (value >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(2))}B EU`;
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M EU`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(2))}k EU`;
  return `${value} EU`;
}

function power(value: number): string {
  return amount(value).replace(/ EU$/, ' EU/t');
}

export function materializeRecipe(
  recipe: PackedRecipe,
  order: number,
  recipeTypes: ReadonlyMap<string, PackedRecipeType>,
  oreDictionaries: ReadonlyMap<string, PackedOreDictionary>
): Recipe {
  const type = recipeTypes.get(recipe.recipeTypeId);
  if (!type) throw new Error(`Unknown recipe type ${recipe.recipeTypeId}`);
  const convert = (io: PackedRecipe['inputs'][number]) =>
    materializeIngredient(io, oreDictionaries);
  const gt = recipe.gt;
  const powerInfo = hasRelevantPower(gt) ? gt : null;
  const totalEu = powerInfo
    ? powerInfo.voltage * powerInfo.amperage * powerInfo.durationTicks
    : undefined;
  const euPerTick = powerInfo ? powerInfo.voltage * powerInfo.amperage : undefined;
  return {
    id: recipe.id,
    type: type.name,
    inputs: recipe.inputs.map(convert),
    outputs: recipe.outputs.map(convert),
    layout: { ...type.dimensions, shapeless: type.shapeless },
    duration: powerInfo ? duration(powerInfo.durationTicks) : undefined,
    voltage: powerInfo ? voltageTierName(powerInfo.voltageTier) : undefined,
    voltageExact: powerInfo ? `${powerInfo.voltage.toLocaleString('en-US')} V` : undefined,
    amperage: powerInfo && powerInfo.amperage !== 1 ? `${powerInfo.amperage} A` : undefined,
    eu: totalEu === undefined ? undefined : amount(totalEu),
    euExact: totalEu === undefined ? undefined : `${totalEu.toLocaleString('en-US')} EU`,
    euPerTick: euPerTick === undefined ? undefined : power(euPerTick),
    euPerTickExact: euPerTick === undefined
      ? undefined
      : `${euPerTick.toLocaleString('en-US')} EU/t`,
    metadata: gt?.metadata
      .map((metadata) => formatGtMetadata(metadata, {
        recipeType: type.name,
        voltageTier: gt.voltageTier
      }))
      .filter((line): line is string => line !== null),
    crafterId: recipeCrafterId(type, gt?.voltageTier),
    crafters: recipeTypeCrafters(type),
    typeIconId: recipeTypeIconId(type),
    circuitConflicts: gt?.circuitConflicts,
    specialValue: gt?.specialValue,
    order
  };
}
