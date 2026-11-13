import { describe, expect, it } from 'vitest';
import { buildCatalogBrowseEntries } from '../src/lib/catalogVariants';
import { landingShowcase } from '../src/lib/landingShowcase';
import type { CatalogEntry } from '../src/lib/types';

function item(id: string, sheet = 'sheet-0', family?: string): CatalogEntry {
  return {
    id,
    name: id,
    kind: 'item',
    mod: 'Test',
    tooltip: [],
    color: '#aaa',
    glyph: '□',
    internalName: family,
    damage: family ? 1 : undefined,
    nbt: family ? `{material:${id}}` : undefined,
    icon: { url: sheet, index: 0, columns: 8 },
  };
}
function sample(entries: CatalogEntry[], random = () => 0.5) {
  return landingShowcase(
    buildCatalogBrowseEntries(entries),
    new Map(entries.map((entry) => [entry.id, entry])),
    random,
  );
}

describe('landing showcase families', () => {
  it('allocates one slot to a large tool family alongside single items', () => {
    const tools = Array.from({ length: 500 }, (_, index) =>
      item(`tool-${index}`, 'sheet-0', 'tool'),
    );
    const singles = Array.from({ length: 79 }, (_, index) => item(`single-${index}`));
    const rows = sample([...tools, ...singles]);
    expect(rows.map((row) => row.length)).toEqual([20, 20, 20, 20]);
    expect(new Set(rows.flat().map((entry) => entry.id)).size).toBe(80);
    expect(rows.flat().filter((entry) => entry.variantKind !== 'single')).toHaveLength(1);
    expect(rows.flat().find((entry) => entry.variantKind !== 'single')?.variantIds).toHaveLength(
      500,
    );
  });

  it('limits cycling members to six distinct sheets without changing source families', () => {
    const entries = Array.from({ length: 12 }, (_, index) =>
      item(`tool-${index}`, `sheet-${index}`, 'tool'),
    );
    const families = buildCatalogBrowseEntries(entries);
    const exact = new Map(entries.map((entry) => [entry.id, entry]));
    const first = landingShowcase(families, exact, () => 0).flat();
    const second = landingShowcase(families, exact, () => 0.99).flat();
    expect(first).toHaveLength(1);
    expect(first[0]!.variantIds).toHaveLength(6);
    expect(first[0]!.variantIds).not.toEqual(second[0]!.variantIds);
    expect(families[0]!.variantIds).toHaveLength(12);
  });

  it('handles empty/small catalogues and excludes hidden or iconless entries', () => {
    expect(sample([])).toEqual([[], [], [], []]);
    expect(sample([item('one')]).flat()).toHaveLength(1);
    expect(sample([item('one'), item('two')]).map((row) => row.length)).toEqual([1, 1, 0, 0]);
    expect(
      sample([
        { ...item('hidden'), searchable: false },
        { ...item('iconless'), icon: undefined },
      ]).flat(),
    ).toEqual([]);
  });

  it('caps unique slots and randomizes the selection on a fresh visit', () => {
    const entries = Array.from({ length: 120 }, (_, index) => item(`item-${index}`));
    const first = sample(entries, () => 0)
      .flat()
      .map((entry) => entry.id);
    const second = sample(entries, () => 0.99)
      .flat()
      .map((entry) => entry.id);
    expect(first).toHaveLength(80);
    expect(new Set(first).size).toBe(80);
    expect(first).not.toEqual(second);
  });
});
