import type { Ingredient, Recipe } from './types';

export interface RecipeConstraints {
  inputs: string[];
  outputs: string[];
}

function contains(ingredients: readonly Ingredient[], id: string): boolean {
  return ingredients.some((ingredient) => ingredient.id === id
    || ingredient.ingredientGroupId === id || ingredient.alternatives?.includes(id));
}

/** Each selected identity must occur on its side; quantities and extra slots are unrestricted. */
export function matchesRecipeConstraints(recipe: Recipe, constraints: RecipeConstraints): boolean {
  return constraints.inputs.every((id) => contains(recipe.inputs, id))
    && constraints.outputs.every((id) => contains(recipe.outputs, id));
}
