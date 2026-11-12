import { nbtIdentity } from './nbt';
import type { CatalogEntry } from './types';

// GTNH 2.9.0 / GT5-Unofficial 5.09.54.265, MetaGeneratedTool:
// getToolMode reads a byte (absent => 0), getToolWithStats writes Mode:0b.
// https://github.com/GTNewHorizons/GT5-Unofficial/blob/5.09.54.265/src/main/java/gregtech/api/items/MetaGeneratedTool.java
// Defaults are scoped to a registry family, never inferred from names/icons.
const defaultsByRegistry: Record<string, readonly { path: readonly string[]; value: string }[]> = {
  'gregtech:gt.metatool.01': [{ path: ['GT.ToolStats', 'Mode'], value: '0b' }]
};

export function itemNavigationIdentity(entry: CatalogEntry): string | undefined {
  if (entry.kind !== 'item' || !entry.internalName) return undefined;
  if (entry.variantNbtKey && !entry.nbt) return undefined;
  const registry = `${entry.mod}:${entry.internalName}`;
  try {
    return JSON.stringify([registry, entry.damage ?? 0, nbtIdentity(entry.nbt || '{}', defaultsByRegistry[registry])]);
  } catch {
    // An unsupported NBT syntax must never cause a speculative alias.
    return undefined;
  }
}
const recipes = (entry: CatalogEntry) => (entry.productionCount ?? 0) + (entry.specialProductionCount ?? 0);
const connections = (entry: CatalogEntry) => recipes(entry) + (entry.usageCount ?? 0) + (entry.specialUsageCount ?? 0);

/** Index equivalent exported stacks, keeping their exact presentation separate
 * from navigation. Every unlisted NBT field and numeric type remains identity. */
export function itemNavigationResolver(entries: Iterable<CatalogEntry>): (entry: CatalogEntry) => string {
  const candidates = new Map<string, CatalogEntry>();
  const keys = new Map<string, string>();
  for (const entry of entries) {
    const key = itemNavigationIdentity(entry);
    if (!key) continue;
    keys.set(entry.id, key);
    if (!connections(entry)) continue;
    const previous = candidates.get(key);
    if (!previous || recipes(entry) > recipes(previous)
      || (recipes(entry) === recipes(previous) && connections(entry) > connections(previous))
      || (recipes(entry) === recipes(previous) && connections(entry) === connections(previous) && entry.id < previous.id)) {
      candidates.set(key, entry);
    }
  }
  return entry => {
    if (recipes(entry)) return entry.id;
    const key = keys.get(entry.id), candidate = key && candidates.get(key);
    if (!candidate || (!recipes(candidate) && connections(entry))) return entry.id;
    return candidate.id;
  };
}
