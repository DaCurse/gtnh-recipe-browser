import { describe, expect, it } from 'vitest';
import { buildCatalogBrowseEntries, resolveCatalogVariant } from '../src/lib/catalogVariants';
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

  it('cycles a grouped row through its exact variants', () => {
    const entries = [
      entry({
        id: 'ichorium',
        name: 'Small Ichorium Turbine',
        internalName: 'gregtech:gt.metatool.01',
        damage: 170,
        nbt: '{material:ichorium}',
        icon: { url: 'icons.webp', index: 1, columns: 32 }
      }),
      entry({
        id: 'steel',
        name: 'Small Steel Turbine',
        internalName: 'gregtech:gt.metatool.01',
        damage: 170,
        nbt: '{material:steel}',
        icon: { url: 'icons.webp', index: 2, columns: 32 }
      })
    ];
    const [family] = buildCatalogBrowseEntries(entries);
    const exactEntries = new Map(entries.map((item) => [item.id, item]));

    expect(resolveCatalogVariant(family!, exactEntries, 0).id).toBe('ichorium');
    expect(resolveCatalogVariant(family!, exactEntries, 1).id).toBe('steel');
    expect(resolveCatalogVariant(family!, exactEntries, 2).id).toBe('ichorium');
  });
});

describe('upstream search masks', () => {
  it('rejects a term whose character trigrams are absent', () => {
    const turbine = querySearchMask('Small Ichorium Turbine');
    expect(searchMaskContains(turbine, querySearchMask('ichorium'))).toBe(true);
    expect(searchMaskContains(turbine, querySearchMask('naquadah'))).toBe(false);
  });
});
