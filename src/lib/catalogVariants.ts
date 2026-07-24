import type { CatalogBrowseEntry, CatalogEntry } from './types';

function variantFamilyKey(entry: CatalogEntry): string | null {
  if (
    entry.kind !== 'item'
    || !entry.nbt
    || !entry.internalName
    || entry.damage === undefined
  ) return null;
  return `${entry.kind}\u0000${entry.internalName}\u0000${entry.damage}`;
}

function stableGroupId(key: string): string {
  return `variants:${encodeURIComponent(key)}`;
}

export function buildCatalogBrowseEntries(entries: CatalogEntry[]): CatalogBrowseEntry[] {
  const searchable = entries.filter((entry) => entry.searchable !== false);
  const families = new Map<string, CatalogEntry[]>();
  const result: CatalogBrowseEntry[] = [];

  for (const entry of searchable) {
    const key = variantFamilyKey(entry);
    if (!key) {
      result.push({
        ...entry,
        variantIds: [entry.id],
        variantCount: 1,
        isVariantGroup: false
      });
      continue;
    }
    const family = families.get(key) ?? [];
    family.push(entry);
    families.set(key, family);
  }

  for (const [key, members] of families) {
    members.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    const representative = members[0]!;
    if (members.length === 1) {
      result.push({
        ...representative,
        variantIds: [representative.id],
        variantCount: 1,
        isVariantGroup: false
      });
      continue;
    }
    result.push({
      ...representative,
      id: stableGroupId(key),
      productionShards: undefined,
      usageShards: undefined,
      productionCount: undefined,
      usageCount: undefined,
      machineCapabilities: undefined,
      variantIds: members.map((member) => member.id),
      variantCount: members.length,
      isVariantGroup: true
    });
  }

  return result.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function resolveCatalogVariant(
  entry: CatalogBrowseEntry,
  exactEntries: ReadonlyMap<string, CatalogEntry>,
  cycle: number
): CatalogEntry {
  if (!entry.isVariantGroup || entry.variantIds.length === 0) return entry;
  const variantId = entry.variantIds[cycle % entry.variantIds.length];
  return exactEntries.get(variantId!) ?? entry;
}
