import { minecraftHtmlPlainText } from '../lib/minecraftText';
import { normalize } from '../lib/search';
import { querySearchMask, searchMaskContains } from '../lib/searchMask';

interface SearchMember {
  id: string;
  name: string;
  mod: string;
  rawTooltip?: string | null;
  searchMask?: number[];
}

interface SearchEntry {
  id: string;
  name: string;
  mod: string;
  members: SearchMember[];
}

interface SearchMemberDocument {
  normalizedId: string;
  normalizedName: string;
  normalizedMod: string;
  normalizedTooltip: string;
  searchMask: number[];
}

interface SearchDocument {
  id: string;
  name: string;
  normalizedName: string;
  members: SearchMemberDocument[];
}

type WorkerRequest =
  | { type: 'init'; generation: number }
  | { type: 'append'; generation: number; catalog: SearchEntry[]; completed: number; total: number }
  | { type: 'finish'; generation: number }
  | { type: 'search'; generation: number; id: number; query: string; offset: number; limit: number };

let generation = 0;
let catalog: SearchDocument[] = [];
let lastQuery: string | null = null;
let lastMatches: SearchDocument[] = [];
let searchToken = 0;

function document(entry: SearchEntry): SearchDocument {
  return {
    id: entry.id,
    name: entry.name,
    normalizedName: normalize(entry.name),
    members: entry.members.map((member) => ({
      normalizedId: normalize(member.id),
      normalizedName: normalize(member.name),
      normalizedMod: normalize(member.mod),
      normalizedTooltip: normalize(minecraftHtmlPlainText(member.rawTooltip)),
      searchMask: member.searchMask ?? []
    }))
  };
}

function memberMatches(
  member: SearchMemberDocument,
  terms: string[],
  termMasks: number[][],
  modFilters: string[]
): boolean {
  if (!modFilters.every((filter) => member.normalizedMod.includes(filter))) return false;
  return terms.every((term, index) => {
    if (member.normalizedId.includes(term) || member.normalizedMod.includes(term)) return true;
    if (!searchMaskContains(member.searchMask, termMasks[index]!)) return false;
    return member.normalizedName.includes(term) || member.normalizedTooltip.includes(term);
  });
}

function score(entry: SearchDocument, terms: string[]): number {
  if (!terms.length) return 0;
  const phrase = terms.join(' ');
  let best = entry.normalizedName === phrase ? 300 : entry.normalizedName.startsWith(phrase) ? 200 : 0;
  for (const member of entry.members) {
    if (member.normalizedName === phrase) best = Math.max(best, 300);
    else if (member.normalizedName.startsWith(phrase)) best = Math.max(best, 200);
    else {
      best = Math.max(
        best,
        terms.reduce(
          (total, term) => total + (member.normalizedName.startsWith(term) ? 20 : 5),
          0
        )
      );
    }
  }
  return best;
}

function yieldToNewerRequests(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function search(
  request: Extract<WorkerRequest, { type: 'search' }>,
  token: number
): Promise<void> {
  if (request.query !== lastQuery) {
    const tokens = normalize(request.query).split(/\s+/).filter(Boolean);
    const modFilters = tokens.filter((item) => item.startsWith('@')).map((item) => item.slice(1));
    const terms = tokens.filter((item) => !item.startsWith('@'));
    const termMasks = terms.map(querySearchMask);
    const matches: SearchDocument[] = [];
    for (let start = 0; start < catalog.length; start += 1_000) {
      const end = Math.min(start + 1_000, catalog.length);
      for (let index = start; index < end; index += 1) {
        const entry = catalog[index]!;
        if (
          tokens.length === 0
          || entry.members.some((member) => memberMatches(member, terms, termMasks, modFilters))
        ) matches.push(entry);
      }
      if (end < catalog.length) {
        await yieldToNewerRequests();
        if (token !== searchToken || request.generation !== generation) return;
      }
    }
    matches.sort((left, right) =>
      score(right, terms) - score(left, terms) || left.name.localeCompare(right.name)
    );
    if (token !== searchToken || request.generation !== generation) return;
    lastQuery = request.query;
    lastMatches = matches;
  }

  self.postMessage({
    type: 'results',
    generation: request.generation,
    id: request.id,
    offset: request.offset,
    total: lastMatches.length,
    ids: lastMatches
      .slice(request.offset, request.offset + request.limit)
      .map((entry) => entry.id)
  });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'init') {
    generation = request.generation;
    catalog = [];
    lastQuery = null;
    lastMatches = [];
    searchToken += 1;
    return;
  }
  if (request.generation !== generation) return;
  if (request.type === 'append') {
    catalog.push(...request.catalog.map(document));
    self.postMessage({
      type: 'progress',
      generation,
      completed: request.completed,
      total: request.total
    });
    return;
  }
  if (request.type === 'finish') {
    self.postMessage({ type: 'ready', generation });
    return;
  }
  const token = ++searchToken;
  void search(request, token);
};
