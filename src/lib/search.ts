import type { CatalogEntry } from './types';

export function normalize(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase().replace(/[^a-z0-9@:+.-]+/g, ' ').trim();
}

export function searchCatalog(catalog: CatalogEntry[], rawQuery: string): CatalogEntry[] {
  const tokens = normalize(rawQuery).split(/\s+/).filter(Boolean);
  const modFilters = tokens.filter((t) => t.startsWith('@')).map((t) => t.slice(1));
  const terms = tokens.filter((t) => !t.startsWith('@'));

  return catalog
    .filter((entry) => {
      const name = normalize(entry.name);
      const mod = normalize(entry.mod);
      return modFilters.every((filter) => mod.includes(filter)) &&
        terms.every((term) => `${name} ${mod} ${normalize(entry.id)}`.includes(term));
    })
    .sort((a, b) => score(b, terms) - score(a, terms) || a.name.localeCompare(b.name));
}

function score(entry: CatalogEntry, terms: string[]): number {
  if (!terms.length) return 0;
  const name = normalize(entry.name);
  const phrase = terms.join(' ');
  if (name === phrase) return 300;
  if (name.startsWith(phrase)) return 200;
  return terms.reduce((total, term) => total + (name.startsWith(term) ? 20 : 5), 0);
}
