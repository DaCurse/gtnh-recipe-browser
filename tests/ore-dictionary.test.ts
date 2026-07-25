import { describe, expect, it } from 'vitest';
import {
  ingredientMatchesEntry,
  materializeIngredient,
  productionFallbackDictionary
} from '../src/lib/oreDictionary';

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
      ingredientGroupId: 'o:dustIron',
      ingredientGroupKind: 'oreDict',
      alternatives: ['i:gregtech:iron-dust', 'i:ic2:iron-dust']
    });
  });

  it('keeps anonymous alternatives distinct from named ore dictionaries', () => {
    const groups = new Map([
      ['g:recipe-alternatives', { itemIds: ['i:mod:first', 'i:mod:second'] }]
    ]);
    expect(materializeIngredient({
      kind: 'itemGroup',
      goodsId: 'g:recipe-alternatives',
      slot: 0,
      amount: 1,
      probability: 1
    }, groups)).toEqual(expect.objectContaining({
      kind: 'itemGroup',
      ingredientGroupId: 'g:recipe-alternatives',
      ingredientGroupKind: 'itemGroup',
      alternatives: ['i:mod:first', 'i:mod:second']
    }));
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

  it('selects the narrowest producing dictionary for missing item outputs', () => {
    const selected = productionFallbackDictionary(
      'i:thaumic-tinkerer:ichorium',
      [
        {
          id: 'o:ingotIchorium',
          itemIds: ['i:thaumic-tinkerer:ichorium', 'i:gregtech:ichorium-ingot']
        },
        {
          id: 'o:listAllMaterials',
          itemIds: [
            'i:thaumic-tinkerer:ichorium',
            'i:gregtech:ichorium-ingot',
            'i:gregtech:iron-ingot'
          ]
        }
      ],
      (id) => id === 'i:gregtech:ichorium-ingot' || id === 'i:gregtech:iron-ingot'
    );

    expect(selected?.id).toBe('o:ingotIchorium');
  });

  it('does not invent a fallback when no equivalent member has production', () => {
    expect(productionFallbackDictionary(
      'i:mod:unobtainable',
      [{ id: 'o:unobtainable', itemIds: ['i:mod:unobtainable', 'i:other:unobtainable'] }],
      () => false
    )).toBeUndefined();
  });

  it('cannot select anonymous groups when only named dictionaries are supplied', () => {
    expect(productionFallbackDictionary(
      'i:mod:iron',
      [],
      () => true
    )).toBeUndefined();
  });
});
