import type { CatalogBrowseEntry, CatalogEntry } from './types';

function shuffle<T>(values: T[], random: () => number): T[] {
  for (let index = values.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [values[index], values[other]] = [values[other]!, values[index]!];
  }
  return values;
}

/** Sample families, rather than stacks, within a randomly selected atlas budget. */
export function landingShowcase(
  families: readonly CatalogBrowseEntry[],
  exactEntries: ReadonlyMap<string, CatalogEntry>,
  random: () => number = Math.random
): CatalogBrowseEntry[][] {
  const eligible = families.filter((entry) => entry.searchable !== false);
  const sheets = new Set<string>();
  for (const family of eligible) for (const id of family.variantIds) {
    const icon = exactEntries.get(id)?.icon;
    if (icon) sheets.add(icon.url);
  }
  const selected = new Set(shuffle([...sheets], random).slice(0, 6));
  const visibleMember = (id: string) => {
    const member = exactEntries.get(id);
    return member?.searchable !== false && member?.icon && selected.has(member.icon.url);
  };
  // Reservoir sampling gives each eligible family an equal chance without
  // copying every family and its variants just to keep eighty of them.
  const candidates: CatalogBrowseEntry[] = [];
  let seen = 0;
  for (const family of eligible) {
    if (!family.variantIds.some(visibleMember)) continue;
    seen++;
    if (candidates.length < 80) candidates.push(family);
    else {
      const slot = Math.floor(random() * seen);
      if (slot < 80) candidates[slot] = family;
    }
  }
  const entries = shuffle(candidates, random).map(family => ({ ...family, variantIds: family.variantIds.filter(visibleMember) }));
  // Distribute small catalogues across all four rows as well.
  return Array.from({ length: 4 }, (_, row) => entries.filter((_, index) => index % 4 === row));
}
