import { normalize } from '../lib/search';

interface SearchEntry {
  id: string;
  name: string;
  mod: string;
}

interface SearchDocument extends SearchEntry {
  normalizedId: string;
  normalizedName: string;
  normalizedMod: string;
  haystack: string;
}

type WorkerRequest =
  | { type: 'init'; catalog: SearchEntry[] }
  | { type: 'search'; id: number; query: string };

let catalog: SearchDocument[] = [];

function score(entry: SearchDocument, terms: string[]): number {
  if (!terms.length) return 0;
  const phrase = terms.join(' ');
  if (entry.normalizedName === phrase) return 300;
  if (entry.normalizedName.startsWith(phrase)) return 200;
  return terms.reduce((total, term) => total + (entry.normalizedName.startsWith(term) ? 20 : 5), 0);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'init') {
    catalog = request.catalog.map((entry) => {
      const normalizedName = normalize(entry.name);
      const normalizedMod = normalize(entry.mod);
      const normalizedId = normalize(entry.id);
      return {
        ...entry,
        normalizedName,
        normalizedMod,
        normalizedId,
        haystack: `${normalizedName} ${normalizedMod} ${normalizedId}`
      };
    });
    self.postMessage({ type: 'ready' });
    return;
  }

  const tokens = normalize(request.query).split(/\s+/).filter(Boolean);
  const modFilters = tokens.filter((token) => token.startsWith('@')).map((token) => token.slice(1));
  const terms = tokens.filter((token) => !token.startsWith('@'));
  const matches = tokens.length === 0
    ? catalog
    : catalog
      .filter((entry) => modFilters.every((filter) => entry.normalizedMod.includes(filter)) &&
        terms.every((term) => entry.haystack.includes(term)))
      .sort((a, b) => score(b, terms) - score(a, terms) || a.name.localeCompare(b.name));

  self.postMessage({
    type: 'results',
    id: request.id,
    total: matches.length,
    ids: matches.slice(0, 300).map((entry) => entry.id)
  });
};
