import { describe, expect, it } from 'vitest';
import {
  boundedPage,
  ingredientsByGridSlot,
  recipeCrafterId,
  recipeItemInputLabel,
  recipeTypeCrafters,
  recipeTypeIconId
} from '../src/lib/recipePresentation';

const type = {
  singleblocks: [{ id: 'machine:lv' }, { id: 'machine:mv' }, { id: 'machine:hv' }],
  multiblocks: [{ id: 'machine:large' }],
  defaultCrafter: { id: 'machine:lv' }
};

describe('recipe presentation parity', () => {
  it('uses tiered singleblocks for cards and the default crafter for tabs', () => {
    expect(recipeCrafterId(type, 2)).toBe('machine:hv');
    expect(recipeCrafterId(type, 8)).toBe('machine:lv');
    expect(recipeTypeIconId(type)).toBe('machine:lv');
  });

  it('lists category crafters in exporter order without duplicate defaults', () => {
    expect(recipeTypeCrafters(type)).toEqual([
      { id: 'machine:lv', role: 'singleblock' },
      { id: 'machine:mv', role: 'singleblock' },
      { id: 'machine:hv', role: 'singleblock' },
      { id: 'machine:large', role: 'multiblock' }
    ]);
    expect(recipeTypeCrafters({
      singleblocks: [],
      multiblocks: [],
      defaultCrafter: { id: 'machine:fallback' }
    })).toEqual([{ id: 'machine:fallback', role: 'default' }]);
  });

  it('only labels actual crafting types as shaped or shapeless', () => {
    expect(recipeItemInputLabel('Crafting (Shaped)', false, { columns: 3, rows: 3 }))
      .toBe('3 × 3 shaped');
    expect(recipeItemInputLabel('Crafting (Shapeless)', true, { columns: 3, rows: 3 }))
      .toBe('Shapeless');
    expect(recipeItemInputLabel('Assembler', true, { columns: 3, rows: 3 }))
      .toBe('Items');
  });

  it('preserves gaps and omits service slots outside the declared NEI grid', () => {
    const visible = ingredientsByGridSlot(
      [{ id: 'first', slot: 0 }, { id: 'gap-after', slot: 2 }, { id: 'service', slot: 6 }],
      { columns: 3, rows: 2 }
    );
    expect([...visible.entries()]).toEqual([
      [0, { id: 'first', slot: 0 }],
      [2, { id: 'gap-after', slot: 2 }]
    ]);
  });

  it('keeps a 2,000-recipe result bounded to one mounted page', () => {
    const recipes = Array.from({ length: 2_254 }, (_, index) => ({ id: `recipe-${index}` }));
    expect(boundedPage(recipes, 0, 20)).toHaveLength(20);
    expect(boundedPage(recipes, 112, 20)).toHaveLength(14);
  });
});
