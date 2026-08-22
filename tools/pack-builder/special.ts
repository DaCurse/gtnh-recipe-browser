/**
 * Pack-builder facade for the maintained browser-nei-special.json contract.
 *
 * The exporter-side validator lives in tools/data-export/special.ts so the
 * disposable overlay and the pack builder cannot silently drift apart. This
 * file only adds pack-oriented helpers and compatibility aliases for callers
 * that work exclusively with tools/pack-builder.
 */

import {
  canonicalizeSpecialData,
  serializeSpecialData,
  specialGoodsIds,
  type SpecialData,
  type SpecialRecord
} from '../data-export/special';

export {
  SPECIAL_CATEGORY_IDS,
  buildSpecialViewTypes
} from '../data-export/special';

export type {
  SpecialData,
  SpecialRecord,
  SpecialViewType
} from '../data-export/special';

/** Name used by the pack builder for the canonical sidecar type. */
export type BrowserNeiSpecialData = SpecialData;

/** Parse UTF-8 JSON or a parsed sidecar and canonicalize it. */
export function parseBrowserNeiSpecial(value: unknown): SpecialData {
  if (typeof value === 'string') {
    try {
      return canonicalizeSpecialData(JSON.parse(value) as unknown);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`Special data JSON: ${error.message}`, { cause: error });
      throw error;
    }
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    return parseBrowserNeiSpecial(new TextDecoder().decode(bytes));
  }
  return canonicalizeSpecialData(value);
}

/** Compatibility alias for pack callers that use a normalize verb. */
export const normalizeBrowserNeiSpecial = canonicalizeSpecialData;

/** Canonical JSON bytes used for the immutable sidecar digest and revision. */
export function canonicalSpecialDataJson(data: SpecialData): string {
  return serializeSpecialData(data);
}

/** Reject every sidecar goods reference absent from processed format-v5 goods. */
export function validateSpecialGoodsReferences(
  data: SpecialData,
  goodsIds: ReadonlySet<string>
): void {
  const missing = specialGoodsIds(data).filter((id) => !goodsIds.has(id));
  if (missing.length > 0) {
    throw new Error(`Special data references unresolved goods IDs: ${missing.join(', ')}`);
  }
}

/** Return the explicit goods direction when supplied by an adapter extension. */
export function specialGoodsForDirection(
  record: SpecialRecord,
  direction: 'recipes' | 'usages'
): string[] {
  const extensionKey = direction === 'recipes' ? 'productionGoodsIds' : 'usageGoodsIds';
  const extension = record[extensionKey];
  const ids = new Set<string>(
    Array.isArray(extension) && extension.every((value) => typeof value === 'string')
      ? extension
      : record.goodsIds
  );
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.endsWith('goodsid') && typeof child === 'string') ids.add(child);
      if (normalizedKey.endsWith('goodsids') && Array.isArray(child)) {
        child.filter((candidate): candidate is string => typeof candidate === 'string')
          .forEach((candidate) => ids.add(candidate));
      }
      visit(child);
    }
  };
  visit(record.payload);
  return [...ids].sort();
}
