import { describe, expect, it } from 'vitest';
import { itemNavigationResolver } from '../src/lib/itemNavigation';
import type { CatalogEntry } from '../src/lib/types';

const tool = (id: string, nbt: string, productionCount = 0): CatalogEntry => ({
  id,
  nbt,
  productionCount,
  mod: 'gregtech',
  internalName: 'gt.metatool.01',
  damage: 12,
  name: 'Hammer',
  kind: 'item',
  tooltip: [],
  color: '#aaa',
  glyph: '',
  searchable: true,
});
const quest = tool(
  'quest',
  '{GT.ToolStats:{PrimaryMaterial:"Iron",SecondaryMaterial:"Wood",MaxDamage:25600L},ench:[0:{lvl:1s,id:16s}]}',
);
const recipe = tool(
  'recipe',
  '{ench:[0:{id:16s,lvl:1s}],GT.ToolStats:{Mode:0b,MaxDamage:25600L,SecondaryMaterial:"Wood",PrimaryMaterial:"Iron"}}',
  3,
);
describe('semantic item navigation', () => {
  it('resolves omitted native defaults and compound order without changing the source stack', () => {
    const before = structuredClone(quest);
    expect(itemNavigationResolver([quest, recipe])(quest)).toBe('recipe');
    expect(quest).toEqual(before);
  });
  it('keeps material, mode, enchantment, charge, metadata and unrelated families distinct', () => {
    const others = [
      { ...recipe, id: 'steel', nbt: recipe.nbt!.replace('Iron', 'Steel') },
      { ...recipe, id: 'mode', nbt: recipe.nbt!.replace('Mode:0b', 'Mode:1b') },
      { ...recipe, id: 'ench', nbt: recipe.nbt!.replace('lvl:1s', 'lvl:2s') },
      { ...recipe, id: 'charge', nbt: recipe.nbt!.replace('Mode:0b', 'Mode:0b,Charge:100L') },
      { ...recipe, id: 'metadata', damage: 14 },
      { ...recipe, id: 'family', mod: 'anotherMod' },
    ];
    expect(itemNavigationResolver([quest, ...others])(quest)).toBe('quest');
    const unrelated = { ...quest, mod: 'anotherMod' };
    expect(itemNavigationResolver([unrelated, { ...recipe, mod: 'anotherMod' }])(unrelated)).toBe(
      'quest',
    );
  });
  it('does not erase a similarly named root field when its configured parent is absent', () => {
    const root = tool('root', '{Mode:0b}');
    expect(itemNavigationResolver([root, tool('empty', '{}', 1)])(root)).toBe('root');
  });
  it('preserves working exact destinations and handles malformed NBT conservatively', () => {
    expect(
      itemNavigationResolver([recipe, { ...recipe, id: 'other', productionCount: 4 }])(recipe),
    ).toBe('recipe');
    const invalid = tool('invalid', '{broken');
    expect(itemNavigationResolver([invalid, recipe])(invalid)).toBe('invalid');
    const opaque = { ...quest, nbt: undefined, variantNbtKey: 'opaque' };
    expect(itemNavigationResolver([opaque, tool('plain', '{}', 1)])(opaque)).toBe('quest');
  });
});
