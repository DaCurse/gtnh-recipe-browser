import { fetchVerified } from './datasetAssets';
import { getCachedAsset, recordDatasetAsset } from './storage';
import { verifyAssetBytesAsync } from './integrity';

const resolvedSheets = new Map<string, Promise<string>>();
const cachedSheets = new Map<string, Promise<string | undefined>>();
const sheetOwners = new Map<string, Set<string>>();
let cacheEpoch = 0;
const decodedSheets = new Map<string, Promise<void>>();
export function iconSheetCacheEpoch(): number {
  return cacheEpoch;
}
/** Share decoding across every cell using a sheet, before exposing it to CSS. */
export function decodeIconSheetUrl(url: string): Promise<void> {
  let pending = decodedSheets.get(url);
  if (!pending) {
    pending = (async () => {
      const image = new Image();
      image.src = url;
      await image.decode();
    })();
    decodedSheets.set(url, pending);
    void pending.catch(() => {
      if (decodedSheets.get(url) === pending) decodedSheets.delete(url);
    });
  }
  return pending;
}

function registerOwner(hash: string, datasetId: string | undefined): void {
  if (!datasetId) return;
  const owners = sheetOwners.get(hash) ?? new Set<string>();
  owners.add(datasetId);
  sheetOwners.set(hash, owners);
}

/** Show an already-cached 32px image while its optional original loads. No network. */
export function resolveCachedIconSheetUrl(
  icon: Parameters<typeof resolveIconSheetUrl>[0],
): Promise<string | undefined> {
  if (!icon.sha256 || icon.bytes === undefined) return Promise.resolve(undefined);
  registerOwner(icon.sha256, icon.datasetId);
  const current = resolvedSheets.get(icon.sha256);
  if (current) return current.catch(() => undefined);
  let pending = cachedSheets.get(icon.sha256);
  if (!pending) {
    const hash = icon.sha256;
    const epoch = cacheEpoch;
    pending = (async () => {
      const bytes = await getCachedAsset(hash);
      if (!bytes) return undefined;
      await verifyAssetBytesAsync({ id: icon.id ?? hash, sha256: hash, bytes: icon.bytes! }, bytes);
      if (epoch !== cacheEpoch) return undefined;
      if (icon.datasetId)
        void recordDatasetAsset(icon.datasetId, hash, icon.bytes!).catch(() => {});
      const concurrent = resolvedSheets.get(hash);
      if (concurrent) return concurrent;
      const url = URL.createObjectURL(
        new Blob([Uint8Array.from(bytes).buffer], { type: 'image/webp' }),
      );
      resolvedSheets.set(hash, Promise.resolve(url));
      return url;
    })().catch(() => undefined);
    cachedSheets.set(hash, pending);
  }
  return pending;
}

export function resolveIconSheetUrl(
  icon: {
    id?: string;
    url: string;
    sha256?: string;
    bytes?: number;
    encoding?: 'gzip' | 'identity';
    datasetId?: string;
  },
  options: { fallbackToUrl?: boolean } = {},
): Promise<string> {
  if (!icon.sha256 || icon.bytes === undefined || !icon.encoding) {
    return Promise.resolve(icon.url);
  }
  registerOwner(icon.sha256, icon.datasetId);
  let pending = resolvedSheets.get(icon.sha256);
  if (!pending) {
    pending = (async () => {
      try {
        const bytes = await fetchVerified(
          {
            id: icon.id ?? `icon-${icon.sha256}`,
            url: icon.url,
            bytes: icon.bytes!,
            sha256: icon.sha256!,
            encoding: icon.encoding!,
          },
          icon.url,
        );
        if (icon.datasetId) {
          void recordDatasetAsset(icon.datasetId, icon.sha256!, icon.bytes!).catch((error) =>
            console.warn('Unable to record cached icon sheet', error),
          );
        }
        return URL.createObjectURL(
          new Blob([Uint8Array.from(bytes).buffer], { type: 'image/webp' }),
        );
      } catch (error) {
        if (options.fallbackToUrl === false) throw error;
        // A release host without CORS must not blank the catalog; the browser
        // can still render the immutable image URL directly in that case.
        console.warn('Unable to verify icon sheet; using its direct URL', error);
        return icon.url;
      }
    })();
    resolvedSheets.set(icon.sha256, pending);
    void pending.catch(() => resolvedSheets.delete(icon.sha256!));
  }
  return pending;
}

/**
 * Release object URLs which are not used by the replacement dataset.
 *
 * Sprite sheets are immutable and keyed by their SHA, so retaining hashes
 * shared by both catalogs lets a version switch reuse the already decoded
 * browser image instead of rebuilding it.
 * Active optional companions are retained by dataset ownership because they
 * deliberately do not alter the immutable base manifest.
 */
export function clearIconSheetCache(
  retainHashes: ReadonlySet<string> = new Set(),
  retainDatasetId?: string,
): void {
  cacheEpoch++;
  decodedSheets.clear();
  cachedSheets.clear();
  for (const [sha256, pending] of resolvedSheets) {
    if (
      retainHashes.has(sha256) ||
      (retainDatasetId && sheetOwners.get(sha256)?.has(retainDatasetId))
    )
      continue;
    void pending.then((url) => URL.revokeObjectURL(url)).catch(() => {});
    resolvedSheets.delete(sha256);
    sheetOwners.delete(sha256);
  }
}
