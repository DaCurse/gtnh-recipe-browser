import { describe, expect, it } from 'vitest';
import { applyFrontendPresentation } from '../src/lib/recipeFrontendPresentation';
import snapshot from '../src/lib/generated/recipe-presentation.json';
import type { Recipe } from '../src/lib/types';

function exportedRecipe(custom: (typeof snapshot.recipes)[number]): Recipe {
  return {
    id: custom.trigger,
    type: 'Eye of Harmony',
    typeId: 'recipeType:gregtech:Eye%20of%20Harmony',
    gtnhVersion: '2.9.0',
    inputs: [
      { id: custom.trigger, amount: 0, kind: 'item' },
      ...['hydrogen', 'helium', 'rawstarmatter'].map((name) => ({
        id: `f:gregtech:${name}`,
        amount: 0,
        kind: 'fluid' as const,
      })),
    ],
    outputs: [
      ...custom.items.map(([id]) => ({ id: String(id), amount: 1, kind: 'item' as const })),
      ...custom.fluids.map(([id]) => ({ id: String(id), amount: 1, kind: 'fluid' as const })),
    ],
    layout: {
      itemInputs: { columns: 1, rows: 1 },
      fluidInputs: { columns: 1, rows: 3 },
      itemOutputs: { columns: 9, rows: 9 },
      fluidOutputs: { columns: 9, rows: 2 },
    },
  };
}
describe('custom machine recipe quantities', () => {
  it('restores all 43 runtime recipes without changing immutable source recipes', async () => {
    expect(snapshot.recipes).toHaveLength(43);
    for (const custom of snapshot.recipes) {
      const original = exportedRecipe(custom);
      const restored = await applyFrontendPresentation(original);
      expect(restored.outputs.map((output) => output.amount)).toEqual([
        ...custom.items.map(([, amount]) => amount),
        ...custom.fluids.map(([, amount]) => amount),
      ]);
      expect(original.outputs.every((output) => output.amount === 1)).toBe(true);
      expect(
        restored.inputs.find((input) => input.id === 'f:gregtech:rawstarmatter')?.amount,
      ).toBeUndefined();
    }
  });
  it('preserves the full Mercury output count and its recipe-specific tooltip', async () => {
    const mercury = snapshot.recipes.find(
      (recipe) => recipe.trigger === 'i:gtneioreplugin:blockDimensionDisplay_Me:0',
    )!;
    const restored = await applyFrontendPresentation(exportedRecipe(mercury));
    expect(restored.outputs[0]!.amount).toBe(1_150_554_420);
    expect(restored.outputs[0]!.notes).toEqual(['Solid mass: 300%']);
    expect(restored.inputs.find((input) => input.id === 'f:gregtech:hydrogen')?.amount).toBe(
      5_000_000_000,
    );
  });
  it('requires a matching release and complete output identities before applying custom data', async () => {
    const recipe = exportedRecipe(snapshot.recipes[0]!);
    const older = { ...recipe, gtnhVersion: '2.8.3' };
    expect(await applyFrontendPresentation(older)).toBe(older);
    await expect(
      applyFrontendPresentation({ ...recipe, outputs: recipe.outputs.slice(1) }),
    ).rejects.toThrow(/do not match/);
  });
});
