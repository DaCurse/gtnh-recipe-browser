import { describe, expect, it } from 'vitest';
import { isCatalogSort, sortCatalog } from '../src/lib/catalog/catalogSort';
import type { CatalogBrowseEntry } from '../src/lib/types';

const entries = Array.from(
  { length: 18 },
  (_, index) =>
    ({
      id: `i:mod${index % 3}:item:${index}`,
      name: `Item ${String(18 - index).padStart(2, '0')}`,
      mod: `mod${index % 3}`,
      kind: 'item',
      numericId: index,
      damage: 0,
      variantIds: [`item:${index}`],
      variantCount: index + 1,
      variantKind: 'single',
    }) as CatalogBrowseEntry,
);
const ids = (values: CatalogBrowseEntry[]) => values.map((entry) => entry.id);

describe('catalogue sort choices', () => {
  it('interleaves mods with stable family ordering independent of source order and shuffle seed', () => {
    const mixed = sortCatalog(entries, 'mixed');
    expect(ids(mixed)).toEqual(ids(sortCatalog([...entries].reverse(), 'mixed', 142)));
    for (let i = 0; i < mixed.length; i += 3)
      expect(new Set(mixed.slice(i, i + 3).map((entry) => entry.mod)).size).toBe(3);
    expect(new Set(ids(mixed)).size).toBe(entries.length);
    expect(mixed).toHaveLength(entries.length);
  });
  it('handles uneven mod sizes and small catalogues without losing families', () => {
    const uneven = entries.filter((entry) => entry.mod === 'mod0' || entry.numericId === 1);
    expect(new Set(ids(sortCatalog(uneven, 'mixed')))).toEqual(new Set(ids(uneven)));
    expect(sortCatalog([], 'mixed')).toEqual([]);
    expect(sortCatalog(entries.slice(0, 1), 'mixed')).toEqual(entries.slice(0, 1));
  });
  it('keeps seeded shuffle stable for pagination, changes with its seed, and never mutates input', () => {
    const original = ids(entries);
    expect(ids(sortCatalog(entries, 'shuffle', 123))).toEqual(
      ids(sortCatalog([...entries].reverse(), 'shuffle', 123)),
    );
    expect(ids(sortCatalog(entries, 'shuffle', 123))).not.toEqual(
      ids(sortCatalog(entries, 'shuffle', 456)),
    );
    expect(new Set(ids(sortCatalog(entries, 'shuffle', 123)))).toEqual(new Set(original));
    expect(ids(entries)).toEqual(original);
  });
  it('provides numeric, alphabetical and mod ordering with validated persisted choices', () => {
    expect(ids(sortCatalog([...entries].reverse(), 'id'))).toEqual(ids(entries));
    expect(sortCatalog(entries, 'name')[0]?.name).toBe('Item 01');
    expect(
      sortCatalog(entries, 'mod')
        .slice(0, 6)
        .every((entry) => entry.mod === 'mod0'),
    ).toBe(true);
    expect(isCatalogSort('shuffle')).toBe(true);
    expect(isCatalogSort('obsolete')).toBe(false);
    expect(isCatalogSort(null)).toBe(false);
  });
});
