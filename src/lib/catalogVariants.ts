import { describeGtOreVariant } from './gtOreVariants';
import type { CatalogBrowseEntry, CatalogEntry } from './types';

interface VariantFamily {
  key: string;
  kind: 'exact' | 'gtOre';
  label?: string;
  order: number;
}

function variantFamily(entry: CatalogEntry): VariantFamily | null {
  if (
    entry.kind === 'item'
    && entry.nbt
    && entry.internalName
    && entry.damage !== undefined
  ) {
    return {
      key: `${entry.kind}\u0000${entry.internalName}\u0000${entry.damage}`,
      kind: 'exact',
      order: 0
    };
  }

  const ore = describeGtOreVariant(entry);
  if (!ore) return null;
  return {
    key: ore.familyKey,
    kind: 'gtOre',
    label: ore.hostStone,
    order: ore.order
  };
}

function stableGroupId(key: string): string {
  return `variants:${encodeURIComponent(key)}`;
}

export function buildCatalogBrowseEntries(entries: CatalogEntry[]): CatalogBrowseEntry[] {
  const searchable = entries.filter((entry) => entry.searchable !== false);
  const families = new Map<string, {
    kind: VariantFamily['kind'];
    members: Array<{ entry: CatalogEntry; label?: string; order: number }>;
  }>();
  const result: CatalogBrowseEntry[] = [];

  for (const entry of searchable) {
    const family = variantFamily(entry);
    if (!family) {
      result.push({
        ...entry,
        variantIds: [entry.id],
        variantCount: 1,
        variantKind: 'single'
      });
      continue;
    }
    const grouped = families.get(family.key) ?? { kind: family.kind, members: [] };
    grouped.members.push({
      entry,
      label: family.label,
      order: family.order
    });
    families.set(family.key, grouped);
  }

  for (const [key, family] of families) {
    family.members.sort((left, right) =>
      left.order - right.order
      || left.entry.name.localeCompare(right.entry.name)
      || left.entry.id.localeCompare(right.entry.id)
    );
    const representative = family.members[0]!.entry;
    if (family.members.length === 1) {
      result.push({
        ...representative,
        variantIds: [representative.id],
        variantCount: 1,
        variantKind: 'single'
      });
      continue;
    }
    const variantLabels = Object.fromEntries(
      family.members
        .filter((member) => member.label !== undefined)
        .map((member) => [member.entry.id, member.label!])
    );
    result.push({
      ...representative,
      id: stableGroupId(key),
      productionShards: undefined,
      usageShards: undefined,
      productionCount: undefined,
      usageCount: undefined,
      machineCapabilities: undefined,
      variantIds: family.members.map((member) => member.entry.id),
      variantCount: family.members.length,
      variantKind: family.kind,
      variantLabels: Object.keys(variantLabels).length > 0 ? variantLabels : undefined
    });
  }

  return result.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function resolveCatalogVariant(
  entry: CatalogBrowseEntry,
  exactEntries: ReadonlyMap<string, CatalogEntry>,
  cycle: number
): CatalogEntry {
  if (entry.variantKind === 'single' || entry.variantIds.length === 0) return entry;
  const variantId = entry.variantIds[cycle % entry.variantIds.length];
  return exactEntries.get(variantId!) ?? entry;
}
