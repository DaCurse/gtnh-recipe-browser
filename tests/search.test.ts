import { describe, expect, it } from 'vitest';
import { entries } from './support/demo';
import { normalize, searchCatalog } from '../src/lib/search';

describe('catalog search', () => {
  it('normalizes punctuation and case', () => expect(normalize('  Large—CHEMICAL!  ')).toBe('large chemical'));
  it('supports multi-word searches', () => expect(searchCatalog(entries, 'naquadah alloy')[0].name).toBe('Naquadah Alloy Ingot'));
  it('supports @mod filters', () => expect(searchCatalog(entries, 'ingot @bart')[0].mod).toBe('BartWorks'));
  it('keeps numeric ID order when filtering, including ahead of an exact name match', () => {
    const variants = [
      { ...entries[0]!, id: 'i:fixture:diamond:0', name: 'Diamond', numericId: 20, damage: 0 },
      { ...entries[0]!, id: 'i:fixture:ore:2', name: 'Diamond Ore', numericId: 1, damage: 2 },
      { ...entries[0]!, id: 'i:fixture:ore:0', name: 'Diamond Ore', numericId: 1, damage: 0 }
    ];
    expect(searchCatalog(variants, 'diamond').map(entry => entry.id)).toEqual([
      'i:fixture:ore:0', 'i:fixture:ore:2', 'i:fixture:diamond:0'
    ]);
  });
});
