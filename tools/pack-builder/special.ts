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
} from '../data-export/special';

export { SPECIAL_CATEGORY_IDS, buildSpecialViewTypes } from '../data-export/special';

export type { SpecialData, SpecialRecord } from '../data-export/special';

/** Name used by the pack builder for the canonical sidecar type. */
export type BrowserNeiSpecialData = SpecialData;

/** Parse UTF-8 JSON or a parsed sidecar and canonicalize it. */
export function parseBrowserNeiSpecial(value: unknown): SpecialData {
  if (typeof value === 'string') {
    try {
      return canonicalizeSpecialData(JSON.parse(value) as unknown);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new Error(`Special data JSON: ${error.message}`, { cause: error });
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
  goodsIds: ReadonlySet<string>,
): void {
  const missing = specialGoodsIds(data).filter((id) => !goodsIds.has(id));
  if (missing.length > 0) {
    throw new Error(`Special data references unresolved goods IDs: ${missing.join(', ')}`);
  }
}

export { specialGoodsForDirection } from '../../src/lib/specialMatching';
