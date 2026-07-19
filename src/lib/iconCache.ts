import { getCachedAsset } from './storage';

const resolvedSheets = new Map<string, Promise<string>>();

export function resolveIconSheetUrl(icon: { url: string; sha256?: string }): Promise<string> {
  if (!icon.sha256) return Promise.resolve(icon.url);
  let pending = resolvedSheets.get(icon.sha256);
  if (!pending) {
    pending = (async () => {
      const cached = await getCachedAsset(icon.sha256!);
      return cached
        ? URL.createObjectURL(new Blob([Uint8Array.from(cached).buffer], { type: 'image/webp' }))
        : icon.url;
    })();
    resolvedSheets.set(icon.sha256, pending);
  }
  return pending;
}
