import { describe, expect, it } from 'vitest';
import {
  buildCatalogSearchDocument,
  catalogDocumentMatches,
  parseCatalogSearchQuery
} from '../src/lib/catalogSearch';
import { buildCatalogBrowseEntries, resolveCatalogVariant } from '../src/lib/catalogVariants';
import { describeGtOreVariant } from '../src/lib/gtOreVariants';
import { querySearchMask, searchMaskContains } from '../src/lib/searchMask';
import type { CatalogEntry } from '../src/lib/types';
import oreFixture from './fixtures/gtnh-gt-ore-groups.json';

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
    expect(family?.variantKind).toBe('exact');
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

describe('GregTech ore material families', () => {
  function oreEntries(
    series: Array<{ internalName: string; damages: number[] }>
  ): CatalogEntry[] {
    return series.flatMap((group) => group.damages.map((damage) => entry({
      id: `i:gregtech:${group.internalName}:${damage}`,
      name: oreFixture.material.name,
      internalName: group.internalName,
      damage,
      nbt: null
    })));
  }

  it('groups the seven pinned legacy Iron Ore host stones', () => {
    const entries = oreEntries(oreFixture.legacy);
    const [family] = buildCatalogBrowseEntries(entries);

    expect(family?.variantKind).toBe('gtOre');
    expect(family?.variantCount).toBe(7);
    expect(family?.variantIds[0]).toBe('i:gregtech:gt.blockores:32');
    expect(family?.variantLabels).toEqual(Object.fromEntries(
      oreFixture.legacy[0]!.damages.map((damage, index) => [
        `i:gregtech:gt.blockores:${damage}`,
        oreFixture.legacy[0]!.hosts[index]
      ])
    ));
  });

  it('groups all 41 pinned current Iron Ore host stones in stable order', () => {
    const entries = oreEntries(oreFixture.current);
    const [family] = buildCatalogBrowseEntries(entries);

    expect(family?.variantKind).toBe('gtOre');
    expect(family?.variantCount).toBe(41);
    expect(family?.variantIds[0]).toBe('i:gregtech:gt.blockores2:32');
    expect(family?.variantLabels?.['i:gregtech:gt.blockores2:7032']).toBe('Moon');
    expect(family?.variantLabels?.['i:gregtech:gt.blockores3:32']).toBe('Mars');
    expect(family?.variantLabels?.['i:gregtech:gt.blockores7:4032']).toBe('Deepslate');
  });

  it('keeps legacy placeholders, other mods, and unsupported metadata exact', () => {
    const collisionEntries = oreFixture.legacyPlaceholderCollision.map((item) => entry({
      ...item,
      nbt: null
    }));
    const unrelated = entry({
      id: 'i:minecraft:iron_ore:0',
      name: oreFixture.material.name,
      internalName: 'iron_ore',
      damage: 0,
      nbt: null
    });
    const unknownSeries = entry({
      id: 'i:gregtech:gt.blockores8:32',
      name: oreFixture.material.name,
      internalName: 'gt.blockores8',
      damage: 32,
      nbt: null
    });
    const natural = entry({
      id: 'i:gregtech:gt.blockores2:8032',
      name: oreFixture.material.name,
      internalName: 'gt.blockores2',
      damage: 8032,
      nbt: null
    });
    const groups = buildCatalogBrowseEntries([
      ...collisionEntries,
      unrelated,
      unknownSeries,
      natural
    ]);
    const aer = groups.find((candidate) => candidate.name === 'Aer Infused Stone');

    expect(aer?.variantKind).toBe('gtOre');
    expect(aer?.variantCount).toBe(2);
    expect(groups.find((candidate) => candidate.id === collisionEntries[0]!.id)?.variantKind)
      .toBe('single');
    expect(groups.find((candidate) => candidate.id === unrelated.id)?.variantKind).toBe('single');
    expect(groups.find((candidate) => candidate.id === unknownSeries.id)?.variantKind).toBe('single');
    expect(groups.find((candidate) => candidate.id === natural.id)?.variantKind).toBe('single');
  });

  it('decodes host labels independently of catalog ordering', () => {
    const deepslate = entry({
      id: 'i:gregtech:gt.blockores7:4032',
      name: oreFixture.material.name,
      internalName: 'gt.blockores7',
      damage: 4032,
      nbt: null
    });

    expect(describeGtOreVariant(deepslate)).toEqual({
      familyKey: `gtOre\u0000${oreFixture.material.id}\u0000${oreFixture.material.name}`,
      hostStone: 'Deepslate',
      order: 38
    });
  });

  it('matches host-stone terms and mod filters without weakening item masks', () => {
    const document = buildCatalogSearchDocument({
      id: 'variants:iron',
      name: oreFixture.material.name,
      mod: 'gregtech',
      members: [{
        id: 'i:gregtech:gt.blockores7:4032',
        name: oreFixture.material.name,
        mod: 'gregtech',
        variantLabel: 'Deepslate',
        searchMask: querySearchMask(oreFixture.material.name)
      }]
    });

    expect(catalogDocumentMatches(document, parseCatalogSearchQuery('deepslate iron'))).toBe(true);
    expect(catalogDocumentMatches(document, parseCatalogSearchQuery('iron @gregtech'))).toBe(true);
    expect(catalogDocumentMatches(document, parseCatalogSearchQuery('moon iron'))).toBe(false);
  });
});

describe('upstream search masks', () => {
  it('rejects a term whose character trigrams are absent', () => {
    const turbine = querySearchMask('Small Ichorium Turbine');
    expect(searchMaskContains(turbine, querySearchMask('ichorium'))).toBe(true);
    expect(searchMaskContains(turbine, querySearchMask('naquadah'))).toBe(false);
  });
});
