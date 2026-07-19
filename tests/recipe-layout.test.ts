import { describe, expect, it } from 'vitest';
import { recipes } from '../src/lib/demo';

describe('NEI recipe layouts', () => {
  it('preserves the complete format-v5 dimension contract', () => {
    for (const recipe of recipes) {
      expect(recipe.layout).toEqual(expect.objectContaining({
        itemInputs: expect.objectContaining({ columns: expect.any(Number), rows: expect.any(Number) }),
        fluidInputs: expect.objectContaining({ columns: expect.any(Number), rows: expect.any(Number) }),
        itemOutputs: expect.objectContaining({ columns: expect.any(Number), rows: expect.any(Number) }),
        fluidOutputs: expect.objectContaining({ columns: expect.any(Number), rows: expect.any(Number) })
      }));
    }
  });

  it('renders crafting against a 3 by 3 grid using stable slot indices', () => {
    const crafting = recipes.find((recipe) => recipe.type === 'Crafting');
    expect(crafting?.layout.itemInputs).toEqual({ columns: 3, rows: 3 });
    expect(crafting?.inputs.map((ingredient) => ingredient.slot)).toEqual([0, 1, 3, 4]);
  });

  it('keeps machine item and fluid grids independent', () => {
    const solidifier = recipes.find((recipe) => recipe.type === 'Fluid Solidifier');
    expect(solidifier?.layout.itemInputs).toEqual({ columns: 1, rows: 1 });
    expect(solidifier?.layout.fluidInputs).toEqual({ columns: 1, rows: 1 });
  });
});
