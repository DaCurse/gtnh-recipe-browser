import { fetchVerified } from './datasetAssets';
import { recordDatasetAsset } from './storage';

const resolvedSheets = new Map<string, Promise<string>>();

export function resolveIconSheetUrl(icon: {
  id?: string;
  url: string;
  sha256?: string;
  bytes?: number;
  encoding?: 'gzip' | 'identity';
  datasetId?: string;
}): Promise<string> {
  if (!icon.sha256 || icon.bytes === undefined || !icon.encoding) {
    return Promise.resolve(icon.url);
  }
  let pending = resolvedSheets.get(icon.sha256);
  if (!pending) {
    pending = (async () => {
      try {
        const bytes = await fetchVerified({
          id: icon.id ?? `icon-${icon.sha256}`,
          url: icon.url,
          bytes: icon.bytes!,
          sha256: icon.sha256!,
          encoding: icon.encoding!
        }, icon.url);
        if (icon.datasetId) {
          void recordDatasetAsset(icon.datasetId, icon.sha256!, icon.bytes!)
            .catch((error) => console.warn('Unable to record cached icon sheet', error));
        }
        return URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: 'image/webp' }));
      } catch (error) {
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

/** Release object URLs when the active dataset is replaced. */
export function clearIconSheetCache(): void {
  for (const pending of resolvedSheets.values()) {
    void pending.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  }
  resolvedSheets.clear();
}
