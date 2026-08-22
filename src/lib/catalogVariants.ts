import { describeGtOreVariant } from './gtOreVariants';
import type { CatalogBrowseEntry, CatalogEntry } from './types';

interface VariantFamily {
  key: string;
  kind: 'exact' | 'gtOre';
  label?: string;
  order: number;
}

/** Split a compound NBT value without treating commas inside nested values as separators. */
function splitNbtFields(value: string): string[] {
  const fields: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && quote) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quote = !quote;
      continue;
    }
    if (quote) continue;
    if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') depth = Math.max(0, depth - 1);
    else if (character === ',' && depth === 0) {
      fields.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) fields.push(last);
  return fields;
}

/**
 * NBT hashes in the upstream catalog are based on the serialized text.  Two
 * stacks can therefore have different IDs even though their compounds only
 * differ in key order.  Canonicalizing the compound lets the picker collapse
 * those duplicate rows while retaining genuinely different NBT variants.
 */
export function canonicalVariantNbt(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return trimmed;
  const fields = splitNbtFields(trimmed.slice(1, -1));
  fields.sort((left, right) => {
    const leftKey = left.slice(0, left.indexOf(':')).trim();
    const rightKey = right.slice(0, right.indexOf(':')).trim();
    return leftKey.localeCompare(rightKey) || left.localeCompare(right);
  });
  return `{${fields.join(',')}}`;
}

export interface DeduplicatedVariant {
  entry: CatalogEntry;
  duplicateCount: number;
}

function duplicateVariantKey(entry: CatalogEntry): string | undefined {
  const nbt = canonicalVariantNbt(entry.nbt ?? undefined);
  if (!nbt) return undefined;
  return JSON.stringify([
    entry.name,
    entry.mod,
    entry.internalName,
    entry.damage,
    entry.rawTooltip,
    nbt
  ]);
}

function variantRichness(entry: CatalogEntry): number {
  return (entry.specialProductionCount ?? 0) + (entry.specialUsageCount ?? 0) * 2
    + (entry.specialProductionLookupIds?.length ?? 0) + (entry.specialUsageLookupIds?.length ?? 0) * 2
    + (entry.productionCount ?? 0) + (entry.usageCount ?? 0);
}

/** Collapse only serialized-NBT duplicates; all semantically different stacks remain. */
export function deduplicateVariantMembers(entries: readonly CatalogEntry[]): DeduplicatedVariant[] {
  const groups = new Map<string, { firstIndex: number; entries: CatalogEntry[] }>();
  entries.forEach((entry, index) => {
    const key = duplicateVariantKey(entry) ?? `unique:${index}`;
    const group = groups.get(key) ?? { firstIndex: index, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  });
  return [...groups.values()]
    .sort((left, right) => left.firstIndex - right.firstIndex)
    .map((group) => ({
      entry: [...group.entries].sort((left, right) =>
        variantRichness(right) - variantRichness(left) || left.id.localeCompare(right.id))[0]!,
      duplicateCount: group.entries.length
    }));
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
