import { describe, expect, it } from 'vitest';
import { buildCatalogBrowseEntries } from '../src/lib/catalogVariants';
import { querySearchMask, searchMaskContains } from '../src/lib/searchMask';
import type { CatalogEntry } from '../src/lib/types';

function entry(overrides: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'name'>): CatalogEntry {
  return {
    mod: 'GregTech',
    kind: 'item',
    tooltip: [],
    color: '#aaa',
    glyph: '□',
    searchable: true,
    ...overrides
  };
}

describe('catalog variant families', () => {
  it('groups exact NBT stacks by registry name and damage', () => {
    const entries = [
      entry({
        id: 'i:gregtech:gt.metatool.01:170:a',
        name: 'Small Ichorium Turbine',
        internalName: 'gregtech:gt.metatool.01',
        damage: 170,
        nbt: '{material:ichorium}'
      }),
      entry({
        id: 'i:gregtech:gt.metatool.01:170:b',
        name: 'Small Steel Turbine',
        internalName: 'gregtech:gt.metatool.01',
        damage: 170,
        nbt: '{material:steel}'
      })
    ];

    const [family] = buildCatalogBrowseEntries(entries);
    expect(family?.isVariantGroup).toBe(true);
    expect(family?.variantCount).toBe(2);
    expect(family?.variantIds).toEqual([
      'i:gregtech:gt.metatool.01:170:a',
      'i:gregtech:gt.metatool.01:170:b'
    ]);
  });

  it('does not merge ordinary metadata items or distinct tool sizes', () => {
    const entries = [
      entry({ id: 'one', name: 'One', internalName: 'mod:item', damage: 1, nbt: null }),
      entry({ id: 'two', name: 'Two', internalName: 'mod:item', damage: 1, nbt: null }),
      entry({ id: 'small', name: 'Small Tool', internalName: 'mod:tool', damage: 10, nbt: '{}' }),
      entry({ id: 'large', name: 'Large Tool', internalName: 'mod:tool', damage: 12, nbt: '{}' })
    ];

    expect(buildCatalogBrowseEntries(entries)).toHaveLength(4);
  });
});

describe('upstream search masks', () => {
  it('rejects a term whose character trigrams are absent', () => {
    const turbine = querySearchMask('Small Ichorium Turbine');
    expect(searchMaskContains(turbine, querySearchMask('ichorium'))).toBe(true);
    expect(searchMaskContains(turbine, querySearchMask('naquadah'))).toBe(false);
  });
});
