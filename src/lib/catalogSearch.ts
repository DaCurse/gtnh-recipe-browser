import { minecraftHtmlPlainText } from './minecraftText';
import { normalize } from './searchNormalization';
import { parseSearchExpression, searchExpressionMatches, type SearchExpression } from './searchSyntax';
import type { CatalogBrowseEntry, CatalogEntry } from './types';

interface CatalogSearchMember {
  id: string;
  name: string;
  mod: string;
  variantLabel?: string;
  rawTooltip?: string | null;
  oreDictionaryIds?: readonly string[];
}

export interface CatalogSearchEntry {
  id: string;
  name: string;
  mod: string;
  kind?: CatalogEntry['kind'];
  numericId?: number;
  damage?: number;
  members: CatalogSearchMember[];
}

interface CatalogSearchMemberDocument {
  normalizedId: string;
  normalizedName: string;
  normalizedMod: string;
  normalizedVariantLabel: string;
  normalizedTooltip: string;
  normalizedTooltipBody: string;
  normalizedOreNames: string[];
}

export interface CatalogSearchDocument {
  id: string;
  name: string;
  normalizedName: string;
  kind: CatalogEntry['kind'];
  numericId?: number;
  damage?: number;
  members: CatalogSearchMemberDocument[];
}

export type CatalogSearchQuery = SearchExpression;

function buildCatalogSearchEntries(
  catalog: readonly CatalogBrowseEntry[],
  exactCatalog: readonly CatalogEntry[],
  exactById: ReadonlyMap<string, CatalogEntry> = new Map(exactCatalog.map((entry) => [entry.id, entry])),
  oreDictionaryIds?: ReadonlyMap<string, readonly string[]>
): CatalogSearchEntry[] {
  return catalog
    .filter((entry) => entry.searchable !== false)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      mod: entry.mod,
      kind: entry.kind, numericId: entry.numericId, damage: entry.damage,
      members: entry.variantIds
        .map((id) => exactById.get(id))
        .filter((member): member is CatalogEntry => member !== undefined)
        .map((member) => ({
          id: member.id,
          name: member.name,
          mod: member.mod,
          variantLabel: entry.variantLabels?.[member.id],
          rawTooltip: member.rawTooltip,
          oreDictionaryIds: oreDictionaryIds?.get(member.id) ?? member.oreDictionaryIds
        }))
    }));
}

export function buildCatalogSearchDocuments(
  catalog: readonly CatalogBrowseEntry[],
  exactCatalog: readonly CatalogEntry[],
  exactById?: ReadonlyMap<string, CatalogEntry>,
  oreDictionaryIds?: ReadonlyMap<string, readonly string[]>
): CatalogSearchDocument[] {
  return buildCatalogSearchEntries(catalog, exactCatalog, exactById, oreDictionaryIds).map(buildCatalogSearchDocument);
}

export function buildCatalogSearchDocument(entry: CatalogSearchEntry): CatalogSearchDocument {
  return {
    id: entry.id,
    name: entry.name,
    normalizedName: normalize(entry.name),
    kind: entry.kind ?? 'item', numericId: entry.numericId, damage: entry.damage,
    members: entry.members.map((member) => {
      const tooltip = minecraftHtmlPlainText(member.rawTooltip);
      const lines = tooltip.split('\n');
      const body = normalize(lines[0] ?? '') === normalize(member.name) ? lines.slice(1).join('\n') : tooltip;
      return {
        normalizedId: normalize(member.id),
        normalizedName: normalize(member.name),
        normalizedMod: normalize(member.mod),
        normalizedVariantLabel: normalize(member.variantLabel ?? ''),
        normalizedTooltip: normalize(tooltip),
        normalizedTooltipBody: normalize(body),
        normalizedOreNames: (member.oreDictionaryIds ?? []).map(id => normalize(id.replace(/^o:/, '')))
      };
    })
  };
}

export function parseCatalogSearchQuery(query: string): CatalogSearchQuery {
  return parseSearchExpression(query);
}

export function catalogDocumentMatches(
  entry: CatalogSearchDocument,
  query: CatalogSearchQuery
): boolean {
  return entry.members.some(member => searchExpressionMatches(query, {
    any: [member.normalizedId, member.normalizedName, member.normalizedMod,
      member.normalizedVariantLabel, member.normalizedTooltip],
    mod: [member.normalizedMod],
    tooltip: [member.normalizedTooltipBody],
    ore: member.normalizedOreNames,
    identifier: [member.normalizedId]
  }));
}
