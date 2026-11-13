import type { CatalogEntry } from './types';

export function catalogRegistryKey(id: string): string {
  return id.startsWith('i:') ? id.split(':').slice(0, 3).join(':') : id;
}

type SortableEntry = Pick<CatalogEntry, 'kind' | 'numericId' | 'damage' | 'name' | 'id'>;
const kindOrder = { item: 0, fluid: 1, oreDict: 2, itemGroup: 3 };
/** NEI's numeric registry ID followed by metadata; fluids have their own registry. */
export function compareCatalogOrder(left: SortableEntry, right: SortableEntry): number {
  return kindOrder[left.kind] - kindOrder[right.kind]
    || (left.numericId ?? Number.MAX_SAFE_INTEGER) - (right.numericId ?? Number.MAX_SAFE_INTEGER)
    || (left.damage ?? 0) - (right.damage ?? 0)
    || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}
