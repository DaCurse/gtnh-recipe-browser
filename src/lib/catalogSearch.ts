import { minecraftHtmlPlainText } from './minecraftText';
import { normalize } from './search';
import { querySearchMask, searchMaskContains } from './searchMask';
import type { CatalogBrowseEntry, CatalogEntry } from './types';

interface CatalogSearchMember {
  id: string;
  name: string;
  mod: string;
  variantLabel?: string;
  rawTooltip?: string | null;
  searchMask?: number[];
}

export interface CatalogSearchEntry {
  id: string;
  name: string;
  mod: string;
  members: CatalogSearchMember[];
}

interface CatalogSearchMemberDocument {
  normalizedId: string;
  normalizedName: string;
  normalizedMod: string;
  normalizedVariantLabel: string;
  normalizedTooltip: string;
  searchMask: number[];
}

export interface CatalogSearchDocument {
  id: string;
  name: string;
  normalizedName: string;
  members: CatalogSearchMemberDocument[];
}

export interface CatalogSearchQuery {
  tokens: string[];
  terms: string[];
  termMasks: number[][];
  modFilters: string[];
}

function buildCatalogSearchEntries(
  catalog: readonly CatalogBrowseEntry[],
  exactCatalog: readonly CatalogEntry[]
): CatalogSearchEntry[] {
  const exactById = new Map(exactCatalog.map((entry) => [entry.id, entry]));
  return catalog
    .filter((entry) => entry.searchable !== false)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      mod: entry.mod,
      members: entry.variantIds
        .map((id) => exactById.get(id))
        .filter((member): member is CatalogEntry => member !== undefined)
        .map((member) => ({
          id: member.id,
          name: member.name,
          mod: member.mod,
          variantLabel: entry.variantLabels?.[member.id],
          rawTooltip: member.rawTooltip,
          searchMask: [...(member.searchMask ?? [])]
        }))
    }));
}

export function buildCatalogSearchDocuments(
  catalog: readonly CatalogBrowseEntry[],
  exactCatalog: readonly CatalogEntry[]
): CatalogSearchDocument[] {
  return buildCatalogSearchEntries(catalog, exactCatalog).map(buildCatalogSearchDocument);
}

export function buildCatalogSearchDocument(entry: CatalogSearchEntry): CatalogSearchDocument {
  return {
    id: entry.id,
    name: entry.name,
    normalizedName: normalize(entry.name),
    members: entry.members.map((member) => ({
      normalizedId: normalize(member.id),
      normalizedName: normalize(member.name),
      normalizedMod: normalize(member.mod),
      normalizedVariantLabel: normalize(member.variantLabel ?? ''),
      normalizedTooltip: normalize(minecraftHtmlPlainText(member.rawTooltip)),
      searchMask: member.searchMask ?? []
    }))
  };
}

export function parseCatalogSearchQuery(query: string): CatalogSearchQuery {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  const modFilters = tokens.filter((item) => item.startsWith('@')).map((item) => item.slice(1));
  const terms = tokens.filter((item) => !item.startsWith('@'));
  return {
    tokens,
    terms,
    termMasks: terms.map(querySearchMask),
    modFilters
  };
}

function memberMatches(member: CatalogSearchMemberDocument, query: CatalogSearchQuery): boolean {
  if (!query.modFilters.every((filter) => member.normalizedMod.includes(filter))) return false;
  return query.terms.every((term, index) => {
    if (
      member.normalizedId.includes(term)
      || member.normalizedMod.includes(term)
      || member.normalizedVariantLabel.includes(term)
    ) return true;
    if (!searchMaskContains(member.searchMask, query.termMasks[index]!)) return false;
    return member.normalizedName.includes(term) || member.normalizedTooltip.includes(term);
  });
}

export function catalogDocumentMatches(
  entry: CatalogSearchDocument,
  query: CatalogSearchQuery
): boolean {
  return query.tokens.length === 0 || entry.members.some((member) => memberMatches(member, query));
}

export function scoreCatalogDocument(
  entry: CatalogSearchDocument,
  query: CatalogSearchQuery
): number {
  if (!query.terms.length) return 0;
  const phrase = query.terms.join(' ');
  let best = entry.normalizedName === phrase ? 300 : entry.normalizedName.startsWith(phrase) ? 200 : 0;
  for (const member of entry.members) {
    if (member.normalizedName === phrase) best = Math.max(best, 300);
    else if (member.normalizedName.startsWith(phrase)) best = Math.max(best, 200);
    else {
      best = Math.max(
        best,
        query.terms.reduce(
          (total, term) => total + (
            member.normalizedName.startsWith(term)
            || member.normalizedVariantLabel.startsWith(term)
              ? 20
              : 5
          ),
          0
        )
      );
    }
  }
  return best;
}
