import { compareCatalogOrder } from './catalogOrder';
import type { CatalogBrowseEntry } from './types';

export const catalogSortOptions = [
  {
    value: 'mixed',
    label: 'Mixed',
    description: 'A stable mix of mods, with varied items from each.',
  },
  { value: 'id', label: 'Item ID', description: 'Numeric item order, like NEI.' },
  { value: 'name', label: 'Name', description: 'Item names from A to Z.' },
  {
    value: 'mod',
    label: 'Mod → Item ID',
    description: 'Mods from A to Z, then numeric item order.',
  },
  {
    value: 'shuffle',
    label: 'Shuffle',
    description: 'A random mix to explore. Reshuffle for a fresh order.',
  },
] as const;
export type CatalogSort = (typeof catalogSortOptions)[number]['value'];
export function isCatalogSort(value: unknown): value is CatalogSort {
  return catalogSortOptions.some((option) => option.value === value);
}

// Stable ID hashes avoid dependence on input order, family size, or JS sort randomness.
function hash(value: string, seed = 0): number {
  let result = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  }
  result ^= result >>> 16;
  result = Math.imul(result, 0x85ebca6b);
  result ^= result >>> 13;
  return result >>> 0;
}

export function sortCatalog(
  entries: readonly CatalogBrowseEntry[],
  mode: CatalogSort,
  seed = 0,
): CatalogBrowseEntry[] {
  const compareId = (a: CatalogBrowseEntry, b: CatalogBrowseEntry) => a.id.localeCompare(b.id);
  const hashes = new Map(
    mode === 'mixed' || mode === 'shuffle'
      ? entries.map((entry) => [entry.id, hash(entry.id, mode === 'shuffle' ? seed : 0)])
      : [],
  );
  const shuffled = (a: CatalogBrowseEntry, b: CatalogBrowseEntry) =>
    hashes.get(a.id)! - hashes.get(b.id)! || compareId(a, b);
  if (mode === 'mixed') {
    const groups = new Map<string, CatalogBrowseEntry[]>();
    for (const entry of entries) {
      const group = groups.get(entry.mod) ?? [];
      group.push(entry);
      groups.set(entry.mod, group);
    }
    const queues = [...groups.entries()]
      .sort(([a], [b]) => hash(a) - hash(b) || a.localeCompare(b))
      .map(([, group]) => group.sort(shuffled));
    const result: CatalogBrowseEntry[] = [];
    // Round-robin mods so a large mod cannot monopolize the first screens.
    for (let row = 0; queues.length; row += 1) {
      for (let index = 0; index < queues.length;) {
        const entry = queues[index]![row];
        if (entry) {
          result.push(entry);
          index += 1;
        } else queues.splice(index, 1);
      }
    }
    return result;
  }
  return [...entries].sort((a, b) => {
    if (mode === 'shuffle') return shuffled(a, b);
    if (mode === 'name') return a.name.localeCompare(b.name) || compareId(a, b);
    if (mode === 'mod') return a.mod.localeCompare(b.mod) || compareCatalogOrder(a, b);
    return compareCatalogOrder(a, b);
  });
}
