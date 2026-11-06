import type { Ingredient, Recipe } from './types';

interface CustomRecipe {
  trigger: string;
  totalItems: number;
  hydrogen: number;
  helium: number;
  durationTicks: number;
  items: Array<[string, number, number | null]>;
  fluids: Array<[string, number]>;
}
interface Snapshot { gtnhVersion: string; recipes: CustomRecipe[] }
let loading: Promise<Snapshot> | undefined;

/** Restore quantities kept outside normal GT recipes by custom NEI frontends. */
export async function applyFrontendPresentation(recipe: Recipe): Promise<Recipe> {
  if (recipe.gtnhVersion !== '2.9.0' || recipe.type !== 'Eye of Harmony'
    || !recipe.typeId?.includes(':gregtech:')) return recipe;
  // Keep machine-specific data out of normal catalogue startup and recipe loads.
  loading ??= import('./generated/recipe-presentation.json').then(module => module.default as unknown as Snapshot);
  const snapshot = await loading;
  const custom = snapshot.recipes.find(entry => recipe.inputs.some(input => input.id === entry.trigger));
  if (!custom || snapshot.gtnhVersion !== recipe.gtnhVersion) throw new Error('Missing Eye of Harmony frontend quantities');
  const items = new Map(custom.items.map(([id, amount, mass]) => [id, { amount, mass }]));
  const fluids = new Map(custom.fluids);
  const itemOutputs = recipe.outputs.filter(output => output.kind !== 'fluid');
  const fluidOutputs = recipe.outputs.filter(output => output.kind === 'fluid');
  if (itemOutputs.length !== items.size || fluidOutputs.length !== fluids.size
    || !itemOutputs.every(output => items.has(output.id)) || !fluidOutputs.every(output => fluids.has(output.id))) {
    throw new Error('Eye of Harmony frontend quantities do not match the exported recipe');
  }
  const inputs: Ingredient[] = recipe.inputs.map(input => {
    if (input.id === custom.trigger) return { ...input, notes: [`Total items: ${custom.totalItems.toLocaleString('en-US')}`] };
    if (input.id === 'f:gregtech:hydrogen') return { ...input, amount: custom.hydrogen, notes: ['Base requirement'] };
    if (input.id === 'f:gregtech:helium') return { ...input, amount: custom.helium, notes: ['Base requirement'] };
    if (input.id === 'f:gregtech:rawstarmatter') return { ...input, amount: undefined, notes: ['Optional boost'] };
    return input;
  });
  return { ...recipe, inputs,
    duration: recipe.duration ?? `${Number((custom.durationTicks / 1200).toFixed(2))} m`,
    outputs: recipe.outputs.map(output => {
      const item = items.get(output.id);
      return output.kind === 'fluid' ? { ...output, amount: fluids.get(output.id)! }
        : { ...output, amount: item!.amount,
          notes: item!.mass == null ? undefined : [`Solid mass: ${item!.mass.toLocaleString('en-US', { maximumFractionDigits: 3 })}%`] };
    })
  };
}
