import { blockColors, colorScoreDigits } from './blockColors';
import blockColorSheets from './generated/block-colors.json';
import { minecraftHtmlPlainText } from './minecraftText';
import { normalize } from './searchNormalization';
import {
  parseSearchExpression,
  searchExpressionMatches,
  type SearchExpression,
} from './searchSyntax';
import type { CatalogBrowseEntry, CatalogEntry } from './types';

interface CatalogSearchMember {
  id: string;
  name: string;
  mod: string;
  variantLabel?: string;
  colorScores?: string;
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
  colorScores?: string;
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

const sheetColors: Record<string, string> = blockColorSheets.sheets;

function blockColorScores(entry: CatalogEntry): string | undefined {
  // Minecraft 1.7.10 reserves registry IDs below 4096 for blocks and their item forms.
  if (entry.kind !== 'item' || entry.numericId === undefined || entry.numericId >= 4096) return;
  const icon = entry.icon;
  if (!icon?.sha256) return;
  const scores = sheetColors[icon.sha256];
  if (!scores) return;
  const offset = icon.index * 3;
  const code = [...scores.slice(offset, offset + 3)].reduce(
    (value, digit) => value * 64 + colorScoreDigits.indexOf(digit),
    0,
  );
  const profileOffset = code * blockColors.length;
  return blockColorSheets.profiles.slice(profileOffset, profileOffset + blockColors.length);
}

function buildCatalogSearchEntries(
  catalog: readonly CatalogBrowseEntry[],
  exactCatalog: readonly CatalogEntry[],
  exactById: ReadonlyMap<string, CatalogEntry> = new Map(
    exactCatalog.map((entry) => [entry.id, entry]),
  ),
  oreDictionaryIds?: ReadonlyMap<string, readonly string[]>,
): CatalogSearchEntry[] {
  return catalog
    .filter((entry) => entry.searchable !== false)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      mod: entry.mod,
      kind: entry.kind,
      numericId: entry.numericId,
      damage: entry.damage,
      members: entry.variantIds
        .map((id) => exactById.get(id))
        .filter((member): member is CatalogEntry => member !== undefined)
        .map((member) => ({
          id: member.id,
          name: member.name,
          mod: member.mod,
          variantLabel: entry.variantLabels?.[member.id],
          rawTooltip: member.rawTooltip,
          colorScores: blockColorScores(member),
          oreDictionaryIds: oreDictionaryIds?.get(member.id) ?? member.oreDictionaryIds,
        })),
    }));
}

export function buildCatalogSearchDocuments(
  catalog: readonly CatalogBrowseEntry[],
  exactCatalog: readonly CatalogEntry[],
  exactById?: ReadonlyMap<string, CatalogEntry>,
  oreDictionaryIds?: ReadonlyMap<string, readonly string[]>,
): CatalogSearchDocument[] {
  return buildCatalogSearchEntries(catalog, exactCatalog, exactById, oreDictionaryIds).map(
    buildCatalogSearchDocument,
  );
}

export function buildCatalogSearchDocument(entry: CatalogSearchEntry): CatalogSearchDocument {
  return {
    id: entry.id,
    name: entry.name,
    normalizedName: normalize(entry.name),
    kind: entry.kind ?? 'item',
    numericId: entry.numericId,
    damage: entry.damage,
    members: entry.members.map((member) => {
      const tooltip = minecraftHtmlPlainText(member.rawTooltip);
      const lines = tooltip.split('\n');
      const body =
        normalize(lines[0] ?? '') === normalize(member.name) ? lines.slice(1).join('\n') : tooltip;
      return {
        normalizedId: normalize(member.id),
        normalizedName: normalize(member.name),
        normalizedMod: normalize(member.mod),
        normalizedVariantLabel: normalize(member.variantLabel ?? ''),
        normalizedTooltip: normalize(tooltip),
        normalizedTooltipBody: normalize(body),
        colorScores: member.colorScores,
        normalizedOreNames: (member.oreDictionaryIds ?? []).map((id) =>
          normalize(id.replace(/^o:/, '')),
        ),
      };
    }),
  };
}

export function parseCatalogSearchQuery(query: string): CatalogSearchQuery {
  return parseSearchExpression(query);
}

export function catalogDocumentMatches(
  entry: CatalogSearchDocument,
  query: CatalogSearchQuery,
): boolean {
  return entry.members.some((member) =>
    searchExpressionMatches(query, {
      any: [
        member.normalizedId,
        member.normalizedName,
        member.normalizedMod,
        member.normalizedVariantLabel,
        member.normalizedTooltip,
      ],
      colorScores: member.colorScores,
      mod: [member.normalizedMod],
      tooltip: [member.normalizedTooltipBody],
      ore: member.normalizedOreNames,
      identifier: [member.normalizedId],
    }),
  );
}
