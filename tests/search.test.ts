import { describe, expect, it } from 'vitest';
import { entries } from '../src/lib/demo';
import { normalize, searchCatalog } from '../src/lib/search';

describe('catalog search', () => {
  it('normalizes punctuation and case', () => expect(normalize('  Large—CHEMICAL!  ')).toBe('large chemical'));
  it('supports multi-word searches', () => expect(searchCatalog(entries, 'naquadah alloy')[0].name).toBe('Naquadah Alloy Ingot'));
  it('supports @mod filters', () => expect(searchCatalog(entries, 'ingot @bart')[0].mod).toBe('BartWorks'));
  it('ranks exact matches before prefixes and substrings', () => expect(searchCatalog(entries, 'diamond')[0].name).toBe('Diamond'));
});
