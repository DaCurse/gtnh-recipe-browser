import { describe, expect, it } from 'vitest';
import { ingredientMatchesEntry, materializeIngredient } from '../src/lib/oreDictionary';

const dictionaries = new Map([
  ['o:dustIron', { itemIds: ['i:gregtech:iron-dust', 'i:ic2:iron-dust'] }],
  ['o:anyIronDust', { itemIds: ['i:ic2:iron-dust', 'i:other:iron-dust'] }],
  ['o:dustGold', { itemIds: ['i:gregtech:gold-dust'] }]
]);
const oreInput = {
  kind: 'oreDict' as const,
  goodsId: 'o:dustIron',
  slot: 4,
  amount: 2,
  probability: 1
};

describe('ore-dictionary ingredients', () => {
  it('retains dictionary identity, slot, and every interchangeable member', () => {
    expect(materializeIngredient(oreInput, dictionaries)).toEqual({
      id: 'o:dustIron',
      amount: 2,
      chance: 1,
      slot: 4,
      kind: 'oreDict',
      oreDictionaryId: 'o:dustIron',
      alternatives: ['i:gregtech:iron-dust', 'i:ic2:iron-dust']
    });
  });

  it('matches usages for every member item', () => {
    expect(ingredientMatchesEntry(oreInput, 'i:ic2:iron-dust', null, dictionaries)).toBe(true);
    expect(ingredientMatchesEntry(oreInput, 'i:gregtech:gold-dust', null, dictionaries)).toBe(false);
  });

  it('unions overlapping dictionaries without matching disjoint dictionaries', () => {
    expect(ingredientMatchesEntry(
      { ...oreInput, goodsId: 'o:anyIronDust' },
      'o:dustIron',
      new Set(dictionaries.get('o:dustIron')!.itemIds),
      dictionaries
    )).toBe(true);
    expect(ingredientMatchesEntry(
      { ...oreInput, goodsId: 'o:dustGold' },
      'o:dustIron',
      new Set(dictionaries.get('o:dustIron')!.itemIds),
      dictionaries
    )).toBe(false);
  });
});
