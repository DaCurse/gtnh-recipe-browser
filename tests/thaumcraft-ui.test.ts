import { describe, expect, it } from 'vitest';
import { thaumcraftUiFor } from '../src/lib/thaumcraftUi';
import { recipeUiIngredients, machineUiBounds } from '../src/lib/machineUi';
import type { Recipe, Ingredient } from '../src/lib/types';

function recipe(infusion: boolean, inputs: Ingredient[]): Recipe {
  return { id: 'fixture', typeId: 'recipeType:176:thaumcraft:fixture', gtnhVersion: '2.9.0',
    type: infusion ? 'Arcane Infusion' : 'Magical Crafting (Shaped)', inputs,
    outputs: [{ id: 'result', amount: 1, kind: 'item', slot: 0 }], layout: {
      itemInputs: infusion ? { columns: 5, rows: 7 } : { columns: 3, rows: 5 },
      itemOutputs: { columns: 1, rows: 1 }, fluidInputs: { columns: 0, rows: 0 }, fluidOutputs: { columns: 0, rows: 0 }
    } };
}
const item = (id: string, slot: number, amount = 1): Ingredient => ({ id, slot, amount, kind: 'item' });

describe('Thaumcraft NEI recipe geometry', () => {
  it('recovers component order and the central item from the exporter grid without altering source data', () => {
    const original = recipe(true, [item('bottom', 22), item('center', 12), item('top', 2)]);
    const snapshot = structuredClone(original);
    const scene = thaumcraftUiFor(original)!;
    expect(original).toEqual(snapshot);
    expect(scene.recipe.inputs.map(input => input.id)).toEqual(['center', 'top', 'bottom']);
    expect(scene.profile.itemInputs.map(slot => slot.pos)).toEqual([[74, 62], [74, 22], [74, 102]]);
    expect(scene.profile.itemOutputs[0]?.pos).toEqual([74, 4]);
    expect(scene.profile.slotFrames).toBe(false);
    expect(scene.profile.widgets.map(widget => widget.kind)).toEqual(['ThaumcraftResult', 'RunicMatrix']);
    expect(scene.recipe.inputs.map(input => input.slot)).toEqual([0, 1, 2]);
    expect(recipeUiIngredients(scene.recipe).itemInputs).toHaveLength(3);
  });
  it('uses the spaced arcane grid, native artwork coordinates and descending vis amounts', () => {
    const original = recipe(false, [item('corner', 0), item('opposite', 8),
      item('i:aspectrecipeindex:aspect:0:small', 9, 5), item('i:aspectrecipeindex:aspect:0:large', 10, 40)]);
    const scene = thaumcraftUiFor(original)!;
    expect(scene.profile.itemInputs.map(slot => slot.pos)).toEqual([[46, 37], [102, 91], [65, 121], [84, 121]]);
    expect(scene.recipe.inputs.slice(2).map(input => input.amount)).toEqual([40, 5]);
    const grid = scene.profile.widgets.find(widget => widget.kind === 'ArcaneGrid')!;
    expect(grid.pos).toEqual([35, 28]);
    expect(grid.size).toEqual([91, 91]);
    expect(grid.texture.uv).toEqual([112 / 256, 15 / 256, 164 / 256, 67 / 256]);
    expect(scene.profile.widgets.find(widget => widget.kind === 'ArcaneWand')?.opacity).toBe(0.4);
  });
  it('distributes extra aspect rows without dropping amounts, alternatives or ingredient groups', () => {
    const aspects = Array.from({ length: 10 }, (_, index) => item(`i:aspectrecipeindex:aspect:0:${index}`, 25 + index, index + 1));
    const original = recipe(true, [{ ...item('center', 12), alternatives: ['a', 'b'], ingredientGroupId: 'o:center' }, ...aspects]);
    const scene = thaumcraftUiFor(original)!;
    expect(scene.recipe.inputs[0]).toMatchObject({ alternatives: ['a', 'b'], ingredientGroupId: 'o:center' });
    expect(scene.profile.itemInputs.slice(1).map(slot => slot.pos[1])).toEqual([129, 129, 129, 129, 129, 149, 149, 149, 149, 149]);
    expect(scene.recipe.inputs.slice(1).map(input => input.amount)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(machineUiBounds(scene.profile).height).toBeGreaterThan(165);
  });
  it('rejects incompatible categories, layouts, versions and unknown component slots', () => {
    const original = recipe(true, [item('center', 12)]);
    expect(thaumcraftUiFor({ ...original, gtnhVersion: 'future' })).toBeUndefined();
    expect(thaumcraftUiFor({ ...original, typeId: 'recipeType:gregtech:infusion' })).toBeUndefined();
    expect(thaumcraftUiFor(recipe(true, [item('unknown', 99)]))).toBeUndefined();
    expect(thaumcraftUiFor(recipe(false, [item('unknown', 9)]))).toBeUndefined();
  });
});
